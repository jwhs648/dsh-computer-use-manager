import React from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';

const h = React.createElement;
const query = new URLSearchParams(location.search);
const dictionaries = {};
const subscribers = new Set();
let snapshot = { active: query.get('locale') || 'zh', revision: 0 };
function TestModal({ open, title, children, footer, onClose, closeLabel, className }) {
  React.useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    const keyboard = event => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', keyboard);
    document.querySelector('[data-modal-autofocus]')?.focus();
    return () => { document.removeEventListener('keydown', keyboard); previous?.focus(); };
  }, [open, onClose]);
  return open ? createPortal(h('div', { className: 'test-backdrop', onClick: event => { if (event.target === event.currentTarget) onClose(); } },
    h('div', { className: 'test-dialog ' + (className || ''), role: 'dialog', 'aria-modal': true, 'aria-label': title },
      h('h2', null, title), children, h('div', { className: 'test-dialog-footer' }, footer), h('button', { 'aria-label': closeLabel, 'data-dialog-close': true, onClick: onClose }, 'x'))), document.body) : null;
}
const UI = {
  Button: ({ icon, children, variant, size, ...props }) => h('button', { ...props, className: 'test-button ' + (props.className || ''), 'data-variant': variant }, icon, children),
  Switch: ({ checked, disabled, label, onChange }) => h('button', { role: 'switch', 'aria-checked': checked, 'aria-label': label, disabled, onClick: () => onChange(!checked), className: 'test-switch' }, h('span', null)),
  Tooltip: ({ children, label }) => h('span', { title: label }, children),
  StateDot: ({ state, size = 12 }) => h('span', { 'aria-hidden': true, className: 'test-dot', 'data-state': state, style: { width: size, height: size } }),
  Modal: TestModal,
};
for (const name of ['IconPluginPinwheelOutlineRegular', 'IconRefreshOutlineRegular', 'IconDownloadOutlineRegular', 'IconCheckCircleFillRegular', 'IconWarningOutlineRegular', 'IconInfoOutlineRegular']) UI[name] = ({ size = 14 }) => h('span', { 'aria-hidden': true, style: { display: 'inline-block', width: size, height: size, flexShrink: 0 } });
const packageNames = ['@deepseek-ai/dsh-computer-use', '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native', '@deepseek-ai/dsh-mcp-client'];
const version = '0.2.2-rc.1';
const now = () => new Date().toISOString();
const off = query.get('scenario') !== 'running';
const missing = query.get('scenario') === 'missing';
const fixture = window.fixture = {
  calls: [], events: [], failure: false, delayMs: 0, getCount: 0, activeRequests: 0, maxActiveRequests: 0, abortedRequests: 0,
  installs: 0, enables: 0, healthRuns: 0, sequence: 0, outcome: query.get('outcome') || 'done', phaseDelayMs: 40, visibility: 'visible',
  state: {
    runtimeVersion: version, platform: 'win32', checkedAt: now(), configurationKnown: true, configuredEnabled: !off, running: !off,
    provider: off ? null : 'cua-driver-native', toolCount: off ? 0 : 56, status: missing ? 'missing' : off ? 'disabled' : 'running', reason: null,
    packages: packageNames.map((name, index) => ({ name, label: ['Computer-use registry', 'Native Cua Driver', 'MCP adapter'][index], version: missing ? null : version, targetVersion: version, compatible: !missing })),
    update: { status: 'unchecked', checkedAt: null, targetVersion: version, reason: null }, health: null, operation: null, history: [], restartRequired: false,
  },
};
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => fixture.visibility });
fixture.setVisibility = value => { fixture.visibility = value; document.dispatchEvent(new Event('visibilitychange')); };
fixture.setPanelVisible = visible => { document.getElementById('app').style.display = visible ? '' : 'none'; };
fixture.setLocale = active => { snapshot = { active, revision: snapshot.revision + 1 }; subscribers.forEach(callback => callback()); };
function later(callback) { setTimeout(callback, fixture.phaseDelayMs); }
function phase(value) { fixture.state.operation.phase = value; fixture.events.push(value); }
function finish(status = 'done', message = 'Completed') {
  Object.assign(fixture.state.operation, { status, message, finishedAt: now() });
  fixture.state.history.unshift({ time: now(), kind: fixture.state.operation.kind, status, message });
}
function healthy() {
  fixture.healthRuns++;
  const warning = ['warning', 'health-unavailable'].includes(fixture.outcome);
  fixture.state.health = { overall: fixture.outcome === 'health-unavailable' ? 'unavailable' : warning ? 'degraded' : 'ok', checkedAt: now(), checks: [
    { name: 'binary_version', status: 'pass', message: 'cua-driver 0.28.0' },
    { name: 'ax_capability', status: warning ? 'fail' : 'pass', message: warning ? 'UIAutomation health requires attention.' : 'UIAutomation is reachable.' },
    { name: 'screen_capture_capability', status: 'pass', message: 'D3D11 device reachable.' },
  ] };
  finish(warning ? 'warning' : 'done', warning ? 'Enabled, but health requires attention.' : 'Enabled and healthy.');
}
function enableAndCheck() {
  phase('enabling');
  later(() => {
    fixture.enables++;
    Object.assign(fixture.state, { configuredEnabled: true, running: false, status: 'waiting' });
    phase('waiting');
    later(() => {
      Object.assign(fixture.state, { running: true, provider: 'cua-driver-native', toolCount: 56, status: 'running' });
      phase('health');
      later(healthy);
    });
  });
}
function install() {
  phase('installing');
  later(() => {
    if (fixture.outcome === 'install-failure') return finish('failed', 'Component installation failed; capability remains disabled.');
    fixture.installs++;
    fixture.state.packages.forEach(item => { item.version = item.targetVersion; item.compatible = true; });
    fixture.state.update = { status: 'current', checkedAt: now(), targetVersion: version, reason: null };
    if (fixture.outcome === 'restart') {
      fixture.state.restartRequired = true;
      fixture.state.status = 'disabled';
      return finish('restart-required', 'Restart DSH before enabling the installed components.');
    }
    enableAndCheck();
  });
}
function start(args) {
  const approval = fixture.state.operation?.confirmation;
  if (args.action === 'activate' && args.installVersion && (args.installVersion !== approval?.version || args.approvalId !== approval?.approvalId)) throw new Error('Invalid activation approval.');
  fixture.state.operation = { id: 'operation-' + ++fixture.sequence, kind: args.action, status: 'running', phase: 'checking', message: 'Working', startedAt: now() };
  if (args.action === 'activate') {
    if (args.installVersion) return install();
    phase('checking');
    later(() => {
      if (fixture.state.packages.some(item => !item.compatible)) {
        fixture.state.operation.status = 'needs-confirmation';
        fixture.state.operation.message = 'Matching components require installation.';
        fixture.state.operation.confirmation = { approvalId: 'approval-' + fixture.sequence, version, packages: packageNames };
      } else enableAndCheck();
    });
    return;
  }
  later(() => {
    if (args.action === 'setEnabled') Object.assign(fixture.state, { configuredEnabled: args.enabled, running: args.enabled, provider: args.enabled ? 'cua-driver-native' : null, toolCount: args.enabled ? 56 : 0, status: args.enabled ? 'running' : 'disabled', health: null });
    if (args.action === 'checkUpdates') fixture.state.update = { status: fixture.state.packages.every(item => item.compatible) ? 'current' : 'available', checkedAt: now(), targetVersion: version, reason: null };
    if (args.action === 'update') { fixture.state.packages.forEach(item => { item.version = item.targetVersion; item.compatible = true; }); fixture.state.update.status = 'current'; fixture.state.status = fixture.state.configuredEnabled ? 'running' : 'disabled'; fixture.installs++; }
    if (args.action === 'health') return healthy();
    finish();
  });
}
function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); fixture.abortedRequests++; reject(new DOMException('Aborted', 'AbortError')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
  });
}
window.fetch = async (_url, options = {}) => {
  fixture.activeRequests++;
  fixture.maxActiveRequests = Math.max(fixture.maxActiveRequests, fixture.activeRequests);
  try {
    if (options.method !== 'POST') fixture.getCount++;
    if (fixture.delayMs) await delay(fixture.delayMs, options.signal);
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (fixture.failure) return Response.json({ ok: false, error: 'Simulated connection failure' }, { status: 503 });
    if (options.method === 'POST') {
      if (options.headers['X-DSH-Computer-Use-Manager'] !== '1') throw new Error('Missing protection header');
      const args = JSON.parse(options.body);
      fixture.calls.push(args);
      start(args);
    }
    fixture.state.checkedAt = now();
    return Response.json({ ok: true, value: fixture.state });
  } finally { fixture.activeRequests--; }
};
window.__ModuleLoader__ = { load(descriptor) {
  const plugin = descriptor.factory(name => { if (name === 'react') return React; if (name === '@deepseek-ai/dsh-client-ui-primitives') return UI; throw new Error('Unknown module: ' + name); });
  let main;
  const ctx = {
    effect: fn => fn(),
    locale: {
      register: (namespace, language, dictionary) => { const pairs = typeof language === 'string' ? [[language, dictionary]] : Object.entries(language); for (const [key, value] of pairs) (dictionaries[namespace] ??= {})[key] = value; return () => {}; },
      bind: namespace => key => dictionaries[namespace]?.[snapshot.active]?.[key] ?? key,
      subscribe: callback => { subscribers.add(callback); return () => subscribers.delete(callback); }, getSnapshot: () => snapshot,
    },
    slots: { inject: (_slot, register) => register(), register: (spec, render) => { if (spec.name === 'main') main = render; return () => {}; } },
  };
  plugin.apply(ctx);
  if (!main) throw new Error('No manager page registered');
  const root = createRoot(document.getElementById('app'));
  fixture.unmount = () => root.render(null);
  fixture.mount = () => root.render(h(main));
  fixture.mount();
} };
