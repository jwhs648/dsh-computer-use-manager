# Developer notes

An activation and management bundle for DSH's existing computer-use capability.
It does not implement or ship a separate computer-control engine: actual desktop
operations come from DSH's official computer-use components and their Cua Driver
Native provider. Missing optional components are installed only after user
confirmation, at versions matching the running DSH host.

The manager remains available independently of the optional driver. Version
0.1.0-alpha.2 is a safety-fix prerelease for the verified DSH 0.2.2-rc.1 host.

## Integration

The selected profile bundle owns the manager, computer-use registry and
native-provider rows. Both optional rows are disabled on a fresh installation;
profile overrides preserve an existing installation's choice. The client uses
the shell module loader, React, theme tokens and its own accessible controls.
It imports no internal Harness client package and needs no separate server.

GET `/api/computer-use-manager` reads state. POST accepts only `activate`,
`setEnabled`, `checkUpdates`, `update` and `health`. Same-origin, custom-header,
JSON and body-size checks supplement the existing DSH connection authentication.

The read-only `computer_use_status` tool reports saved configuration separately
from the current provider, registered tools and latest health result. Diagnostics
do not send desktop input or capture a screenshot.

## Activation and approval

Activation runs on the Host. Compatible local packages require no network
lookup or installation. Missing or incompatible packages must first be checked
against the exact running DSH version. The response contains a five-minute,
one-use instance-owned approval, bound to that version and the three fixed
package names. A stale approval, changed host version or failed prerequisite
check cannot silently start an installation.

After installation, configuration must still match the pre-install snapshot.
Only then may the flow enable rows, wait for the actual native provider and
run health checks. Saved enablement, runtime readiness, restart requirements
and health warnings remain distinct. A restart-required result can correctly
have `configuredEnabled: true` while the current provider is not running.

## Package-operation admission

This version supports only DSH 0.2.2-rc.1 and the matching Host peers. The
production admission adapter depends on a verified layout of that version;
it is not a claimed public cross-version admission API.

The adapter takes the official profile package lock, then checks for
`.plugin-manager/run.json` before taking a profile snapshot or reading update
configuration. Any existing record, including an invalid or stale one, blocks
the operation. The manager does not inspect PIDs, delete records or copy the
official installer's private liveness heuristics. An operator must use the
official plugin management/recovery process to inspect and settle that state.

Every package command forces `--config.ignore-scripts=true` in the launcher's
argument prefix and script-disable environment settings. The prefix also applies
to the helper's internal compatibility-repair command. No build-script permission
is granted. The pinned helper can finish an internal repair before reacting to
cancellation; the manager must not release its lock while its writer is settling.

The helper's public nonzero/exception result cannot distinguish pre-start refusal
from an unsettled writer. Only a successful, non-timeout helper result grants
snapshot-recovery ownership to this adapter. An unconfirmed result therefore
requires official repair instead of blind metadata restoration. Each subsequent
repair needs its own settlement confirmation; ownership from the first run does
not authorize writing over an uncertain second writer.

## Enablement recovery

Recovery tracks expected configuration and grants made by the current operation.
It may revoke its own false-to-true changes; it never restores a saved `true` by
turning a disabled capability on again. An observed conflicting change stops
compensation. This applies to ordinary failures, timeouts and cancellation,
not only errors named `configuration_changed`.

Official toggles use their own lock and HMR transaction. There is no atomic
compare-and-swap across clients; a same-value ABA change cannot be identified.
The recovery policy is deliberately conservative and is not a global transaction
or a guarantee against arbitrary out-of-band edits of profile files.

## Unload and HMR

Disposal marks the manager unavailable, consumes outstanding approvals and
aborts owned work, but does not join a promise that may be waiting behind the
HMR transaction disposing it. An already accepted official toggle cannot be
cancelled through the current API and may settle after unload. No continuation
of the disposed instance may enqueue a new toggle or reconciliation.

A queued reconciliation checks disposal and its signal again when it actually
gets the queue. Package cleanup keeps its own write lock until it settles, skips
HMR when disposed and marks restart/repair needs instead of hanging global HMR.
Uninstalling the manager does not uninstall or implicitly disable the driver.

## Validation

```powershell
node --test core.test.js api.test.js package.test.js
```

Core regression tests cover real serial queue semantics with injected Host
boundaries, cancellation after an external disable, configuration changes during
installation, production admission/runner contracts and uncertain recovery
writers. API tests cover argument restrictions, authentication-adjacent CSRF
checks, cache policy and diagnostic redaction. Package tests cover display
resources, exact host range, default-disabled component rows and client imports.

The existing browser runner renders the real client and calls the real manager
and endpoint handler through an in-memory bridge. Installation, registry,
configuration, HMR and driver services are substitutes; this is not evidence
of a second machine's first install or a live DSH application's visual state.
Live installation and UI verification must be reported separately.

## License

Original source and the package icon are MIT licensed. Inline control icons
retain the Lucide ISC and Feather MIT notices in `THIRD_PARTY_NOTICES.md`.
DSH, Cua Driver and other third-party components retain their own licenses.
