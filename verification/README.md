# Isolated Browser Regression

Run from the package directory with Node.js:

```powershell
node verification/run-ui.mjs
```

The runner first uses dependencies already installed beside this fixture. If they are absent, it reuses the existing development checkout at `../../dsh-computer-use-manager/verification/package.json`. It does not install packages or create dependency links. The local Microsoft Edge executable is used headlessly. `CUM_UI_FILTER` optionally selects test names by regular expression.

## Boundary

- The browser evaluates the distributed `client.js` unchanged. Its only runtime module is React. Buttons, switch, tooltip, icons, state indicator, modal layout, focus trapping, Escape handling, scroll locking, and focus restoration all come from the real plugin, not replacement test controls.
- `host-fixture.mjs` imports the actual `ComputerUseManager` and `createApiHandler`. Playwright `exposeBinding` connects browser requests to these Node-side objects without opening an HTTP server.
- Only runtime boundaries are replaced: package metadata, persistent configuration rows, package-manager operations, health-tool output, HMR, and provider availability are in memory. Package admission and writer settlement are explicit fixture contracts. No real profiles, dependency trees, subprocesses, network endpoints, or desktop input are modified.
- The module loader, locale service, slot hosting, and light/dark theme tokens are small fixtures. This does not verify the current Harness GUI, actual loaded plugin version, real theme values, package installation, or desktop integration.
- Browser `console.error` and uncaught `pageerror` are recorded separately. A passing run writes `results.json` and screenshots beneath this directory. Screenshot names describe viewport and theme; they are isolated-fixture evidence, not live GUI evidence.

## Coverage

Existing activation, confirmation ownership, cancellation, restart, failure, degraded diagnostics, update, stale state, visibility, and request-concurrency scenarios run against the production Host logic. Restart assertions distinguish enabled configuration from an inactive runtime. Additional scenarios exercise modal keyboard order and reverse wrapping, programmatic focus containment, Escape/backdrop dismissal, focus restoration, polling without focus disruption, keyboard tooltips, switch keyboard activation, component unmount/request abort/locale cleanup, and light/dark layouts at 1280, 390, and 320 pixels. Chinese and English installation dialogs are checked at both mobile widths.

Live Harness GUI verification is intentionally separate and is performed by the lead agent.
