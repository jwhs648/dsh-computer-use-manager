// Run after installing the same manager tarball and the matching six host/component packages
// in each isolated npm project. Usage: node verification/check-hosts.mjs <project> [...]
// Each check creates a disposable profile. Only registration and live rows are simulated.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const manager = '@local/dsh-computer-use-manager';
const host = '@deepseek-ai/dsh-';
const components = ['computer-use', 'experimental-computer-use-cua-driver-native', 'mcp-client'];
const projects = process.argv.slice(2);
assert.ok(projects.length, 'Supply the isolated npm project directories.');
let integrity;
for (const project of projects) {
  const anchor = resolve(project, 'package.json');
  const require = createRequire(anchor);
  const load = spec => import(pathToFileURL(require.resolve(spec)).href);
  const lock = JSON.parse(await readFile(resolve(project, 'package-lock.json'), 'utf8'));
  const packed = lock.packages['node_modules/' + manager];
  const digest = packed?.integrity;
  assert.match(packed?.resolved ?? '', /^file:/u);
  const archive = resolve(project, packed.resolved.slice(5));
  const archiveDigest = createHash('sha512').update(await readFile(archive)).digest('base64');
  assert.equal(digest, 'sha512-' + archiveDigest);
  assert.match(digest ?? '', /^sha512-/u, 'Install a packed manager tarball.');
  integrity ??= digest;
  assert.equal(digest, integrity, 'Every project must use the same manager tarball.');
  const manifest = require(manager + '/package.json');
  const boot = await load(host + 'app-boot');
  const version = boot.getDshRuntimeVersion();
  const evaluate = (pkg, runtime) => boot.evaluatePluginCompatibility(pkg, {}, runtime);
  assert.equal(evaluate(manifest, version), undefined);
  for (const accepted of ['0.2.2-rc.3', '0.2.2-rc.4', '0.2.2-rc.5', '0.2.2-rc.6']) {
    assert.equal(evaluate(manifest, accepted), undefined);
  }
  for (const rejected of ['0.2.2-rc.2', '0.2.2', '0.2.3-rc.1', '0.3.0']) {
    assert.ok(evaluate(manifest, rejected));
  }
  const wrongPeers = { [host + 'app-boot']: '0.0.1' };
  assert.equal(evaluate({ ...manifest, peerDependencies: wrongPeers }, version), undefined);
  assert.ok(evaluate({ name: manager, version: manifest.version, peerDependencies: wrongPeers }, version));
  for (const name of Object.keys(manifest.peerDependencies)) assert.equal(require(name + '/package.json').version, version);
  for (const suffix of components) {
    const dir = boot.resolveBundleDir('dsh', host + suffix, anchor, project);
    const component = boot.readProfileManifest('dsh', dir);
    assert.equal(component.version, version);
    assert.equal(component.dsh?.bundle, undefined);
    assert.equal(evaluate(component, version), undefined);
    assert.ok(evaluate(component, version === '0.2.2-rc.3' ? '0.2.2-rc.4' : '0.2.2-rc.3'));
  }
  const { PluginManager, parseInstallSpec } = await load(host + 'plugin-manager');
  assert.equal(typeof PluginManager.prototype.listPlugins, 'function');
  assert.equal(typeof PluginManager.prototype.setPluginEnabled, 'function');
  assert.equal(parseInstallSpec(resolve(project, 'manager.tgz')).kind, 'tarball');
  const operations = await load(host + 'plugin-manager/operations');
  for (const key of ['viewProfilePackage', 'runProfilePnpm']) assert.equal(typeof operations[key], 'function');
  const atomic = await load(host + 'atomic-write');
  for (const key of ['writeFileAtomic', 'withFileLock']) assert.equal(typeof atomic[key], 'function');

  const dir = await mkdtemp(join(tmpdir(), 'dsh-manager-check-'));
  const cleanups = [];
  try {
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'compat-profile', private: true, dsh: { profile: { bundles: [manager] } } }));
    const profileContext = { dir, home: dir, name: 'compat-profile', installAnchor: anchor, patchPath: join(dir, 'cordis.patch.yml'), overlays: [] };
    // Exercise the inspector used by Add plugin with registry answers from the installed
    // published manifests. An empty installation manifest models a component still missing.
    const inspector = {
      profile: { dir, installAnchor: join(dir, 'package.json') },
      registries: async () => ({ resolved: null, registry: null, fallbackRegistries: [] }),
      askRegistries: async (_spec, _fields, _plan, parsed) => ({
        attempts: [], registry: null,
        answer: boot.readProfileManifest('dsh', boot.resolveBundleDir('dsh', parsed.name, anchor, project)),
      }),
    };
    const inspect = spec => PluginManager.prototype.inspect.call(inspector, spec);
    assert.equal((await inspect(archive)).status, 'accepted');
    for (const suffix of components) assert.equal((await inspect(host + suffix + '@' + version)).problem, 'not-a-bundle');
    let route;
    let tool;
    const ctx = {
      effect(fn) { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup); },
      profileContext,
      pluginManager: { listPlugins: async () => [] },
      tools: { definitions: () => [], register(definition) { tool = definition; } },
      connection: { fetch: { register(definition) { route = definition; } } },
    };
    (await load(manager)).apply(ctx);
    assert.equal(tool.name, 'computer_use_status');
    const response = await route.fetch(new Request('http://localhost' + route.path));
    const { value } = await response.json();
    assert.equal(response.status, 200);
    assert.equal(value.status, 'disabled', JSON.stringify(value));
    assert.equal(value.configurationKnown, true);
    assert.equal(value.managerVersion, manifest.version);
    assert.equal(value.runtimeVersion, version);
    assert.equal(value.inlineInstallSupported, version === '0.2.2-rc.3');
    assert.deepEqual(value.packages.map(pkg => pkg.name), components.map(suffix => host + suffix));
    assert.ok(value.packages.every(pkg => pkg.compatible && pkg.version === version));
    console.log(JSON.stringify({ version, manager: manifest.version, integrity, status: value.status, inlineInstallSupported: value.inlineInstallSupported }));
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup();
    await rm(dir, { recursive: true, force: true });
  }
}
