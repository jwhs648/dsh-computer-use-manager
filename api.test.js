import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiHandler, publicError } from './api.js';

function setup() {
  const calls = [];
  const state = { configuredEnabled: true, status: 'running', toolCount: 56 };
  const handler = createApiHandler({ state: async () => state, start: async (...args) => { calls.push(args); return state; } });
  return { handler, calls, state };
}
function request(body, headers = {}) {
  return new Request('http://127.0.0.1:50061/api/computer-use-manager', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-DSH-Computer-Use-Manager': '1', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

test('GET exposes fresh state and disables caches', async () => {
  const { handler, state } = setup();
  const response = await handler(new Request('http://127.0.0.1:50061/api/computer-use-manager'));
  assert.deepEqual(await response.json(), { ok: true, value: state });
  assert.equal(response.headers.get('cache-control'), 'no-store');
});
test('only fixed actions and validated boolean toggle are dispatched', async () => {
  const { handler, calls } = setup();
  assert.equal((await handler(request({ action: 'setEnabled', enabled: false }))).status, 200);
  assert.deepEqual(calls, [['setEnabled', { action: 'setEnabled', enabled: false }]]);
  for (const body of [{ action: 'exec', command: 'node' }, { action: 'setEnabled', enabled: 'false' }, { action: 'update', version: 'latest' }, null, [], '{']) {
    assert.equal((await handler(request(body))).status, 400);
  }
  assert.equal(calls.length, 1);
});
test('cross-origin mutations and missing custom header are refused', async () => {
  const { handler, calls } = setup();
  for (const headers of [{ origin: 'https://example.com' }, { 'sec-fetch-site': 'cross-site' }, { 'X-DSH-Computer-Use-Manager': '0' }, { 'Content-Type': 'text/plain' }]) {
    assert.equal((await handler(request({ action: 'update' }, headers))).status, 403);
  }
  assert.equal(calls.length, 0);
});
test('oversized requests and unsupported methods are refused', async () => {
  const { handler } = setup();
  assert.equal((await handler(request('x'.repeat(4097)))).status, 413);
  assert.equal((await handler(new Request('http://127.0.0.1:50061/api/computer-use-manager', { method: 'DELETE' }))).status, 405);
});
test('busy operations return 409 and secrets are removed from errors', async () => {
  const handler = createApiHandler({ start: async () => { const error = new Error('busy sk-test-secret ?token=private'); error.code = 'busy'; throw error; } });
  const response = await handler(request({ action: 'update' }));
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.ok(!body.error.includes('private'));
  assert.ok(!body.error.includes('sk-test'));
  assert.ok(!publicError(new Error('Authorization: Bearer private')).includes('private'));
});

test('activation accepts only a plain preflight or paired bounded approval strings', async () => {
  const { handler, calls } = setup();
  const approved = { action: 'activate', installVersion: '0.2.2-rc.1', approvalId: 'approval-id' };
  assert.equal((await handler(request({ action: 'activate' }))).status, 200);
  assert.equal((await handler(request(approved))).status, 200);
  assert.deepEqual(calls, [['activate', { action: 'activate' }], ['activate', approved]]);
  for (const args of [{ installVersion: '0.2.2-rc.1' }, { approvalId: 'id' }, { installVersion: 1, approvalId: 'id' },
    { installVersion: '0.2.2-rc.1', approvalId: null }, { installVersion: '', approvalId: 'id' },
    { installVersion: '0.2.2-rc.1', approvalId: ' ' }, { installVersion: 'v'.repeat(121), approvalId: 'id' },
    { installVersion: '0.2.2-rc.1', approvalId: 'i'.repeat(161) }, { enabled: true }, { packages: ['anything'] },
    { command: 'anything' }, { installVersion: '0.2.2-rc.1', approvalId: 'id', extra: true }]) {
    assert.equal((await handler(request({ action: 'activate', ...args }))).status, 400);
  }
  assert.equal(calls.length, 2);
});

test('activation retains cross-origin, JSON-header and size protections', async () => {
  const { handler, calls } = setup();
  for (const headers of [{ origin: 'https://example.com' }, { 'sec-fetch-site': 'cross-site' },
    { 'X-DSH-Computer-Use-Manager': '0' }, { 'Content-Type': 'text/plain' }]) {
    assert.equal((await handler(request({ action: 'activate' }, headers))).status, 403);
  }
  assert.equal((await handler(request({ action: 'activate', approvalId: 'x'.repeat(4097), installVersion: '0.2.2-rc.1' }))).status, 413);
  assert.equal(calls.length, 0);
});
