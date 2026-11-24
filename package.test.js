import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

const root = new URL('./', import.meta.url);
const json = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));

test('the bundle ships its runtime, display resources and third-party notices', async () => {
  const manifest = await json('package.json');
  assert.equal(manifest.version, '0.2.0-beta.2');
  assert.equal(manifest.engines.dsh, '>=0.2.2-rc.3 <0.3.0-0');
  const inline = manifest.dshComputerUseManager?.inlineInstallVersions;
  assert.ok(Array.isArray(inline) && inline.length && inline.every(version => typeof version === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/.test(version)), 'inlineInstallVersions must list exact versions');
  for (const name of ['@deepseek-ai/dsh-app-boot', '@deepseek-ai/dsh-plugin-manager', '@deepseek-ai/dsh-atomic-write']) {
    assert.equal(manifest.peerDependencies[name], manifest.engines.dsh, 'Host peer must match the declared DSH version: ' + name);
  }
  assert.equal(manifest.exports['./icon'], './icon.svg');
  for (const name of ['index.js', 'core.js', 'api.js', 'client.js', 'cordis.patch.yml', 'icon.svg', 'THIRD_PARTY_NOTICES.md']) {
    assert.ok(manifest.files.includes(name), 'Missing distribution file: ' + name);
    assert.ok((await stat(new URL(name, root))).isFile(), 'Missing regular file: ' + name);
  }
  for (const locale of ['zh', 'en']) {
    const value = await json('locale/' + locale + '.json');
    assert.ok(value.meta.title.trim());
    assert.ok(value.meta.description.trim());
  }
  const icon = await stat(new URL('icon.svg', root));
  assert.ok(icon.size > 0 && icon.size <= 256 * 1024);
  const notices = await readFile(new URL('THIRD_PARTY_NOTICES.md', root), 'utf8');
  assert.match(notices, /ISC License/);
  assert.match(notices, /Lucide Contributors/);
});

test('the reported manager version matches the published package version', async () => {
  const manifest = await json('package.json');
  const core = await readFile(new URL('core.js', root), 'utf8');
  const declared = core.match(/const MANAGER_VERSION = '([^']+)';/);
  assert.ok(declared, 'core.js must declare MANAGER_VERSION as a string literal');
  assert.equal(declared[1], manifest.version, 'Bump MANAGER_VERSION in core.js together with package.json');
});

test('the plain JavaScript client has no private Harness module dependency', async () => {
  const client = await readFile(new URL('client.js', root), 'utf8');
  const imports = [...client.matchAll(/\brequire\s*\(\s*(['"])(.*?)\1\s*\)/g)].map(match => match[2]);
  assert.deepEqual(imports, ['react']);
  assert.doesNotMatch(client, /\bimport\s*\(/);
});

test('both optional computer-use rows start disabled in the bundle', async () => {
  const patch = await readFile(new URL('cordis.patch.yml', root), 'utf8');
  for (const id of ['computer-use', 'computer-use-cua-driver-native']) {
    const row = patch.split(/\r?\n(?=    - id:)/).find(value => value.startsWith('    - id: ' + id + '\n') || value.startsWith('    - id: ' + id + '\r\n'));
    assert.ok(row, 'Missing row: ' + id);
    assert.match(row, /\n      disabled: true(?:\r?\n|$)/);
  }
});
