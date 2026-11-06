import test from 'node:test';
import assert from 'node:assert/strict';
import { ComputerUseManager } from './core.js';

const VERSION = '0.2.2-rc.1';
const NAMES = ['@deepseek-ai/dsh-computer-use', '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native', '@deepseek-ai/dsh-mcp-client'];
const IDS = ['computer-use', 'computer-use-cua-driver-native'];
const HEALTH = 'cua_driver_native__health_report';
const copy = value => structuredClone(value);
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function fixture(options = {}) {
  const manifests = new Map(NAMES.map(name => [name, { name, version: VERSION }]));
  const configured = IDS.map((id, index) => ({ id, name: NAMES[index], configuredEnabled: options.enabled ?? true }));
  const rows = IDS.map((id, index) => ({ entryId: 'include:' + id, patchId: id, moduleName: NAMES[index], enabled: options.enabled ?? true, fiberPhase: options.enabled === false ? null : 'active' }));
  const calls = [];
  let lock = false;
  let exclusive = false;
  let savedManifests;
  const computerUse = { providerName: options.enabled === false ? undefined : 'cua-driver-native' };
  const report = { overall: 'ok', checks: [{ name: 'platform', status: 'pass', message: 'Ready.' }] };
  let definition = { name: HEALTH, execute: async (_args, execution) => {
    assert.ok(execution.signal instanceof AbortSignal);
    return { structuredContent: copy(report) };
  } };
  const services = {
    computerUse,
    pluginManager: {
      listPlugins: async () => copy(rows),
      setPluginEnabled: async (id, enabled) => {
        assert.equal(lock, false, 'toggle must own its own lock');
        assert.equal(exclusive, false, 'toggle must not nest HMR transactions');
        calls.push(['toggle', id, enabled]);
        const row = rows.find(row => row.entryId === id);
        row.enabled = enabled;
        row.fiberPhase = enabled ? 'active' : null;
        configured.find(item => item.id === row.patchId).configuredEnabled = enabled;
        computerUse.providerName = rows.every(row => row.enabled) ? 'cua-driver-native' : undefined;
        return { application: 'applied' };
      },
    },
    tools: {
      definitions: () => computerUse.providerName ? [definition, { name: 'cua_driver_native__click' }, { name: 'unrelated' }] : [],
      get: name => name === HEALTH && computerUse.providerName ? definition : undefined,
    },
    hmr: {
      runExclusive: async callback => {
        assert.equal(lock, true, 'profile lock must precede HMR');
        assert.equal(exclusive, false, 'HMR must not nest');
        exclusive = true;
        calls.push(['hmr-enter']);
        try { return await callback(); }
        finally { exclusive = false; calls.push(['hmr-exit']); }
      },
      reconcileProfile: async () => {
        assert.equal(lock, true);
        assert.equal(exclusive, true);
        calls.push(['reconcile']);
        return { warnings: [], pending: [] };
      },
    },
  };
  const ctx = { get: name => services[name] };
  const runtime = {
    platform: 'win32',
    version: () => VERSION,
    configured: () => copy(configured),
    manifest: (_ctx, name) => {
      if (!manifests.has(name)) throw new Error('not installed');
      return copy(manifests.get(name));
    },
    compatible: manifest => manifest.compatible !== false,
    lookup: async (_ctx, name, version, signal) => {
      assert.equal(lock, false, 'registry checks must not hold the write lock');
      assert.equal(version, VERSION);
      assert.ok(signal instanceof AbortSignal);
      calls.push(['lookup', name, version]);
      return { exitCode: 0, stdout: JSON.stringify({ name, version }), stderr: '', timedOut: false };
    },
    lock: async (_ctx, callback, signal) => {
      assert.equal(lock, false);
      signal.throwIfAborted();
      lock = true;
      calls.push(['lock']);
      try { return await callback(); }
      finally { lock = false; calls.push(['unlock']); }
    },
    backup: async () => {
      assert.equal(lock, true);
      calls.push(['backup']);
      savedManifests = copy(manifests);
      return [{ path: '/profile/package.json', text: '{}' }, { path: '/profile/pnpm-lock.yaml', text: 'lock' }];
    },
    restore: async () => { assert.equal(lock, true); calls.push(['restore']); },
    run: async (_ctx, args, execution) => {
      assert.equal(lock, true);
      assert.equal(exclusive, false, 'pnpm must run outside the HMR queue');
      calls.push(['run', copy(args)]);
      execution.signal.throwIfAborted();
      if (args[0] === 'add') for (const name of NAMES) manifests.set(name, { name, version: VERSION });
      else {
        manifests.clear();
        for (const [name, value] of savedManifests) manifests.set(name, copy(value));
      }
      return { exitCode: 0, output: '' };
    },
  };
  const manager = new ComputerUseManager(ctx, { runtime, timeouts: { read: 1000, health: 1000, checkUpdates: 1000, setEnabled: 1000, update: 1000, recovery: 1000 }, ...options.managerOptions });
  return { manager, runtime, ctx, services, rows, configured, manifests, calls, report, setDefinition: next => { definition = next; }, isLocked: () => lock };
}

async function finish(manager) {
  await manager.pending;
  return manager.state();
}

async function perform(manager, action, args) {
  const started = await manager.start(action, args);
  assert.equal(started.operation.kind, action);
  assert.equal(started.operation.status, 'running');
  return finish(manager);
}

test('registry lookup failures preserve safe JSON stdout, exit codes and timeout context', async () => {
  const f = fixture();
  f.runtime.lookup = async () => ({ exitCode: 1, stdout: JSON.stringify({ error: { code: 'ECONNRESET', message: 'Connection reset token=sk-private-value' } }), stderr: 'TLS failure', timedOut: false });
  let state = await perform(f.manager, 'checkUpdates');
  assert.match(state.update.reason, /Exit 1/);
  assert.match(state.update.reason, /ECONNRESET/);
  assert.match(state.update.reason, /TLS failure/);
  assert.doesNotMatch(state.update.reason, /sk-private-value/);
  f.runtime.lookup = async () => ({ exitCode: null, stdout: '', stderr: '', timedOut: true });
  state = await perform(f.manager, 'checkUpdates');
  assert.match(state.update.reason, /timed out/);
  assert.match(state.update.reason, /Exit unknown/);
});

test('loads without host peers and returns detached exact-version runtime state', async () => {
  const f = fixture();
  const state = await f.manager.state();
  assert.equal(state.runtimeVersion, VERSION);
  assert.equal(state.platform, 'win32');
  assert.equal(state.status, 'running');
  assert.equal(state.running, true);
  assert.equal(state.configuredEnabled, true);
  assert.equal(state.provider, 'cua-driver-native');
  assert.equal(state.toolCount, 2);
  assert.deepEqual(state.packages.map(pkg => pkg.name), NAMES);
  assert.ok(state.packages.every(pkg => pkg.compatible && pkg.targetVersion === VERSION));
  assert.equal(state.update.status, 'unchecked');
  assert.equal(state.health, null);
  assert.equal(state.operation, null);
  state.packages[0].name = 'changed';
  state.history.push({});
  assert.equal((await f.manager.state()).packages[0].name, NAMES[0]);
  assert.deepEqual((await f.manager.state()).history, []);
});

test('distinguishes configured enablement, runtime waiting, incompatibility, failure and missing packages', async () => {
  const f = fixture();
  f.services.computerUse.providerName = undefined;
  assert.equal((await f.manager.state()).status, 'waiting');
  f.rows[1].enabled = false;
  f.manifests.get(NAMES[1]).version = '0.2.1';
  let state = await f.manager.state();
  assert.equal(state.status, 'incompatible');
  assert.equal(state.configuredEnabled, true, 'compatibility denial must not rewrite desired enablement');
  assert.equal(state.packages[1].compatible, false);
  f.manifests.get(NAMES[1]).version = VERSION;
  f.rows[1].fiberPhase = 'failed';
  f.rows[1].diagnostic = 'Startup failed token=hidden';
  state = await f.manager.state();
  assert.equal(state.status, 'failed');
  assert.doesNotMatch(state.reason, /hidden/);
  f.manifests.delete(NAMES[2]);
  assert.equal((await f.manager.state()).status, 'missing');
  f.manifests.set(NAMES[2], { name: NAMES[2], version: VERSION });
  f.configured[1].configuredEnabled = false;
  assert.equal((await f.manager.state()).status, 'disabled');
});

test('does not treat teardown provider name or an ambiguous configuration as active', async () => {
  const f = fixture();
  f.rows[1].fiberPhase = 'unloading';
  assert.equal((await f.manager.state()).running, false);
  f.configured.push(copy(f.configured[1]));
  const state = await f.manager.state();
  assert.equal(state.status, 'unknown');
  assert.equal(state.configuredEnabled, false);
});

test('enable and disable use inventory identities and dependency-safe order', async () => {
  const f = fixture({ enabled: false });
  let state = await perform(f.manager, 'setEnabled', { enabled: true });
  assert.equal(state.operation.status, 'done');
  assert.equal(state.status, 'running');
  assert.deepEqual(f.calls.filter(call => call[0] === 'toggle'), [['toggle', 'include:' + IDS[0], true], ['toggle', 'include:' + IDS[1], true]]);
  f.calls.length = 0;
  state = await perform(f.manager, 'setEnabled', { enabled: false });
  assert.equal(state.status, 'disabled');
  assert.deepEqual(f.calls.filter(call => call[0] === 'toggle'), [['toggle', 'include:' + IDS[1], false], ['toggle', 'include:' + IDS[0], false]]);
  assert.equal(state.health, null);
});

test('fresh installations require matching packages before explicit capability enablement', async () => {
  const f = fixture({ enabled: false });
  f.manifests.clear();
  assert.equal((await f.manager.state()).status, 'missing');
  let state = await perform(f.manager, 'setEnabled', { enabled: true });
  assert.equal(state.operation.status, 'failed');
  assert.equal(state.configuredEnabled, false);
  assert.equal(f.calls.some(call => call[0] === 'toggle'), false);
  state = await perform(f.manager, 'checkUpdates');
  assert.equal(state.update.status, 'available');
  state = await perform(f.manager, 'update');
  assert.equal(state.operation.status, 'done');
  assert.equal(state.packages.every(pkg => pkg.version === VERSION && pkg.compatible), true);
  assert.equal(state.configuredEnabled, false);
  assert.equal(state.running, false);
  state = await perform(f.manager, 'setEnabled', { enabled: true });
  assert.equal(state.operation.status, 'done');
  assert.equal(state.configuredEnabled, true);
  assert.equal(state.running, true);
});

test('disable persists raw enabled rows even when compatibility disabled runtime rows', async () => {
  const f = fixture();
  f.rows[1].enabled = false;
  f.rows[1].fiberPhase = null;
  f.manifests.get(NAMES[1]).version = '0.2.1';
  const state = await perform(f.manager, 'setEnabled', { enabled: false });
  assert.equal(state.operation.status, 'done');
  assert.ok(f.calls.some(call => call[0] === 'toggle' && call[1] === 'include:' + IDS[1] && call[2] === false));
  assert.equal(f.configured[1].configuredEnabled, false);
});

test('enable refuses incompatible packages and unaddressable rows without mutation', async () => {
  const f = fixture({ enabled: false });
  f.manifests.get(NAMES[1]).compatible = false;
  let state = await perform(f.manager, 'setEnabled', { enabled: true });
  assert.equal(state.operation.status, 'failed');
  assert.equal(f.calls.length, 0);
  f.manifests.get(NAMES[1]).compatible = true;
  f.rows[1].readOnlyReason = 'unaddressable';
  state = await perform(f.manager, 'setEnabled', { enabled: true });
  assert.equal(state.operation.status, 'failed');
  assert.equal(f.calls.length, 0);
});

test('second toggle failure rolls both rows back to saved configuration', async () => {
  const f = fixture({ enabled: false });
  const toggle = f.services.pluginManager.setPluginEnabled;
  let count = 0;
  f.services.pluginManager.setPluginEnabled = async (...args) => ++count === 2 ? { application: 'failed', error: { diagnostic: 'native start failure' } } : toggle(...args);
  const state = await perform(f.manager, 'setEnabled', { enabled: true });
  assert.equal(state.operation.status, 'failed');
  assert.equal(state.configuredEnabled, false);
  assert.ok(f.configured.every(row => row.configuredEnabled === false));
  assert.equal(f.calls.at(-1)[2], false);
});

test('checkUpdates checks only all three exact runtime targets and never mutates', async () => {
  const f = fixture();
  let state = await perform(f.manager, 'checkUpdates');
  assert.equal(state.update.status, 'current');
  assert.deepEqual(f.calls, NAMES.map(name => ['lookup', name, VERSION]));
  f.manifests.get(NAMES[0]).version = '0.2.1';
  state = await perform(f.manager, 'checkUpdates');
  assert.equal(state.update.status, 'available');
  assert.equal(state.update.targetVersion, VERSION);
});

test('registry errors, mismatched identity/version and malformed output block update', async t => {
  for (const [label, result, status] of [
    ['offline', { exitCode: 1, stdout: '', stderr: 'Registry token=secret123 unavailable' }, 'unavailable'],
    ['wrong version', { exitCode: 0, stdout: JSON.stringify({ name: NAMES[0], version: '9.0.0' }) }, 'unavailable'],
    ['wrong name', { exitCode: 0, stdout: JSON.stringify({ name: 'other', version: VERSION }) }, 'unavailable'],
    ['malformed', { exitCode: 0, stdout: 'not-json' }, 'error'],
    ['incompatible', { exitCode: 0, stdout: JSON.stringify({ name: NAMES[0], version: VERSION, compatible: false }) }, 'unavailable'],
  ]) await t.test(label, async () => {
    const f = fixture();
    f.runtime.lookup = async () => result;
    const state = await perform(f.manager, 'update');
    assert.equal(state.update.status, status);
    assert.equal(state.operation.status, 'failed');
    assert.equal(f.calls.length, 0);
    assert.doesNotMatch(JSON.stringify(state), /secret123/);
  });
});

test('update installs only exact fixed specs without scripts and reconciles under lock', async () => {
  const f = fixture();
  f.manifests.get(NAMES[0]).version = '0.2.1';
  const state = await perform(f.manager, 'update');
  assert.equal(state.operation.status, 'done');
  assert.equal(state.update.status, 'current');
  assert.deepEqual(f.calls.filter(call => call[0] === 'run'), [['run', ['add', '--save-exact', '--ignore-scripts', ...NAMES.map(name => name + '@' + VERSION)]]]);
  assert.deepEqual(f.calls.slice(3).map(call => call[0]), ['lock', 'backup', 'run', 'hmr-enter', 'reconcile', 'hmr-exit', 'unlock']);
  assert.equal(f.isLocked(), false);
});

test('pending HMR changes and missing HMR report restart-required without false activation claims', async t => {
  for (const hmr of ['pending', 'absent']) await t.test(hmr, async () => {
    const f = fixture();
    if (hmr === 'absent') delete f.services.hmr;
    else f.services.hmr.reconcileProfile = async () => ({ warnings: [], pending: [{ reason: 'host-module', url: 'module' }] });
    const state = await perform(f.manager, 'update');
    assert.equal(state.operation.status, 'restart-required');
    assert.equal(state.restartRequired, true);
    assert.equal(state.update.status, 'current');
  });
});

test('nonzero package update restores metadata and reinstalls saved dependencies before unlocking', async () => {
  const f = fixture();
  f.manifests.get(NAMES[0]).version = '0.2.1';
  const run = f.runtime.run;
  f.runtime.run = async (...args) => {
    const result = await run(...args);
    return args[1][0] === 'add' ? { exitCode: 1, output: 'failed token=do-not-expose' } : result;
  };
  const state = await perform(f.manager, 'update');
  assert.equal(state.operation.status, 'failed');
  assert.match(state.operation.message, /were restored/);
  assert.equal(state.packages[0].version, '0.2.1');
  assert.deepEqual(f.calls.filter(call => call[0] === 'run')[1], ['run', ['install', '--frozen-lockfile', '--ignore-scripts']]);
  assert.equal(f.calls.filter(call => call[0] === 'restore').length, 2);
  assert.equal(f.calls.at(-1)[0], 'unlock');
  assert.doesNotMatch(JSON.stringify(state), /do-not-expose/);
});

test('postinstall validation and HMR failure also recover previous dependencies', async t => {
  for (const failure of ['metadata', 'hmr']) await t.test(failure, async () => {
    const f = fixture();
    const run = f.runtime.run;
    f.runtime.run = async (...args) => {
      const result = await run(...args);
      if (failure === 'metadata' && args[1][0] === 'add') f.manifests.get(NAMES[0]).version = '9.0.0';
      return result;
    };
    let reconciles = 0;
    f.services.hmr.reconcileProfile = async () => {
      if (failure === 'hmr' && ++reconciles === 1) throw new Error('HMR failure');
      return { pending: [], warnings: [] };
    };
    const state = await perform(f.manager, 'update');
    assert.equal(state.operation.status, 'failed');
    assert.match(state.operation.message, /were restored/);
    assert.equal(state.packages[0].version, VERSION);
  });
});

test('recovery failure stays failed, requires restart, and does not claim rollback', async () => {
  const f = fixture();
  const run = f.runtime.run;
  f.runtime.run = async (...args) => { await run(...args); return { exitCode: 1, output: 'failure' }; };
  const state = await perform(f.manager, 'update');
  assert.equal(state.operation.status, 'failed');
  assert.match(state.operation.message, /Recovery is incomplete/);
  assert.equal(state.restartRequired, true);
  assert.equal(f.calls.filter(call => call[0] === 'restore').length, 2);
});

test('all operations are nonblocking and concurrency is rejected until the underlying operation settles', async () => {
  const f = fixture();
  const entered = deferred();
  const release = deferred();
  const run = f.runtime.run;
  f.runtime.run = async (...args) => {
    if (args[1][0] === 'add') { entered.resolve(); await release.promise; }
    return run(...args);
  };
  const started = await f.manager.start('update');
  assert.equal(started.operation.status, 'running');
  await entered.promise;
  await assert.rejects(f.manager.start('health'), error => error.code === 'busy');
  await assert.rejects(f.manager.start('setEnabled', { enabled: false }), error => error.code === 'busy');
  assert.equal(f.isLocked(), true);
  release.resolve();
  assert.equal((await finish(f.manager)).operation.status, 'done');
});

test('timeout cancels package work but preserves serialization through independent recovery', async () => {
  const f = fixture({ managerOptions: { timeouts: { read: 100, update: 25, recovery: 100 } } });
  const entered = deferred();
  const recoveryEntered = deferred();
  const releaseRecovery = deferred();
  const run = f.runtime.run;
  f.runtime.run = async (...args) => {
    if (args[1][0] === 'add') {
      entered.resolve();
      return new Promise((_, reject) => args[2].signal.addEventListener('abort', () => reject(args[2].signal.reason), { once: true }));
    }
    assert.equal(args[2].signal.aborted, false, 'recovery gets a fresh deadline');
    recoveryEntered.resolve();
    await releaseRecovery.promise;
    return run(...args);
  };
  await f.manager.start('update');
  await entered.promise;
  await recoveryEntered.promise;
  await assert.rejects(f.manager.start('checkUpdates'), error => error.code === 'busy');
  releaseRecovery.resolve();
  const state = await finish(f.manager);
  assert.equal(state.operation.status, 'failed');
  assert.match(state.operation.message, /time limit/);
  assert.match(state.operation.message, /were restored/);
  assert.equal(f.isLocked(), false);
});

test('health uses only the registered native report tool and accepts structured/text reports', async () => {
  const f = fixture();
  let state = await perform(f.manager, 'health');
  assert.equal(state.operation.status, 'done');
  assert.equal(state.health.overall, 'ok');
  assert.deepEqual(state.health.checks, f.report.checks);
  f.setDefinition({ name: HEALTH, execute: async () => ({ content: [{ type: 'text', text: JSON.stringify({ overall: 'degraded', checks: [{ name: 'capture', status: 'fail', message: 'token=secret123' }] }) }] }) });
  state = await perform(f.manager, 'health');
  assert.equal(state.health.overall, 'degraded');
  assert.doesNotMatch(JSON.stringify(state.health), /secret123/);
  assert.deepEqual(f.calls, []);
});

test('health cannot run while disabled, rejects invalid reports and stale provider results', async t => {
  for (const scenario of ['disabled', 'invalid', 'stale']) await t.test(scenario, async () => {
    const f = fixture({ enabled: scenario !== 'disabled' });
    if (scenario === 'invalid') f.setDefinition({ name: HEALTH, execute: async () => ({ content: [{ type: 'text', text: 'not a report' }] }) });
    if (scenario === 'stale') f.setDefinition({ name: HEALTH, execute: async () => {
      f.services.computerUse.providerName = undefined;
      return { structuredContent: f.report };
    } });
    const state = await perform(f.manager, 'health');
    assert.equal(state.operation.status, 'failed');
    assert.equal(state.health.overall, 'unavailable');
  });
});

test('health timeout delivers abort and never reports success', async () => {
  const f = fixture({ managerOptions: { timeouts: { read: 100, health: 20 } } });
  let signal;
  f.setDefinition({ name: HEALTH, execute: async (_args, execution) => {
    signal = execution.signal;
    return new Promise(() => {});
  } });
  const state = await perform(f.manager, 'health');
  assert.equal(signal.aborted, true);
  assert.equal(state.operation.status, 'failed');
  assert.equal(state.health.overall, 'unavailable');
});

test('public output is bounded and scrubs credentials, tokens, URL queries, ANSI and control characters', async () => {
  const f = fixture();
  const run = f.runtime.run;
  f.runtime.run = async (...args) => {
    args[2].onOutput('x'.repeat(12000) + '\nhttps://person:password123@example.com/path?key=query123&other=hidden123 token=tok123 npm_abc123 sk-abc123 authorization: Bearer abc123\u001b[31m\u0000');
    return run(...args);
  };
  const state = await perform(f.manager, 'update');
  assert.ok(state.operation.log.length <= 8192);
  assert.doesNotMatch(state.operation.log, /password123|query123|hidden123|tok123|npm_abc123|sk-abc123|abc123|\u001b|\u0000/);
  assert.match(state.operation.log, /redacted/);
});

test('rejects arbitrary package/version/command arguments and unknown actions', async () => {
  const f = fixture();
  for (const args of [{ version: 'latest' }, { packages: ['other'] }, { command: 'anything' }, { action: 'health' }]) await assert.rejects(f.manager.start('update', args), /Invalid action arguments/);
  await assert.rejects(f.manager.start('setEnabled', { enabled: 'true' }), /Invalid action arguments/);
  await assert.rejects(f.manager.start('unknown'), /Unknown action/);
  assert.equal(f.calls.length, 0);
});

test('bounded state reads preserve unknown rather than stale running success', async () => {
  const f = fixture({ managerOptions: { timeouts: { read: 15 } } });
  assert.equal((await f.manager.state()).running, true);
  f.services.pluginManager.listPlugins = () => new Promise(() => {});
  const state = await f.manager.state();
  assert.equal(state.status, 'unknown');
  assert.equal(state.running, false);
  assert.match(state.reason, /timed out/);
});

test('history is bounded, detached, and latest-first', async () => {
  const f = fixture();
  for (let index = 0; index < 36; index++) await perform(f.manager, 'health');
  const state = await f.manager.state();
  assert.equal(state.history.length, 32);
  assert.equal(state.history[0].kind, 'health');
  state.history[0].message = 'changed';
  assert.notEqual((await f.manager.state()).history[0].message, 'changed');
});

test('dispose aborts active reads, awaits settlement, and prevents subsequent actions', async () => {
  const f = fixture();
  const entered = deferred();
  let signal;
  f.runtime.lookup = async (_ctx, _name, _version, executionSignal) => {
    signal = executionSignal;
    entered.resolve();
    return new Promise(() => {});
  };
  await f.manager.start('checkUpdates');
  await entered.promise;
  await f.manager.dispose();
  assert.equal(signal.aborted, true);
  assert.equal((await f.manager.state()).operation.status, 'failed');
  await assert.rejects(f.manager.start('health'), error => error.code === 'disposed');
  await f.manager.dispose();
});

test('unknown configured state is explicit without violating the boolean enabled contract', async () => {
  const f = fixture();
  assert.equal((await f.manager.state()).configurationKnown, true);
  f.configured[1].configuredEnabled = null;
  const state = await f.manager.state();
  assert.equal(state.configurationKnown, false);
  assert.equal(state.status, 'unknown');
  assert.equal(typeof state.configuredEnabled, 'boolean');
});

test('external disable, native reload and on-disk package changes invalidate cached successful health', async t => {
  for (const scenario of ['disable', 'reload', 'version']) await t.test(scenario, async () => {
    const f = fixture();
    assert.equal((await perform(f.manager, 'health')).health.overall, 'ok');
    if (scenario === 'disable') {
      f.services.computerUse.providerName = undefined;
      f.configured[1].configuredEnabled = false;
      f.rows[1].fiberPhase = null;
    } else if (scenario === 'reload') f.setDefinition({ name: HEALTH, execute: async () => ({ structuredContent: f.report }) });
    else f.manifests.get(NAMES[1]).version = '0.2.1';
    assert.equal((await f.manager.state()).health, null);
  });
});

test('update preserves intentional disablement and passes only desired active IDs to HMR', async () => {
  const f = fixture({ enabled: false });
  let requiredIds;
  f.services.hmr.reconcileProfile = async ids => { requiredIds = ids; return { pending: [], warnings: [] }; };
  const state = await perform(f.manager, 'update');
  assert.equal(state.operation.status, 'done');
  assert.equal(state.configuredEnabled, false);
  assert.equal(state.running, false);
  assert.deepEqual(requiredIds, []);
  assert.equal(f.calls.some(call => call[0] === 'toggle'), false);
});

test('enabled native activation failure after update is not reported as success and recovers', async () => {
  const f = fixture();
  let reconciles = 0;
  f.services.hmr.reconcileProfile = async requiredIds => {
    assert.deepEqual(requiredIds, IDS);
    reconciles++;
    f.rows[1].fiberPhase = reconciles === 1 ? 'failed' : 'active';
    f.rows[1].diagnostic = 'Driver activation failed.';
    f.services.computerUse.providerName = reconciles === 1 ? undefined : 'cua-driver-native';
    return { pending: [], warnings: ['Driver activation warning.'] };
  };
  const state = await perform(f.manager, 'update');
  assert.equal(state.operation.status, 'failed');
  assert.match(state.operation.message, /did not become active/);
  assert.match(state.operation.message, /were restored/);
  assert.equal(reconciles, 2);
});

test('profiles without an original lockfile recover without creating a new lockfile', async () => {
  const f = fixture();
  const backup = f.runtime.backup;
  f.runtime.backup = async (...args) => { const files = await backup(...args); files[1].text = null; return files; };
  const run = f.runtime.run;
  f.runtime.run = async (...args) => {
    const result = await run(...args);
    return args[1][0] === 'add' ? { exitCode: 1, output: 'failed' } : result;
  };
  await perform(f.manager, 'update');
  assert.deepEqual(f.calls.filter(call => call[0] === 'run')[1][1], ['install', '--config.lockfile=false', '--ignore-scripts']);
});

test('an uncancellable host toggle cannot free the operation slot on timeout', async () => {
  const f = fixture({ enabled: false, managerOptions: { timeouts: { read: 100, setEnabled: 20 } } });
  const entered = deferred();
  const timedOut = deferred();
  const release = deferred();
  const toggle = f.services.pluginManager.setPluginEnabled;
  let first = true;
  f.services.pluginManager.setPluginEnabled = async (...args) => {
    if (first) {
      first = false;
      entered.resolve();
      f.manager.controller.signal.addEventListener('abort', () => timedOut.resolve(), { once: true });
      await release.promise;
    }
    return toggle(...args);
  };
  await f.manager.start('setEnabled', { enabled: true });
  await entered.promise;
  await timedOut.promise;
  assert.equal((await f.manager.state()).operation.status, 'running');
  await assert.rejects(f.manager.start('update'), error => error.code === 'busy');
  release.resolve();
  const state = await finish(f.manager);
  assert.equal(state.operation.status, 'failed');
  assert.ok(f.configured.every(row => row.configuredEnabled === false));
});

test('oversized partial log lines cannot expose the tail of a split credential', async () => {
  const f = fixture();
  await perform(f.manager, 'health');
  f.manager.append('token=' + 'secret123'.repeat(6000));
  f.manager.append('credential-tail');
  f.manager.append('\nNormal line.\n');
  const state = await f.manager.state();
  assert.equal(state.operation.log, 'Normal line.\n');
  assert.doesNotMatch(state.operation.log, /secret123|credential-tail/);
});

async function requestApproval(f) {
  const state = await perform(f.manager, 'activate');
  assert.equal(state.operation.status, 'needs-confirmation');
  assert.equal(state.operation.phase, 'checking');
  assert.equal(state.operation.confirmation.version, VERSION);
  assert.deepEqual(state.operation.confirmation.packages, NAMES);
  assert.equal(f.calls.some(call => ['run', 'toggle', 'lock', 'backup', 'restore'].includes(call[0])), false);
  return { installVersion: state.operation.confirmation.version, approvalId: state.operation.confirmation.approvalId };
}

function activationFixture(options = {}) {
  const timeouts = { read: 200, health: 100, activate: 1000, readiness: 30, poll: 1, recovery: 200 };
  return fixture({ enabled: false, ...options, managerOptions: { ...options.managerOptions, timeouts: { ...timeouts, ...options.managerOptions?.timeouts } } });
}

test('compatible activation skips registry/install and enables, waits and checks health in one operation', async () => {
  const f = activationFixture();
  const phases = [];
  const toggle = f.services.pluginManager.setPluginEnabled;
  f.services.pluginManager.setPluginEnabled = async (...args) => { phases.push(f.manager.value.operation.phase); return toggle(...args); };
  f.runtime.lookup = async () => { throw new Error('network must not be used'); };
  f.runtime.run = async () => { throw new Error('installer must not be used'); };
  f.setDefinition({ name: HEALTH, execute: async (_args, { signal }) => {
    signal.throwIfAborted();
    phases.push(f.manager.value.operation.phase);
    return { structuredContent: f.report };
  } });
  const started = await f.manager.start('activate');
  assert.equal(started.operation.status, 'running');
  assert.equal(started.operation.phase, 'checking');
  const state = await finish(f.manager);
  assert.equal(state.operation.status, 'done');
  assert.equal(state.operation.phase, 'health');
  assert.equal(state.running, true);
  assert.equal(state.configuredEnabled, true);
  assert.equal(state.health.overall, 'ok');
  assert.deepEqual(phases, ['enabling', 'enabling', 'health']);
  assert.equal(f.calls.filter(call => call[0] === 'toggle').length, 2);
});

test('missing or mismatched activation requests approval with no write or capability change', async t => {
  for (const scenario of ['missing', 'mismatch']) await t.test(scenario, async () => {
    const f = activationFixture();
    if (scenario === 'missing') for (const name of NAMES) f.manifests.delete(name);
    else f.manifests.get(NAMES[1]).version = '0.2.1';
    const approval = await requestApproval(f);
    assert.ok(approval.approvalId.length >= 16);
    assert.deepEqual(f.calls, NAMES.map(name => ['lookup', name, VERSION]));
    assert.ok(f.configured.every(row => !row.configuredEnabled));
    assert.equal((await f.manager.state()).running, false);
  });
});

test('approved fresh installation installs exact targets, then enables and checks health', async () => {
  const f = activationFixture();
  for (const name of NAMES) f.manifests.delete(name);
  const approval = await requestApproval(f);
  const phases = [];
  const run = f.runtime.run;
  f.runtime.run = async (...args) => { phases.push(f.manager.value.operation.phase); return run(...args); };
  const toggle = f.services.pluginManager.setPluginEnabled;
  f.services.pluginManager.setPluginEnabled = async (...args) => { phases.push(f.manager.value.operation.phase); return toggle(...args); };
  let healthCalls = 0;
  f.setDefinition({ name: HEALTH, execute: async () => { phases.push(f.manager.value.operation.phase); healthCalls++; return { structuredContent: f.report }; } });
  const state = await perform(f.manager, 'activate', approval);
  assert.equal(state.operation.status, 'done');
  assert.equal(state.health.overall, 'ok');
  assert.equal(healthCalls, 1);
  assert.deepEqual(phases, ['installing', 'enabling', 'enabling', 'health']);
  assert.deepEqual(f.calls.find(call => call[0] === 'run')[1], ['add', '--save-exact', '--ignore-scripts', ...NAMES.map(name => name + '@' + VERSION)]);
  assert.equal(state.configuredEnabled, true);
  assert.equal(state.running, true);
  assert.equal(state.operation.confirmation, undefined);
});

test('activation waits for real native readiness instead of assuming enabled means running', async () => {
  const f = activationFixture();
  const toggle = f.services.pluginManager.setPluginEnabled;
  f.services.pluginManager.setPluginEnabled = async (...args) => {
    const result = await toggle(...args);
    if (args[0] === 'include:' + IDS[1] && args[1]) {
      f.rows[1].fiberPhase = 'loading';
      f.services.computerUse.providerName = undefined;
    }
    return result;
  };
  let polls = 0;
  f.services.pluginManager.listPlugins = async () => {
    if (f.manager.value.operation?.phase === 'waiting' && ++polls === 3) {
      f.rows[1].fiberPhase = 'active';
      f.services.computerUse.providerName = 'cua-driver-native';
    }
    return copy(f.rows);
  };
  const state = await perform(f.manager, 'activate');
  assert.equal(state.operation.status, 'done');
  assert.ok(polls >= 3);
  assert.equal(state.running, true);
});

test('approval rejects absent, wrong ID, wrong version, expired, stale, cross-instance and host-version-changed consent', async t => {
  for (const scenario of ['absent', 'wrong-id', 'wrong-version', 'expired', 'stale', 'cross-instance', 'host-version']) await t.test(scenario, async () => {
    let clock = 1000;
    let f = activationFixture({ managerOptions: { clock: () => clock } });
    f.manifests.delete(NAMES[1]);
    let approval = { installVersion: VERSION, approvalId: 'not-approved' };
    if (scenario !== 'absent') approval = await requestApproval(f);
    if (scenario === 'wrong-id') approval.approvalId = 'different-approval';
    if (scenario === 'wrong-version') approval.installVersion = '9.0.0';
    if (scenario === 'expired') clock += 5 * 60 * 1000;
    if (scenario === 'stale') await requestApproval(f);
    if (scenario === 'cross-instance') {
      f = activationFixture();
      f.manifests.delete(NAMES[1]);
    }
    if (scenario === 'host-version') f.runtime.version = () => '0.2.3';
    f.calls.length = 0;
    const state = await perform(f.manager, 'activate', approval);
    assert.equal(state.operation.status, 'failed');
    assert.match(state.operation.message, /approval/i);
    assert.equal(f.calls.length, 0, 'invalid approval must not perform network, package or capability actions');
    assert.ok(f.configured.every(row => !row.configuredEnabled));
  });
});

test('installation approvals are one-use, invalidated by another operation, and never survive dispose', async t => {
  for (const scenario of ['reused', 'other-operation', 'disposed']) await t.test(scenario, async () => {
    const f = activationFixture();
    f.manifests.delete(NAMES[1]);
    const approval = await requestApproval(f);
    if (scenario === 'reused') assert.equal((await perform(f.manager, 'activate', approval)).operation.status, 'done');
    if (scenario === 'other-operation') await perform(f.manager, 'checkUpdates');
    f.calls.length = 0;
    if (scenario === 'disposed') {
      await f.manager.dispose();
      await assert.rejects(f.manager.start('activate', approval), error => error.code === 'disposed');
    } else {
      const state = await perform(f.manager, 'activate', approval);
      assert.equal(state.operation.status, 'failed');
      assert.match(state.operation.message, /approval/i);
    }
    assert.equal(f.calls.length, 0);
  });
});

test('activation cannot issue consent if registry validation fails or host version changes during preflight', async t => {
  for (const scenario of ['registry', 'host-version']) await t.test(scenario, async () => {
    const f = activationFixture();
    f.manifests.delete(NAMES[1]);
    const lookup = f.runtime.lookup;
    f.runtime.lookup = async (...args) => {
      if (scenario === 'registry') return { exitCode: 1, stdout: JSON.stringify({ error: { code: 'ERR_PNPM_FETCH_404', message: 'Unavailable' } }), stderr: '' };
      const result = await lookup(...args);
      if (args[1] === NAMES[2]) f.runtime.version = () => '0.2.3';
      return result;
    };
    const state = await perform(f.manager, 'activate');
    assert.equal(state.operation.status, 'failed');
    assert.equal(state.operation.confirmation, undefined);
    assert.equal(f.calls.some(call => ['run', 'toggle', 'lock'].includes(call[0])), false);
  });
});

test('approved install failure never proceeds to enablement or health and consumes approval', async () => {
  const f = activationFixture();
  f.manifests.delete(NAMES[1]);
  const approval = await requestApproval(f);
  const run = f.runtime.run;
  f.runtime.run = async (...args) => {
    const result = await run(...args);
    return args[1][0] === 'add' ? { exitCode: 1, output: 'Installation failed.' } : result;
  };
  f.setDefinition({ name: HEALTH, execute: async () => { throw new Error('must not run health'); } });
  const state = await perform(f.manager, 'activate', approval);
  assert.equal(state.operation.status, 'failed');
  assert.equal(state.running, false);
  assert.equal(state.health, null);
  assert.ok(f.configured.every(row => !row.configuredEnabled));
  assert.equal(f.calls.some(call => call[0] === 'toggle'), false);
  f.calls.length = 0;
  assert.equal((await perform(f.manager, 'activate', approval)).operation.status, 'failed');
  assert.equal(f.calls.length, 0);
});

test('startup failure restores precisely every prior combination of saved enablement', async t => {
  for (const previous of [[false, false], [true, false], [false, true], [true, true]]) await t.test(previous.join('/'), async () => {
    const f = activationFixture();
    for (let index = 0; index < 2; index++) {
      f.configured[index].configuredEnabled = previous[index];
      f.rows[index].enabled = previous[index];
      f.rows[index].fiberPhase = previous[index] ? 'active' : null;
    }
    f.rows[1].fiberPhase = 'failed';
    const toggle = f.services.pluginManager.setPluginEnabled;
    f.services.pluginManager.setPluginEnabled = async (...args) => {
      const result = await toggle(...args);
      if (args[1]) { f.rows[1].fiberPhase = 'failed'; f.services.computerUse.providerName = undefined; }
      return result;
    };
    const state = await perform(f.manager, 'activate');
    assert.equal(state.operation.status, 'failed');
    assert.match(state.operation.message, /Previous enablement was restored/);
    assert.deepEqual(f.configured.map(row => row.configuredEnabled), previous);
    if (previous[0] && !previous[1]) assert.equal(f.calls.some(call => call[0] === 'toggle' && call[1] === 'include:' + IDS[0] && call[2] === false), false, 'main=true/provider=false must not disable main');
  });
});

test('readiness timeout restores saved rows without reporting healthy activation', async () => {
  const f = activationFixture({ managerOptions: { timeouts: { readiness: 10 } } });
  const toggle = f.services.pluginManager.setPluginEnabled;
  f.services.pluginManager.setPluginEnabled = async (...args) => {
    const result = await toggle(...args);
    if (args[1]) { f.rows[1].fiberPhase = 'loading'; f.services.computerUse.providerName = undefined; }
    return result;
  };
  const state = await perform(f.manager, 'activate');
  assert.equal(state.operation.status, 'failed');
  assert.match(state.operation.message, /startup timeout/);
  assert.deepEqual(f.configured.map(row => row.configuredEnabled), [false, false]);
  assert.equal(state.health, null);
});

test('health degraded, failed, malformed, thrown and timed out produce warnings without disabling', async t => {
  for (const scenario of ['degraded', 'failed', 'malformed', 'thrown', 'timeout']) await t.test(scenario, async () => {
    const f = activationFixture({ managerOptions: { timeouts: { health: 10 } } });
    f.setDefinition({ name: HEALTH, execute: async () => {
      if (scenario === 'thrown') throw new Error('Diagnostics unavailable.');
      if (scenario === 'timeout') return new Promise(() => {});
      if (scenario === 'malformed') return { content: [{ type: 'text', text: 'not-json' }] };
      return { structuredContent: { ...f.report, overall: scenario } };
    } });
    const state = await perform(f.manager, 'activate');
    assert.equal(state.operation.status, 'warning');
    assert.equal(state.configuredEnabled, true);
    assert.equal(state.running, true);
    assert.equal(state.health.overall, ['degraded', 'failed'].includes(scenario) ? scenario : 'unavailable');
    assert.equal(f.calls.some(call => call[0] === 'toggle' && call[2] === false), false);
  });
});

test('restart-required from enablement or installation saves desired state and skips health', async t => {
  for (const scenario of ['enable', 'install']) await t.test(scenario, async () => {
    const f = activationFixture();
    let approval;
    if (scenario === 'install') {
      f.manifests.delete(NAMES[1]);
      approval = await requestApproval(f);
      f.services.hmr.reconcileProfile = async () => ({ pending: [{ reason: 'host-module' }], warnings: [] });
    } else {
      const toggle = f.services.pluginManager.setPluginEnabled;
      f.services.pluginManager.setPluginEnabled = async (...args) => { await toggle(...args); return { application: 'restart-required' }; };
    }
    let healthCalls = 0;
    f.setDefinition({ name: HEALTH, execute: async () => { healthCalls++; return { structuredContent: f.report }; } });
    const state = await perform(f.manager, 'activate', approval);
    assert.equal(state.operation.status, 'restart-required');
    assert.equal(state.restartRequired, true);
    assert.equal(state.configuredEnabled, true);
    assert.equal(healthCalls, 0);
    assert.equal(state.health, null);
  });
});

test('activation validates persistent rows before any mutation or registry request', async t => {
  for (const scenario of ['missing', 'expression', 'duplicate']) await t.test(scenario, async () => {
    const f = activationFixture();
    f.manifests.delete(NAMES[1]);
    if (scenario === 'missing') f.configured.pop();
    if (scenario === 'expression') f.configured[1].configuredEnabled = null;
    if (scenario === 'duplicate') f.configured.push(copy(f.configured[1]));
    const state = await perform(f.manager, 'activate');
    assert.equal(state.operation.status, 'failed');
    assert.equal(f.calls.length, 0);
  });
});

test('activation serializes through uncancellable recovery and preserves independent cleanup after abort', async () => {
  const f = activationFixture();
  f.configured[0].configuredEnabled = true;
  f.rows[0].enabled = true;
  f.rows[0].fiberPhase = 'active';
  const cleanupEntered = deferred();
  const releaseCleanup = deferred();
  const toggle = f.services.pluginManager.setPluginEnabled;
  f.services.pluginManager.setPluginEnabled = async (...args) => {
    if (!args[1]) {
      assert.equal(f.manager.controller.signal.aborted, true);
      cleanupEntered.resolve();
      await releaseCleanup.promise;
    }
    const result = await toggle(...args);
    if (args[1]) {
      f.rows[1].fiberPhase = 'loading';
      f.services.computerUse.providerName = undefined;
      f.manager.controller.abort(new Error('Activation cancelled.'));
    }
    return result;
  };
  await f.manager.start('activate');
  await cleanupEntered.promise;
  assert.equal((await f.manager.state()).operation.status, 'running');
  await assert.rejects(f.manager.start('activate'), error => error.code === 'busy');
  await assert.rejects(f.manager.start('setEnabled', { enabled: false }), error => error.code === 'busy');
  releaseCleanup.resolve();
  const state = await finish(f.manager);
  assert.equal(state.operation.status, 'failed');
  assert.match(state.operation.message, /cancelled/i);
  assert.deepEqual(f.configured.map(row => row.configuredEnabled), [true, false]);
});

test('activation cleanup failure is explicit and requires restart instead of claiming restoration', async () => {
  const f = activationFixture();
  const toggle = f.services.pluginManager.setPluginEnabled;
  f.services.pluginManager.setPluginEnabled = async (...args) => {
    if (!args[1]) throw new Error('Cleanup failed.');
    const result = await toggle(...args);
    f.rows[1].fiberPhase = 'failed';
    f.services.computerUse.providerName = undefined;
    return result;
  };
  const state = await perform(f.manager, 'activate');
  assert.equal(state.operation.status, 'failed');
  assert.equal(state.restartRequired, true);
  assert.match(state.operation.message, /recovery is incomplete/);
  assert.doesNotMatch(state.operation.message, /enablement was restored/);
});

test('activation cancellation during preflight or health never continues to further actions', async t => {
  for (const scenario of ['preflight', 'health']) await t.test(scenario, async () => {
    const f = activationFixture();
    const entered = deferred();
    if (scenario === 'preflight') {
      f.manifests.delete(NAMES[1]);
      f.runtime.lookup = async () => { entered.resolve(); return new Promise(() => {}); };
    } else f.setDefinition({ name: HEALTH, execute: async () => { entered.resolve(); return new Promise(() => {}); } });
    await f.manager.start('activate');
    await entered.promise;
    await f.manager.dispose();
    const state = await f.manager.state();
    assert.equal(state.operation.status, 'failed');
    assert.equal(state.operation.confirmation, undefined);
    assert.deepEqual(f.configured.map(row => row.configuredEnabled), [false, false]);
    if (scenario === 'preflight') assert.equal(f.calls.some(call => ['run', 'toggle'].includes(call[0])), false);
  });
});

test('activation approval arguments reject unpaired, malformed, oversized and arbitrary fields', async () => {
  const f = activationFixture();
  for (const args of [{ installVersion: VERSION }, { approvalId: 'id' }, { installVersion: null, approvalId: 'id' },
    { installVersion: VERSION, approvalId: 1 }, { installVersion: '', approvalId: 'id' },
    { installVersion: VERSION, approvalId: ' ' }, { installVersion: 'v'.repeat(121), approvalId: 'id' },
    { installVersion: VERSION, approvalId: 'i'.repeat(161) }, { enabled: true }, { version: 'latest' }, { packages: NAMES }]) {
    await assert.rejects(f.manager.start('activate', args), /Invalid/);
  }
  assert.equal(f.calls.length, 0);
});

test('known installation restart preserves saved enablement when old runtime reports overridden', async () => {
  const f = activationFixture();
  f.manifests.delete(NAMES[1]);
  const approval = await requestApproval(f);
  f.services.hmr.reconcileProfile = async () => ({ pending: [{ reason: 'package-moved' }], warnings: [] });
  f.services.pluginManager.setPluginEnabled = async (id, enabled) => {
    f.calls.push(['toggle', id, enabled]);
    f.configured.find(row => 'include:' + row.id === id).configuredEnabled = enabled;
    return { application: 'overridden' };
  };
  let healthCalls = 0;
  f.setDefinition({ name: HEALTH, execute: async () => { healthCalls++; return { structuredContent: f.report }; } });
  const state = await perform(f.manager, 'activate', approval);
  assert.equal(state.operation.status, 'restart-required');
  assert.deepEqual(f.configured.map(row => row.configuredEnabled), [true, true]);
  assert.equal(state.running, false, 'old disabled runtime is not reported active');
  assert.equal(state.restartRequired, true);
  assert.equal(healthCalls, 0);
  assert.equal(f.calls.some(call => call[0] === 'toggle' && !call[2]), false);
});

test('pending restart never hides a genuine configured override or a general toggle failure', async t => {
  for (const scenario of ['override', 'failed']) await t.test(scenario, async () => {
    const f = activationFixture();
    f.manifests.delete(NAMES[1]);
    const approval = await requestApproval(f);
    f.services.hmr.reconcileProfile = async () => ({ pending: [{ reason: 'package-moved' }], warnings: [] });
    const toggle = f.services.pluginManager.setPluginEnabled;
    f.services.pluginManager.setPluginEnabled = async (...args) => {
      if (args[0] !== 'include:' + IDS[1] || !args[1]) return toggle(...args);
      f.calls.push(['toggle', ...args]);
      if (scenario === 'override') return { application: 'overridden' };
      f.configured[1].configuredEnabled = true;
      return { application: 'failed', error: { diagnostic: 'Native enablement failed.' } };
    };
    const state = await perform(f.manager, 'activate', approval);
    assert.equal(state.operation.status, 'failed');
    assert.equal(state.health, null);
    if (scenario === 'override') {
      assert.equal(state.operation.code, 'configuration_changed');
      assert.equal(f.configured[1].configuredEnabled, false);
    } else {
      assert.match(state.operation.message, /Native enablement failed/);
      assert.deepEqual(f.configured.map(row => row.configuredEnabled), [false, false]);
    }
  });
});

test('low-level toggle still rejects overridden results even if a previous restart flag exists', async () => {
  const f = activationFixture();
  f.manager.value.restartRequired = true;
  const toggle = f.services.pluginManager.setPluginEnabled;
  f.services.pluginManager.setPluginEnabled = async (...args) => { await toggle(...args); return { application: args[1] ? 'overridden' : 'applied' }; };
  const state = await perform(f.manager, 'setEnabled', { enabled: true });
  assert.equal(state.operation.status, 'failed');
  assert.deepEqual(f.configured.map(row => row.configuredEnabled), [false, false]);
});

test('compatible activation retries already-enabled failed or fiberless rows through the official toggle API', async t => {
  for (const phase of ['failed', null]) await t.test(String(phase), async () => {
    const f = activationFixture({ enabled: true });
    f.rows[0].fiberPhase = phase;
    f.rows[1].fiberPhase = phase;
    f.services.computerUse.providerName = undefined;
    f.runtime.lookup = async () => { throw new Error('must stay offline'); };
    const state = await perform(f.manager, 'activate');
    assert.equal(state.operation.status, 'done');
    assert.equal(state.running, true);
    assert.equal(state.health.overall, 'ok');
    assert.deepEqual(f.calls.filter(call => call[0] === 'toggle'), [['toggle', 'include:' + IDS[0], true], ['toggle', 'include:' + IDS[1], true]]);
  });
});

test('already-enabled failed rows are not redundantly retried after a known installation restart', async () => {
  const f = activationFixture({ enabled: true });
  f.rows[1].fiberPhase = 'failed';
  f.services.computerUse.providerName = undefined;
  f.manifests.delete(NAMES[1]);
  const approval = await requestApproval(f);
  f.services.hmr.reconcileProfile = async () => ({ pending: [{ reason: 'package-moved' }], warnings: [] });
  const state = await perform(f.manager, 'activate', approval);
  assert.equal(state.operation.status, 'restart-required');
  assert.equal(f.calls.some(call => call[0] === 'toggle'), false);
  assert.equal(state.health, null);
});

test('external disable during readiness or health is preserved and never reported as enabled success', async t => {
  for (const scenario of ['readiness', 'health']) await t.test(scenario, async () => {
    const f = activationFixture();
    const disable = () => {
      f.configured[1].configuredEnabled = false;
      f.rows[1].enabled = false;
      f.rows[1].fiberPhase = null;
      f.services.computerUse.providerName = undefined;
    };
    if (scenario === 'readiness') {
      f.services.pluginManager.listPlugins = async () => {
        if (f.manager.value.operation?.phase === 'waiting') disable();
        return copy(f.rows);
      };
    } else f.setDefinition({ name: HEALTH, execute: async () => { disable(); return { structuredContent: f.report }; } });
    const state = await perform(f.manager, 'activate');
    assert.equal(state.operation.status, 'failed');
    assert.equal(state.operation.code, 'configuration_changed');
    assert.match(state.operation.message, /current settings were preserved/);
    assert.deepEqual(f.configured.map(row => row.configuredEnabled), [true, false]);
    assert.equal(f.calls.some(call => call[0] === 'toggle' && call[2] === false), false, 'do not compensate over a newer explicit disable');
    assert.doesNotMatch(state.operation.message, /is enabled|is active|was restored/);
  });
});

test('external raw disable is detected even while an old provider still reports active', async () => {
  const f = activationFixture();
  f.setDefinition({ name: HEALTH, execute: async () => {
    f.configured[1].configuredEnabled = false;
    return { structuredContent: f.report };
  } });
  const state = await perform(f.manager, 'activate');
  assert.equal(state.operation.status, 'failed');
  assert.equal(state.operation.code, 'configuration_changed');
  assert.equal(state.configuredEnabled, false);
  assert.equal(state.running, true);
  assert.equal(f.configured[1].configuredEnabled, false);
  assert.equal(f.calls.some(call => call[0] === 'toggle' && call[2] === false), false);
});

test('external native reload during health cannot reuse a stale healthy report', async () => {
  const f = activationFixture();
  f.setDefinition({ name: HEALTH, execute: async () => {
    f.setDefinition({ name: HEALTH, execute: async () => ({ structuredContent: f.report }) });
    return { structuredContent: f.report };
  } });
  const state = await perform(f.manager, 'activate');
  assert.equal(state.operation.status, 'warning');
  assert.equal(state.health.overall, 'unavailable');
  assert.equal(state.configuredEnabled, true);
  assert.equal(f.calls.some(call => call[0] === 'toggle' && call[2] === false), false);
});

test('activation preflight and install failures settle update state while later enablement failures preserve successful install state', async t => {
  for (const scenario of ['preflight', 'install', 'enable']) await t.test(scenario, async () => {
    const f = activationFixture();
    f.manifests.delete(NAMES[1]);
    if (scenario === 'preflight') f.runtime.lookup = async () => ({ exitCode: 1, stdout: JSON.stringify({ error: { code: 'ECONNRESET', message: 'Registry reset.' } }) });
    const approval = scenario === 'preflight' ? undefined : await requestApproval(f);
    if (scenario === 'install') {
      const run = f.runtime.run;
      f.runtime.run = async (...args) => {
        const result = await run(...args);
        return args[1][0] === 'add' ? { exitCode: 1, output: 'Install failed.' } : result;
      };
    }
    if (scenario === 'enable') {
      const toggle = f.services.pluginManager.setPluginEnabled;
      f.services.pluginManager.setPluginEnabled = async (...args) => args[1] ? { application: 'failed', error: { diagnostic: 'Enable failed.' } } : toggle(...args);
    }
    const state = await perform(f.manager, 'activate', approval);
    assert.equal(state.operation.status, 'failed');
    assert.equal(state.update.status, scenario === 'preflight' ? 'unavailable' : scenario === 'install' ? 'error' : 'current');
    assert.ok(state.update.checkedAt);
    if (scenario === 'preflight') {
      assert.match(state.update.reason, /ECONNRESET/);
      assert.equal(f.calls.some(call => ['run', 'toggle', 'lock'].includes(call[0])), false);
    }
  });
});

test('approved activation abort during installation never enables and retains one-time consumption', async () => {
  const f = activationFixture();
  f.manifests.delete(NAMES[1]);
  const approval = await requestApproval(f);
  const entered = deferred();
  const run = f.runtime.run;
  f.runtime.run = async (...args) => {
    if (args[1][0] === 'add') {
      entered.resolve();
      return new Promise((_, reject) => args[2].signal.addEventListener('abort', () => reject(args[2].signal.reason), { once: true }));
    }
    return run(...args);
  };
  await f.manager.start('activate', approval);
  await entered.promise;
  f.manager.controller.abort(new Error('Cancelled during installation.'));
  const state = await finish(f.manager);
  assert.equal(state.operation.status, 'failed');
  assert.equal(state.update.status, 'error');
  assert.equal(f.calls.some(call => call[0] === 'toggle'), false);
  assert.deepEqual(f.configured.map(row => row.configuredEnabled), [false, false]);
  f.calls.length = 0;
  assert.equal((await perform(f.manager, 'activate', approval)).operation.status, 'failed');
  assert.equal(f.calls.length, 0);
});
