import React from 'react';
import { createRoot } from 'react-dom/client';

const h = React.createElement;
const query = new URLSearchParams(location.search);
const dictionaries = {};
const subscribers = new Set();
let snapshot = { active: query.get('locale') || 'zh', revision: 0 };
document.documentElement.lang = snapshot.active === 'en' ? 'en' : 'zh-CN';
document.documentElement.dataset.theme = query.get('theme') || 'light';
const fixture = window.fixture = {
  failure: false, delayMs: 0, getCount: 0, activeRequests: 0, maxActiveRequests: 0, abortedRequests: 0, visibility: 'visible', modules: [], state: null,
};
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => fixture.visibility });
fixture.setVisibility = value => { fixture.visibility = value; document.dispatchEvent(new Event('visibilitychange')); };
fixture.setPanelVisible = visible => { document.getElementById('app').style.display = visible ? '' : 'none'; };
fixture.setLocale = active => { snapshot = { active, revision: snapshot.revision + 1 }; subscribers.forEach(callback => callback()); };
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
    const response = await window.__managerBridge({ kind: 'request', options: { method: options.method || 'GET', headers: options.headers, body: options.body } });
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    fixture.state = response.body.value || fixture.state;
    return Response.json(response.body, { status: response.status });
  } finally { fixture.activeRequests--; }
};
window.__ModuleLoader__ = { load(descriptor) {
  const plugin = descriptor.factory(name => { fixture.modules.push(name); if (name === 'react') return React; throw new Error('Unexpected runtime module: ' + name); });
  let main;
  const disposers = [];
  const ctx = {
    effect: fn => { const cleanup = fn(); if (typeof cleanup === 'function') disposers.push(cleanup); },
    locale: {
      register: (namespace, language, dictionary) => { const pairs = typeof language === 'string' ? [[language, dictionary]] : Object.entries(language); for (const [key, value] of pairs) (dictionaries[namespace] ??= {})[key] = value; return () => { delete dictionaries[namespace]; }; },
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
  fixture.dispose = () => { root.unmount(); disposers.reverse().forEach(cleanup => cleanup()); };
  fixture.subscriberCount = () => subscribers.size;
  fixture.mount();
} };
