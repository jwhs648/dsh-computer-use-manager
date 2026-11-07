import { setTimeout as delay } from 'node:timers/promises';
import { ComputerUseManager } from '../core.js';
import { createApiHandler } from '../api.js';

export const packageNames = ['@deepseek-ai/dsh-computer-use', '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native', '@deepseek-ai/dsh-mcp-client'];
export const version = '0.2.2-rc.1';
const specs = packageNames.slice(0, 2).map((name, index) => ({ name, id: ['computer-use', 'computer-use-cua-driver-native'][index] }));

// Only the Host boundaries are fake. The manager and HTTP handler are production code.
// No adapter method touches profiles, packages, subprocesses, HTTP, or the desktop.
export async function createHostFixture(options = {}) {
  const missing = options.scenario === 'missing';
  const enabled = options.scenario === 'running';
  const outcome = options.outcome || 'done';
  const records = { calls: [], events: [], installs: 0, enables: 0, healthRuns: 0 };
  let installed = !missing;
  const configured = specs.map(spec => ({ ...spec, configuredEnabled: enabled }));
  const rows = specs.map(spec => ({ entryId: spec.id, patchId: spec.id, moduleName: spec.name, enabled, fiberPhase: enabled ? 'active' : 'disabled' }));
  const active = () => rows.every(row => row.enabled && row.fiberPhase === 'active');
  const health = { name: 'cua_driver_native__health_report', execute: async () => {
    records.healthRuns++;
    await delay(8);
    if (outcome === 'health-unavailable') throw new Error('Simulated driver diagnostic failure.');
    const warning = outcome === 'warning';
    return { structuredContent: { overall: warning ? 'degraded' : 'ok', checks: [
      { name: 'binary_version', status: 'pass', message: 'cua-driver fixture version' },
      { name: 'ax_capability', status: warning ? 'fail' : 'pass', message: warning ? 'UIAutomation fixture requires attention.' : 'UIAutomation fixture passed.' },
      { name: 'screen_capture_capability', status: 'pass', message: 'Screen capture fixture passed.' },
    ] } };
  } };
  const tools = [health, { name: 'cua_driver_native__fixture' }];
  const ctx = {
    pluginManager: {
      listPlugins: async () => structuredClone(rows),
      setPluginEnabled: async (id, value) => {
        await delay(8);
        const row = rows.find(item => item.entryId === id);
        configured.find(item => item.id === id).configuredEnabled = value;
        row.enabled = value;
        row.fiberPhase = value && outcome !== 'restart' ? 'active' : 'disabled';
        if (value && id === specs[1].id) records.enables++;
        return { application: outcome === 'restart' ? 'restart-required' : 'applied' };
      },
    },
    get computerUse() { return { providerName: active() ? 'cua-driver-native' : undefined }; },
    tools: { definitions: () => active() ? tools : [], get: name => active() ? tools.find(tool => tool.name === name) : undefined },
    hmr: { runExclusive: callback => callback(), reconcileProfile: async () => outcome === 'restart' ? { pending: [specs[1].id] } : {} },
  };
  const runtime = {
    platform: 'win32', version: () => version, configured: () => structuredClone(configured),
    manifest: (_ctx, name) => { if (!installed) throw new Error('Fixture package absent.'); return { name, version }; },
    compatible: manifest => manifest.version === version,
    lookup: async (_ctx, name, target, signal) => { await delay(8, undefined, { signal }); return { exitCode: 0, stdout: JSON.stringify({ name, version: target }) }; },
    lock: (_ctx, callback, signal) => { signal.throwIfAborted(); return callback(); },
    backup: async () => [{ path: '/memory/package.json', text: JSON.stringify({ installed }) }],
    restore: async (_ctx, backup) => { installed = JSON.parse(backup[0].text).installed; },
    admit: async (_ctx, signal) => { signal.throwIfAborted(); },
    run: async (_ctx, args, { signal, onSettled }) => {
      await delay(8, undefined, { signal });
      if (args[0] === 'add') {
        if (outcome === 'install-failure') { onSettled(); return { exitCode: 1, output: 'Simulated package install failure.' }; }
        installed = true;
        records.installs++;
      }
      onSettled();
      return { exitCode: 0, output: 'In-memory package operation.\n' };
    },
  };
  const manager = new ComputerUseManager(ctx, { runtime, timeouts: { poll: 8, readiness: 1000 } });
  const originalPhase = manager.activationPhase.bind(manager);
  const recordPhase = phase => { if (records.events.at(-1) !== phase) records.events.push(phase); };
  manager.activationPhase = (phase, message) => { recordPhase(phase); originalPhase(phase, message); };
  const handler = createApiHandler(manager);
  await manager.state();
  return {
    async bridge(message) {
      if (message.kind === 'settle') { await manager.pending; return null; }
      if (message.kind === 'foreign') {
        manager.value.operation = { id: 'foreign', kind: 'activate', status: 'needs-confirmation', confirmation: { approvalId: 'foreign-approval', version, packages: ['foreign-package'] } };
        return null;
      }
      if (message.kind === 'stats') return { ...records, state: manager.snapshot() };
      if (message.kind !== 'request') throw new Error('Unknown fixture bridge message.');
      const options = message.options || {};
      if (options.method === 'POST') {
        const args = JSON.parse(options.body);
        records.calls.push(args);
        if (args.action === 'activate') recordPhase('checking');
      }
      const response = await handler(new Request('http://fixture.invalid/api/computer-use-manager', options));
      return { status: response.status, body: await response.json() };
    },
    dispose: () => manager.dispose(),
  };
}
