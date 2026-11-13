import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { lstat } from 'node:fs/promises';

// This layout is verified against the shipped operations implementation, not a public admission API.
export async function admitProfileUpdate(dir, version, signal) {
  signal.throwIfAborted();
  if (version !== '0.2.2-rc.3') throw fail('Package updates require a reviewed DSH package-operation admission contract.', 'unavailable');
  try {
    await lstat(join(dir, '.plugin-manager', 'run.json'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    signal.throwIfAborted();
    return;
  }
  throw fail('A previous package-operation record exists. Use the official plugin manager to settle or inspect it before retrying; no profile snapshot was taken.', 'unavailable');
}

const MANAGER_VERSION = '0.1.0-alpha.4';
const PROVIDER = 'cua-driver-native';
const PREFIX = 'cua_driver_native__';
const HEALTH_TOOL = PREFIX + 'health_report';
const PACKAGES = Object.freeze([
  { name: '@deepseek-ai/dsh-computer-use', label: 'Computer Use', id: 'computer-use' },
  { name: '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native', label: 'CUA Driver Native', id: 'computer-use-cua-driver-native' },
  { name: '@deepseek-ai/dsh-mcp-client', label: 'MCP Client' },
]);
const ACTIONS = new Set(['setEnabled', 'checkUpdates', 'update', 'health', 'activate']);
const LIMITS = { read: 5000, health: 30000, checkUpdates: 75000, setEnabled: 120000, update: 600000, activate: 900000, readiness: 30000, poll: 250, recovery: 180000 };
const APPROVAL_TTL_MS = 5 * 60 * 1000;
const clone = value => structuredClone(value);

function clean(value, limit = 1600) {
  return String(value?.message ?? value ?? '')
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')
    .replace(/(https?:\/\/)[^\s/@]+@/gi, '$1[redacted]@')
    .replace(/([?&][A-Za-z0-9_%.-]+=)[^&#\s"']+/g, '$1[redacted]')
    .replace(/\b(?:sk-|npm_)[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/\b((?:authorization|[A-Za-z0-9_-]*(?:token|secret|password)|api[_-]?key|key)["']?\s*[=:]\s*)(?:"(?:\\(?:[\s\S]|$)|[^"\\])*(?:"|$)|'(?:\\(?:[\s\S]|$)|[^'\\])*(?:'|$)|(?:bearer\s+)?[^\s"'&,;]+)/gi, '$1[redacted]')
    .slice(-limit);
}

function registryFailure(result) {
  let printed = '';
  if (typeof result.stdout === 'string' && result.stdout.length <= 262144) {
    try {
      const error = JSON.parse(result.stdout).error;
      if (error && typeof error === 'object') printed = [error.code, error.message].filter(item => typeof item === 'string').join(': ');
    } catch { printed = result.stdout; }
  }
  const details = [result.timedOut ? 'Registry request timed out.' : '', result.stderr, printed, result.cause?.message || result.cause]
    .filter(Boolean).map(item => clean(item, 1200)).join(' ');
  return clean('Exit ' + (Number.isInteger(result.exitCode) ? result.exitCode : 'unknown') + '. ' + (details || 'Registry request failed.'));
}

function fail(message, code) {
  return Object.assign(new Error(message), code ? { code } : {});
}

function flatten(rows, inherited = true) {
  return rows.flatMap(row => {
    const local = row.disabled === undefined ? true : typeof row.disabled === 'boolean' ? !row.disabled : null;
    const enabled = inherited === false || local === false ? false : inherited === null || local === null ? null : true;
    return [{ ...row, configuredEnabled: enabled }, ...(row.group && Array.isArray(row.config) ? flatten(row.config, enabled) : [])];
  });
}

function service(ctx, name) {
  return typeof ctx.get === 'function' ? ctx.get(name) : ctx[name];
}

// Only a successful helper result proves a started run finished. A refusal and a failed
// run share the same public exit shape, so neither authorizes our own snapshot recovery.
export async function runProfilePackages(operations, profile, manager, args, { signal, onOutput, onSettled }) {
  const env = Object.fromEntries(Object.entries(manager.env ?? {}).filter(([key]) => !['npm_config_ignore_scripts', 'pnpm_config_ignore_scripts'].includes(key.toLowerCase())));
  env.npm_config_ignore_scripts = 'true';
  env.pnpm_config_ignore_scripts = 'true';
  const result = await operations.runProfilePnpm({ ...profile, profile: profile.name }, args, {
    ...manager, args: [...(manager.args ?? []), '--config.ignore-scripts=true'], env,
    execution: 'service', outputBytes: 16384, activateNewBundles: false,
    idleTimeoutMs: 120000, lookupTimeoutMs: 20000, signal, onOutput,
  });
  if (result.exitCode === 0 && !result.timedOut) onSettled();
  return result;
}

// Host peers are resolved by DSH, never imported while isolated Node tests load this module.
async function productionRuntime() {
  const boot = await import('@deepseek-ai/dsh-app-boot');
  const operations = await import('@deepseek-ai/dsh-plugin-manager/operations');
  const atomic = await import('@deepseek-ai/dsh-atomic-write');
  const fs = await import('node:fs/promises');
  const profileOf = ctx => {
    const profile = service(ctx, 'profileContext');
    if (!profile?.dir || !profile.installAnchor) throw fail('The running profile context is unavailable.');
    return profile;
  };
  const packageManager = ctx => {
    const manager = profileOf(ctx).packageManager ?? {};
    return { command: manager.command ?? 'pnpm', args: manager.args ?? [], ...(manager.env ? { env: manager.env } : {}) };
  };
  return {
    platform: process.platform,
    version: () => boot.getDshRuntimeVersion(),
    configured: ctx => flatten(boot.composeEntries([boot.readProfilePatches('dsh', profileOf(ctx))])),
    manifest: (ctx, name) => {
      const profile = profileOf(ctx);
      const dir = boot.resolveBundleDir('dsh', name, profile.installAnchor, profile.dir);
      return boot.readProfileManifest('dsh', dir);
    },
    compatible: (manifest, version) => boot.evaluatePluginCompatibility(manifest, {}, version) === undefined,
    lookup: (ctx, name, version, signal) => operations.viewProfilePackage(profileOf(ctx).dir, name + '@' + version, {
      ...packageManager(ctx), fields: ['name', 'version', 'engines', 'peerDependencies'], timeoutMs: 20000, signal,
    }),
    lock: (ctx, callback, signal) => atomic.withFileLock(join(profileOf(ctx).dir, 'package.json'), callback, { waitMs: 120000, signal }),
    admit: (ctx, signal) => admitProfileUpdate(profileOf(ctx).dir, boot.getDshRuntimeVersion(), signal),
    backup: async ctx => {
      const profile = profileOf(ctx);
      const saved = [];
      for (const name of ['package.json', 'pnpm-lock.yaml']) {
        const path = join(profile.dir, name);
        try {
          const info = await fs.stat(path);
          if (info.size > 16 * 1024 * 1024) throw fail('Profile metadata is too large for safe recovery.');
          saved.push({ path, text: await fs.readFile(path, 'utf8') });
        } catch (error) {
          if (error.code !== 'ENOENT' || name === 'package.json') throw error;
          saved.push({ path, text: null });
        }
      }
      return saved;
    },
    restore: async (_ctx, saved) => {
      for (const file of saved) {
        if (file.text === null) await fs.rm(file.path, { force: true });
        else await atomic.writeFileAtomic(file.path, file.text, { mode: 0o600 });
      }
    },
    run: (ctx, args, execution) => runProfilePackages(operations, profileOf(ctx), packageManager(ctx), args, execution),
  };
}

function healthOf(result, checkedAt) {
  let report = result?.structuredContent;
  if (!report || typeof report !== 'object') {
    for (const item of result?.content ?? []) {
      if (item.type !== 'text' || typeof item.text !== 'string' || item.text.length > 262144) continue;
      try { report = JSON.parse(item.text); break; } catch { /* Other MCP text is not a report. */ }
    }
  }
  if (!['ok', 'degraded', 'failed'].includes(report?.overall) || !Array.isArray(report.checks)) {
    throw fail('The native driver returned an invalid health report.');
  }
  return {
    overall: report.overall, checkedAt,
    checks: report.checks.slice(0, 48).map(check => ({
      name: clean(check?.name || 'check', 120),
      status: ['pass', 'fail', 'skip', 'unknown'].includes(check?.status) ? check.status : 'unknown',
      message: clean(check?.message, 1000),
      ...(typeof check?.hint === 'string' && check.hint.trim() ? { hint: clean(check.hint, 1600) } : {}),
    })),
  };
}

export class ComputerUseManager {
  #activationApproval = null;

  constructor(ctx, options = {}) {
    this.ctx = ctx;
    this.loadRuntime = typeof options.runtime === 'function' ? options.runtime : options.runtime ? async () => options.runtime : productionRuntime;
    this.now = options.now ?? (() => new Date().toISOString());
    this.clock = options.clock ?? Date.now;
    this.timeouts = { ...LIMITS, ...options.timeouts };
    this.disposed = false;
    this.pending = null;
    this.refreshing = null;
    this.controller = null;
    this.log = '';
    this.discardingLogLine = false;
    this.healthDefinition = null;
    this.restartReasons = new Set();
    this.value = {
      managerVersion: MANAGER_VERSION, runtimeVersion: 'unknown', platform: process.platform, checkedAt: null,
      configuredEnabled: false, configurationKnown: false, running: false, provider: null, toolCount: 0, status: 'unknown', reason: null,
      packages: PACKAGES.map(({ name, label }) => ({ name, label, version: null, targetVersion: 'unknown', compatible: false })),
      update: { status: 'unchecked', checkedAt: null, targetVersion: 'unknown', reason: null },
      health: null, operation: null, history: [], restartRequired: false,
    };
  }

  requireRestart(reason = 'repair', required = true) {
    // A flag without a known cause must not be cleared by a successful reload.
    if (this.value.restartRequired && !this.restartReasons.size) this.restartReasons.add('unknown');
    if (required) this.restartReasons.add(reason);
    else this.restartReasons.delete(reason);
    this.value.restartRequired = this.restartReasons.size > 0;
  }

  runtime() {
    return this.runtimePromise ??= Promise.resolve().then(() => this.loadRuntime());
  }

  async readWithin(callback, signal, timeoutMs = this.timeouts.read) {
    const controller = new AbortController();
    const aborted = () => controller.abort(signal.reason);
    if (signal?.aborted) aborted();
    else signal?.addEventListener('abort', aborted, { once: true });
    const timer = setTimeout(() => controller.abort(fail('The request timed out.')), timeoutMs);
    let rejectAbort;
    const cancelled = new Promise((_, reject) => {
      rejectAbort = () => reject(controller.signal.reason ?? fail('Operation cancelled.'));
      if (controller.signal.aborted) rejectAbort();
      else controller.signal.addEventListener('abort', rejectAbort, { once: true });
    });
    try { return await Promise.race([Promise.resolve().then(() => callback(controller.signal)), cancelled]); }
    finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', aborted);
      controller.signal.removeEventListener('abort', rejectAbort);
    }
  }

  async refresh(force = false) {
    if (this.refreshing) {
      await this.refreshing;
      if (!force) return;
    }
    this.refreshing = this.readWithin(async () => {
      const runtime = await this.runtime();
      const version = runtime.version();
      const configured = runtime.configured(this.ctx);
      const rows = await service(this.ctx, 'pluginManager').listPlugins();
      const packages = PACKAGES.map(({ name, label }) => {
        let manifest;
        try { manifest = runtime.manifest(this.ctx, name); } catch { /* Missing packages remain visible. */ }
        let compatible = false;
        try { compatible = manifest?.name === name && manifest.version === version && runtime.compatible(manifest, version); } catch { /* Invalid metadata is incompatible. */ }
        return { name, label, version: typeof manifest?.version === 'string' ? clean(manifest.version, 120) : null, targetVersion: version, compatible };
      });
      const configRows = PACKAGES.slice(0, 2).map(spec => configured.filter(row => row.id === spec.id && row.name === spec.name));
      const configurationKnown = configRows.every(matches => matches.length === 1 && typeof matches[0].configuredEnabled === 'boolean');
      const configuredEnabled = configurationKnown && configRows.every(matches => matches[0].configuredEnabled);
      const runtimeRows = PACKAGES.slice(0, 2).map(spec => this.row(rows, spec));
      const tools = service(this.ctx, 'tools')?.definitions() ?? [];
      const toolCount = tools.filter(tool => tool.name?.startsWith(PREFIX)).length;
      const providerName = service(this.ctx, 'computerUse')?.providerName;
      const provider = typeof providerName === 'string' ? clean(providerName, 120) : null;
      const running = providerName === PROVIDER && toolCount > 0 && runtimeRows.every(row => row?.fiberPhase === 'active');
      let status = 'waiting';
      let reason = 'The native provider is not active.';
      if (packages.some(pkg => pkg.version !== null && !pkg.compatible)) {
        status = 'incompatible'; reason = 'Computer-use packages must match DSH ' + version + ' and its compatibility requirements.';
      } else if (packages.some(pkg => pkg.version === null)) {
        status = 'missing'; reason = 'One or more computer-use packages are missing or unreadable.';
      } else if (!configurationKnown) {
        status = 'unknown'; reason = 'The two persistent computer-use rows are missing, ambiguous, or use configuration expressions.';
      } else if (!configuredEnabled) {
        status = 'disabled'; reason = running ? 'Disabled in configuration; the provider has not stopped yet.' : null;
      } else if (runtimeRows.some(row => row?.fiberPhase === 'failed')) {
        status = 'failed'; reason = clean(runtimeRows.find(row => row?.fiberPhase === 'failed')?.diagnostic || 'The native provider failed to start.');
      } else if (running) {
        status = 'running'; reason = null;
      }
      return { runtimeVersion: version, platform: runtime.platform ?? process.platform, checkedAt: this.now(), configuredEnabled, configurationKnown, running, provider, toolCount, status, reason, packages };
    }).then(fresh => {
      const environmentChanged = fresh.runtimeVersion !== this.value.runtimeVersion || fresh.platform !== this.value.platform ||
        fresh.packages.some((pkg, index) => ['version', 'targetVersion', 'compatible'].some(key => pkg[key] !== this.value.packages[index][key]));
      Object.assign(this.value, fresh);
      if (environmentChanged) this.value.update = { status: 'unchecked', checkedAt: null, targetVersion: fresh.runtimeVersion, reason: null };
      if (environmentChanged || (this.value.health?.overall !== 'unavailable' && (!fresh.running || service(this.ctx, 'tools')?.get(HEALTH_TOOL) !== this.healthDefinition))) this.value.health = null;
    }).catch(error => {
      this.value.checkedAt = this.now();
      this.value.running = false;
      this.value.status = 'unknown';
      this.value.configurationKnown = false;
      this.value.reason = clean(error);
      this.value.health = null;
    }).finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  row(rows, spec) {
    const matches = rows.filter(row => row.moduleName === spec.name && (row.patchId === spec.id || row.entryId === spec.id));
    return matches.length === 1 ? matches[0] : undefined;
  }

  snapshot() {
    const state = clone(this.value);
    if (state.operation && this.log) state.operation.log = clean(this.log, 8192);
    return state;
  }

  async state() {
    if (!this.disposed) await this.refresh();
    return this.snapshot();
  }

  async start(action, args = {}) {
    if (this.disposed) throw fail('The computer-use manager is disposed.', 'disposed');
    if (!ACTIONS.has(action)) throw fail('Unknown action.');
    const keys = ['action', ...(action === 'setEnabled' ? ['enabled'] : action === 'activate' ? ['installVersion', 'approvalId'] : [])];
    if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(key => !keys.includes(key)) ||
        (args.action !== undefined && args.action !== action) || (action === 'setEnabled' && typeof args.enabled !== 'boolean')) throw fail('Invalid action arguments.');
    const approved = action === 'activate' && Object.hasOwn(args, 'approvalId');
    if (action === 'activate' && (Object.hasOwn(args, 'installVersion') !== approved || (approved &&
        (typeof args.installVersion !== 'string' || !args.installVersion.trim() || args.installVersion.length > 120 ||
         typeof args.approvalId !== 'string' || !args.approvalId.trim() || args.approvalId.length > 160)))) throw fail('Invalid activation approval arguments.');
    if (this.pending) throw fail('A computer-use operation is already running.', 'busy');
    const controller = this.controller = new AbortController();
    const operation = this.value.operation = { id: randomUUID(), kind: action, status: 'running', message: 'Starting ' + action + '.', startedAt: this.now(), finishedAt: null };
    const enabled = args.enabled;
    const activation = approved ? { installVersion: args.installVersion, approvalId: args.approvalId } : null;
    if (action === 'activate') operation.phase = 'checking';
    if (!approved) this.#activationApproval = null;
    this.log = '';
    this.discardingLogLine = false;
    if (action === 'setEnabled' || action === 'update') this.value.health = null;
    const timer = setTimeout(() => {
      controller.abort(fail('The operation exceeded its time limit.'));
      operation.message = 'Time limit reached; waiting for the host operation and recovery to settle.';
    }, this.timeouts[action]);
    // Keep the slot occupied until even uncancellable host calls settle; a timeout must never allow a second writer.
    this.pending = Promise.resolve().then(async () => {
      const runtime = await this.readWithin(() => this.runtime(), controller.signal);
      controller.signal.throwIfAborted();
      await this.refresh();
      controller.signal.throwIfAborted();
      let outcome;
      if (action === 'activate') outcome = await this.activate(runtime, activation, controller.signal);
      else if (action === 'setEnabled') outcome = await this.setEnabled(runtime, enabled, controller.signal);
      else if (action === 'checkUpdates') outcome = await this.checkUpdates(runtime, controller.signal);
      else if (action === 'update') outcome = await this.update(runtime, controller.signal);
      else outcome = await this.health(controller.signal);
      controller.signal.throwIfAborted();
      operation.status = outcome?.status ?? (outcome?.restartRequired ? 'restart-required' : 'done');
      if (outcome?.confirmation) operation.confirmation = outcome.confirmation;
      operation.message = clean(outcome?.message || 'Operation completed.');
    }).catch(error => {
      operation.status = 'failed';
      operation.message = clean(error);
      if (action === 'activate') this.#activationApproval = null;
      const activationUpdateFailed = action === 'activate' && (operation.phase === 'installing' || (operation.phase === 'checking' && this.value.update.status === 'checking'));
      if (error.code === 'configuration_changed') operation.code = 'configuration_changed';
      if (action === 'checkUpdates' || action === 'update' || activationUpdateFailed) {
        this.value.update.status = error.code === 'unavailable' ? 'unavailable' : 'error';
        this.value.update.checkedAt = this.now();
        this.value.update.reason = clean(error);
      }
      if (action === 'health') this.value.health = { overall: 'unavailable', checkedAt: this.now(), checks: [{ name: 'native-driver', status: 'fail', message: clean(error) }] };
    }).finally(async () => {
      clearTimeout(timer);
      await this.refresh();
      operation.finishedAt = this.now();
      this.value.history.unshift({ time: operation.finishedAt, kind: action, status: operation.status, message: operation.message });
      this.value.history.length = Math.min(this.value.history.length, 32);
      this.controller = null;
      this.pending = null;
    });
    return this.snapshot();
  }

  append(text) {
    let chunk = String(text);
    if (this.discardingLogLine) {
      const end = chunk.indexOf('\n');
      if (end < 0) return;
      chunk = chunk.slice(end + 1);
      this.discardingLogLine = false;
    }
    const combined = this.log + chunk;
    if (combined.length <= 32768) { this.log = combined; return; }
    // Never retain a tail starting inside a truncated credential or control sequence.
    const end = combined.indexOf('\n', combined.length - 32768);
    this.log = end < 0 ? '' : combined.slice(end + 1);
    this.discardingLogLine = end < 0;
  }

  async setEnabled(runtime, enabled, signal, options = {}) {
    if (enabled && this.value.packages.some(pkg => !pkg.compatible)) throw fail('Install compatible runtime-matching packages before enabling computer use.');
    const ownership = options.ownership ?? { expected: this.savedEnablement(runtime), grants: [], conflicted: false };
    const manager = service(this.ctx, 'pluginManager');
    const specs = enabled ? PACKAGES.slice(0, 2) : PACKAGES.slice(0, 2).reverse();
    const rows = await this.readWithin(() => manager.listPlugins(), signal);
    this.verifyEnablementOwnership(runtime, ownership);
    const planned = specs.map(spec => {
      const row = this.row(rows, spec);
      if (!row || row.readOnlyReason) throw fail('The persistent ' + spec.id + ' row cannot be managed.');
      return { ...row, spec, savedEnabled: ownership.expected.find(item => item.spec.id === spec.id).enabled };
    });
    let restartRequired = false;
    try {
      for (const row of planned) {
        signal.throwIfAborted();
        if (this.disposed) throw fail('The computer-use manager is disposed.', 'disposed');
        this.verifyEnablementOwnership(runtime, ownership);
        const retryActivation = options.activation && enabled && !options.pendingRestart && row.fiberPhase !== 'active';
        if (row.savedEnabled === enabled && row.enabled === enabled && !retryActivation) continue;
        const observeWrite = () => {
          const observed = this.savedEnablement(runtime);
          const current = observed.find(item => item.spec.id === row.spec.id);
          if (current.enabled === enabled) {
            if (enabled && !row.savedEnabled) ownership.grants.push(row.spec);
            ownership.expected.find(item => item.spec.id === row.spec.id).enabled = enabled;
          }
          this.verifyEnablementOwnership(runtime, ownership, observed);
        };
        let result;
        try { result = await manager.setPluginEnabled(row.entryId, enabled); }
        catch (error) {
          // The official API may reject after saving its desired state.
          observeWrite();
          throw error;
        }
        observeWrite();
        if (result.application === 'restart-required') restartRequired = true;
        else if (result.application === 'overridden' && options.activation) {
          this.verifyActivationConfiguration(runtime, row.patchId ?? row.entryId);
          if (options.pendingRestart) restartRequired = true;
          else throw fail('Enablement was overridden.');
        } else if (result.application !== 'applied') throw fail(clean(result.error?.diagnostic || result.error?.code || ('Enablement was ' + result.application + '.')));
        if (options.activation) this.verifyActivationConfiguration(runtime, row.patchId ?? row.entryId);
        signal.throwIfAborted();
      }
    } catch (error) {
      if (options.ownership) throw error;
      try { await this.revokeEnablement(runtime, ownership); }
      catch (recoveryError) {
        this.append('Enablement recovery: ' + clean(recoveryError) + '\n');
        this.requireRestart();
      }
      throw error;
    }
    this.value.health = null;
    if (restartRequired) this.requireRestart('enablement');
    return { restartRequired, message: restartRequired ? 'Enablement saved; restart DSH to apply it.' : enabled ? 'Computer use enabled.' : 'Computer use disabled.' };
  }

  async checkUpdates(runtime, signal) {
    const version = runtime.version();
    this.value.update = { status: 'checking', checkedAt: null, targetVersion: version, reason: null };
    for (const spec of PACKAGES) {
      signal.throwIfAborted();
      const result = await this.readWithin(innerSignal => runtime.lookup(this.ctx, spec.name, version, innerSignal), signal, 25000);
      signal.throwIfAborted();
      if (result.exitCode !== 0 || result.timedOut) throw fail('Matching package unavailable: ' + spec.name + '. ' + registryFailure(result), 'unavailable');
      let manifest;
      try {
        if (typeof result.stdout !== 'string' || result.stdout.length > 262144) throw fail('Invalid registry response.');
        manifest = JSON.parse(result.stdout.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').trim());
      } catch { throw fail('Invalid registry metadata for ' + spec.name + '.'); }
      if (manifest?.name !== spec.name || manifest.version !== version || !runtime.compatible(manifest, version)) throw fail('The registry did not provide the exact compatible ' + spec.name + '@' + version + '.', 'unavailable');
    }
    await this.refresh();
    if (runtime.version() !== version || this.value.runtimeVersion !== version || this.value.status === 'unknown') {
      throw fail('The running DSH environment changed or could not be verified; check compatible components again.');
    }
    const current = this.value.packages.every(pkg => pkg.version === version && pkg.compatible);
    this.value.update = { status: current ? 'current' : 'available', checkedAt: this.now(), targetVersion: version, reason: null };
    return { message: current ? 'All computer-use packages match the running DSH version.' : 'Runtime-matching computer-use packages are available.' };
  }

  async reconcile(signal, requiredIds = []) {
    const hmr = service(this.ctx, 'hmr');
    if (!hmr) { this.requireRestart('hmr'); return true; }
    signal.throwIfAborted();
    if (this.disposed) throw fail('The computer-use manager is disposed.', 'disposed');
    const result = await hmr.runExclusive(async () => {
      signal.throwIfAborted();
      if (this.disposed) throw fail('The computer-use manager is disposed.', 'disposed');
      return hmr.reconcileProfile(requiredIds);
    });
    if (!result || !Array.isArray(result.pending) || !Array.isArray(result.warnings)) {
      this.requireRestart();
      throw fail('The host returned an invalid profile reconciliation result; restart requirements remain unresolved.');
    }
    const restartRequired = Boolean(result.restartReason || result.pending.length);
    for (const warning of result.warnings) this.append(clean(typeof warning === 'string' ? warning : warning.message || JSON.stringify(warning)) + '\n');
    this.requireRestart('hmr', restartRequired);
    return restartRequired;
  }

  async retryReconciliation(runtime, signal) {
    if (!this.value.restartRequired || !this.restartReasons.size ||
        [...this.restartReasons].some(reason => !['hmr', 'enablement'].includes(reason)) || !service(this.ctx, 'hmr')) return;
    return runtime.lock(this.ctx, async () => {
      signal.throwIfAborted();
      if (this.disposed) throw fail('The computer-use manager is disposed.', 'disposed');
      const required = this.savedEnablement(runtime).filter(row => row.enabled).map(row => row.spec.id);
      const pending = await this.reconcile(signal, required);
      await this.refresh(true);
      signal.throwIfAborted();
      if (!pending && this.value.configurationKnown && this.value.configuredEnabled && this.value.running &&
          this.value.packages.every(pkg => pkg.compatible)) this.requireRestart('enablement', false);
      return !pending;
    }, signal);
  }

  async update(runtime, signal) {
    await this.checkUpdates(runtime, signal);
    const version = runtime.version();
    this.value.operation.message = 'Installing computer-use packages matching DSH ' + version + '.';
    return runtime.lock(this.ctx, async () => {
      signal.throwIfAborted();
      if (this.disposed) throw fail('The computer-use manager is disposed.', 'disposed');
      if (typeof runtime.admit !== 'function') throw fail('No safe package-operation admission contract is available.', 'unavailable');
      await runtime.admit(this.ctx, signal);
      signal.throwIfAborted();
      const requiredIds = () => {
        const configured = runtime.configured(this.ctx);
        return PACKAGES.slice(0, 2).filter(spec => configured.some(row => row.id === spec.id && row.name === spec.name && row.configuredEnabled === true)).map(spec => spec.id);
      };
      const saved = await runtime.backup(this.ctx);
      const before = PACKAGES.map(spec => {
        try { return runtime.manifest(this.ctx, spec.name)?.version ?? null; } catch { return null; }
      });
      let ownsSettledRun = false;
      try {
        signal.throwIfAborted();
        // The adapter may confirm this only once its own package writer has stopped.
        const result = await runtime.run(this.ctx, ['add', '--save-exact', '--ignore-scripts', ...PACKAGES.map(pkg => pkg.name + '@' + version)], { signal, onOutput: text => this.append(text), onSettled: () => { ownsSettledRun = true; } });
        this.append(result.output || '');
        if (!ownsSettledRun) throw fail('Package execution did not confirm settlement. ' + clean(result.output || ''));
        signal.throwIfAborted();
        if (result.exitCode !== 0 || result.timedOut) throw fail('Computer-use package installation failed. ' + clean(result.output || 'No package-manager diagnostic was returned.'));
        for (const spec of PACKAGES) {
          const manifest = runtime.manifest(this.ctx, spec.name);
          if (manifest.name !== spec.name || manifest.version !== version || !runtime.compatible(manifest, version)) throw fail('Installed package validation failed for ' + spec.name + '.');
        }
        const required = requiredIds();
        const restartRequired = await this.reconcile(signal, required);
        await this.refresh(true);
        if (!restartRequired && required.length === 2 && !this.value.running) throw fail('The enabled native provider did not become active after update. ' + (this.value.reason || ''));
        this.value.update = { status: 'current', checkedAt: this.now(), targetVersion: version, reason: null };
        this.value.health = null;
        return { restartRequired, message: restartRequired ? 'Runtime-matching packages installed; restart DSH to load pending changes.' : 'Runtime-matching computer-use packages installed and reconciled.' };
      } catch (error) {
        if (!ownsSettledRun) {
          this.requireRestart();
          throw fail(clean(error) + ' No settled package-writer ownership was confirmed; no profile metadata was restored. Inspect and repair the profile through the official plugin manager before retrying.');
        }
        this.value.operation.message = 'Recovering the previous profile metadata and dependencies.';
        const recovery = new AbortController();
        const timer = setTimeout(() => recovery.abort(fail('Package recovery timed out.')), this.timeouts.recovery);
        let restored = false;
        let metadataRestoreSafe = true;
        try {
          await runtime.restore(this.ctx, saved);
          const hadLock = saved.some(file => file.path.endsWith('pnpm-lock.yaml') && file.text !== null);
          metadataRestoreSafe = false;
          const repair = await runtime.run(this.ctx, ['install', hadLock ? '--frozen-lockfile' : '--config.lockfile=false', '--ignore-scripts'], { signal: recovery.signal, onOutput: text => this.append(text), onSettled: () => { metadataRestoreSafe = true; } });
          this.append(repair.output || '');
          if (!metadataRestoreSafe) throw fail('The repair package writer did not confirm settlement.');
          recovery.signal.throwIfAborted();
          if (repair.exitCode !== 0 || repair.timedOut) throw fail('Previous dependencies could not be reinstalled.');
          for (let index = 0; index < PACKAGES.length; index++) {
            let version = null;
            try { version = runtime.manifest(this.ctx, PACKAGES[index].name)?.version ?? null; } catch { /* Previously absent packages may stay absent. */ }
            if (version !== before[index]) throw fail('The previous package versions could not be verified.');
          }
          // Unload may itself hold the HMR queue. Only finish our package cleanup here.
          if (!this.disposed) await this.reconcile(recovery.signal, requiredIds());
          else this.requireRestart();
          restored = true;
        } catch (recoveryError) {
          this.requireRestart();
          this.append('Recovery failed: ' + clean(recoveryError) + '\n');
        } finally {
          clearTimeout(timer);
          // Each repair is a new writer: never reuse the first run's settlement proof.
          if (metadataRestoreSafe) {
            try { await runtime.restore(this.ctx, saved); }
            catch (restoreError) { restored = false; this.requireRestart(); this.append('Metadata recovery failed: ' + clean(restoreError) + '\n'); }
          } else {
            restored = false;
            this.requireRestart();
            this.append('Metadata recovery skipped: the repair writer did not confirm settlement.\n');
          }
        }
        throw fail(clean(error) + (restored ? ' Previous profile metadata and dependencies were restored; lifecycle-script side effects may remain.' : ' Recovery is incomplete; profile repair and a DSH restart are required.'));
      }
    }, signal);
  }

  savedEnablement(runtime) {
    const configured = runtime.configured(this.ctx);
    return PACKAGES.slice(0, 2).map(spec => {
      const rows = configured.filter(row => row.id === spec.id && row.name === spec.name);
      if (rows.length !== 1 || typeof rows[0].configuredEnabled !== 'boolean') throw fail('The persistent ' + spec.id + ' row cannot be managed.');
      return { spec, enabled: rows[0].configuredEnabled };
    });
  }

  verifyActivationConfiguration(runtime, id) {
    let saved;
    try { saved = this.savedEnablement(runtime); }
    catch (error) { throw fail('Computer-use configuration changed or cannot be verified; current settings were preserved. ' + clean(error), 'configuration_changed'); }
    const selected = id ? saved.filter(row => row.spec.id === id) : saved;
    if (!selected.length || selected.some(row => !row.enabled)) throw fail('Computer-use configuration changed or is overridden; current settings were preserved.', 'configuration_changed');
  }

  locallyCompatible(runtime, version) {
    return PACKAGES.every(spec => {
      try {
        const manifest = runtime.manifest(this.ctx, spec.name);
        return manifest.name === spec.name && manifest.version === version && runtime.compatible(manifest, version);
      } catch { return false; }
    });
  }

  activationPhase(phase, message) {
    this.value.operation.phase = phase;
    this.value.operation.message = message;
  }

  verifyEnablementOwnership(runtime, ownership, observed) {
    try {
      const current = observed ?? this.savedEnablement(runtime);
      if (current.some((row, index) => row.enabled !== ownership.expected[index].enabled)) throw fail('Enablement changed.');
    } catch (error) {
      ownership.conflicted = true;
      throw fail('Computer-use configuration changed or cannot be verified; current settings were preserved. ' + clean(error), 'configuration_changed');
    }
  }

  async revokeEnablement(runtime, ownership) {
    // No CAS exists: same-value ABA changes cannot be identified. Never re-grant a
    // previously enabled capability, and preserve all observed conflicting changes.
    if (!ownership.grants.length || ownership.conflicted) return;
    if (this.disposed) { this.requireRestart(); return; }
    try { this.verifyEnablementOwnership(runtime, ownership); }
    catch { return; }
    const manager = service(this.ctx, 'pluginManager');
    this.activationPhase('enabling', 'Revoking capability grants made by this operation.');
    for (const spec of [...ownership.grants].reverse()) {
      if (this.disposed) { this.requireRestart(); return; }
      const rows = await this.readWithin(() => manager.listPlugins());
      if (this.disposed) { this.requireRestart(); return; }
      try { this.verifyEnablementOwnership(runtime, ownership); }
      catch { return; }
      const row = this.row(rows, spec);
      if (!row || row.readOnlyReason) throw fail('The persistent ' + spec.id + ' row cannot be revoked.');
      const result = await manager.setPluginEnabled(row.entryId, false);
      if (result.application === 'restart-required') this.requireRestart();
      else if (result.application !== 'applied') throw fail('Enablement recovery was ' + result.application + '.');
      ownership.expected.find(item => item.spec.id === spec.id).enabled = false;
      ownership.grants = ownership.grants.filter(item => item.id !== spec.id);
      this.verifyEnablementOwnership(runtime, ownership);
    }
  }

  async waitUntilReady(runtime, version, signal) {
    const deadline = Date.now() + this.timeouts.readiness;
    while (true) {
      signal.throwIfAborted();
      await this.refresh(true);
      signal.throwIfAborted();
      if (runtime.version() !== version) throw fail('The running DSH version changed during activation.');
      if (!this.locallyCompatible(runtime, version)) throw fail('Computer-use packages changed during activation.');
      this.verifyActivationConfiguration(runtime);
      if (this.value.running) return;
      if (this.value.status === 'failed') throw fail('The native provider failed to start. ' + (this.value.reason || ''));
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw fail('The native provider did not become ready before the startup timeout.');
      await delay(Math.min(this.timeouts.poll, remaining), undefined, { signal });
    }
  }

  async activate(runtime, approvalArgs, signal) {
    const version = runtime.version();
    let approved = false;
    if (approvalArgs) {
      const approval = this.#activationApproval;
      this.#activationApproval = null;
      if (!approval || approval.approvalId !== approvalArgs.approvalId || approval.version !== approvalArgs.installVersion ||
          approval.version !== version || approval.expiresAt <= this.clock()) throw fail('Installation approval is missing, expired, already used, or does not match the running DSH version.');
      approved = true;
    }
    signal.throwIfAborted();
    const ownership = { expected: this.savedEnablement(runtime), grants: [], conflicted: false };
    if (!approved && !this.locallyCompatible(runtime, version)) {
      this.activationPhase('checking', 'Checking runtime-matching computer-use packages.');
      await this.checkUpdates(runtime, signal);
      signal.throwIfAborted();
      if (runtime.version() !== version) throw fail('The running DSH version changed; request activation again.');
      const confirmation = { approvalId: randomUUID(), version, packages: PACKAGES.map(spec => spec.name) };
      this.#activationApproval = { approvalId: confirmation.approvalId, version, expiresAt: this.clock() + APPROVAL_TTL_MS };
      return { status: 'needs-confirmation', confirmation, message: 'Runtime-matching package installation requires confirmation.' };
    }
    try {
      this.value.health = null;
      const reconciled = await this.retryReconciliation(runtime, signal);
      let restartRequired = false;
      if (approved) {
        this.activationPhase('installing', 'Installing runtime-matching computer-use packages.');
        const installed = await this.update(runtime, signal);
        restartRequired = installed.restartRequired;
      }
      signal.throwIfAborted();
      if (runtime.version() !== version) throw fail('The running DSH version changed during activation.');
      this.verifyEnablementOwnership(runtime, ownership);
      this.activationPhase('enabling', 'Enabling computer use.');
      const enabled = await this.setEnabled(runtime, true, signal, { activation: true, pendingRestart: restartRequired, ownership });
      if (reconciled && !restartRequired && !enabled.restartRequired && this.restartReasons.has('enablement')) {
        this.activationPhase('waiting', 'Waiting for the native provider.');
        await this.waitUntilReady(runtime, version, signal);
        this.requireRestart('enablement', false);
      }
      restartRequired ||= enabled.restartRequired || this.value.restartRequired;
      signal.throwIfAborted();
      this.verifyActivationConfiguration(runtime);
      if (restartRequired) return { restartRequired: true, message: 'Computer use is enabled in configuration; restart DSH to apply pending changes.' };
      this.activationPhase('waiting', 'Waiting for the native provider.');
      await this.waitUntilReady(runtime, version, signal);
      this.activationPhase('health', 'Checking native driver health.');
      try {
        await this.health(signal);
      } catch (error) {
        signal.throwIfAborted();
        this.value.health = { overall: 'unavailable', checkedAt: this.now(), checks: [{ name: 'native-driver', status: 'fail', message: clean(error) }] };
      }
      signal.throwIfAborted();
      await this.waitUntilReady(runtime, version, signal);
      const overall = this.value.health?.overall ?? 'unavailable';
      return overall === 'ok' ? { message: 'Computer use is active; native driver health is OK.' } :
        { status: 'warning', message: 'Computer use is enabled; native driver health is ' + overall + '.' };
    } catch (error) {
      try { await this.revokeEnablement(runtime, ownership); }
      catch (recoveryError) {
        this.requireRestart();
        this.append('Activation recovery failed: ' + clean(recoveryError) + '\n');
        throw fail(clean(error) + ' Capability-grant recovery is incomplete; restart and profile repair are required.');
      }
      throw error;
    }
  }

  async health(signal) {
    if (!this.value.running) throw fail('The native provider is not active; diagnostics are unavailable.');
    const definition = service(this.ctx, 'tools')?.get(HEALTH_TOOL);
    if (!definition?.execute) throw fail('The native health-report tool is unavailable.');
    const result = await this.readWithin(innerSignal => definition.execute({}, { signal: innerSignal }), signal, this.timeouts.health);
    signal.throwIfAborted();
    if (service(this.ctx, 'tools')?.get(HEALTH_TOOL) !== definition || service(this.ctx, 'computerUse')?.providerName !== PROVIDER) throw fail('The native provider changed while diagnostics were running.');
    this.value.health = healthOf(result, this.now());
    this.healthDefinition = definition;
    return { message: 'Native driver diagnostics completed.' };
  }

  async dispose() {
    this.disposed = true;
    this.#activationApproval = null;
    this.controller?.abort(fail('The computer-use manager was disposed.'));
    // An official toggle or reconciliation may be queued behind this disposer.
    // Those uncancellable calls retain their own lock/settlement; joining them here
    // deadlocks the host queue. No continuation may enqueue more HMR or toggle work.
    if (this.pending) this.requireRestart();
  }
}
