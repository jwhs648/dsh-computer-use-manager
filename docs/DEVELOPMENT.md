# Developer Notes

A local DSH bundle for the Windows native Cua Driver provider. It keeps the manager available independently from the optional driver.

## Operations

- Displays saved enablement separately from the live provider, registered tools, and health checks.
- Switching on starts one server-owned flow: check prerequisites, obtain installation approval when matching components are missing, then install if needed, enable, wait for the real provider and run health checks. Switching off uses DSH profile management.
- Checks compatible components: queries the three fixed official dependencies at the exact currently running DSH version, using the profile's pnpm registry configuration. This is not a latest-release check for DSH or its components.
- Installs matching versions of only those dependencies, using the managed package command and profile reconciliation.
- Reports activation errors and restart requirements without bypassing version checks or restarting DSH.

Package installation and driver changes affect every session on the current profile. No desktop input or screenshots are sent by the health check. Downloads require explicit installation approval, including when initiated from the switch. There is no unattended installation or scheduled task.

## Integration

The package is a selected local profile bundle. It owns the manager, computer-use registry and native-provider rows. Both optional component rows start disabled in a fresh installation; the profile stores the chosen enablement override. The client uses the existing DSH shell module loader and shared controls. It does not require a separate server.

GET `/api/computer-use-manager` reads current state. POST accepts only `activate`, `setEnabled`, `checkUpdates`, `update` and `health`, with same-origin and custom-header checks in addition to the existing DSH connection authentication.

`activate` without arguments checks installed components. Missing or incompatible components are checked against the exact current DSH version before returning `operation.status: needs-confirmation` and `operation.confirmation: { approvalId, version, packages }`. Nothing is installed or enabled at that stage. The native modal may continue with `activate` and the paired `installVersion` / `approvalId`. Approval is instance-owned, expires after five minutes, is bound to the host version, and is consumed before installation. A changed host version, stale approval, cancellation or an unsuccessful prerequisite check cannot silently start an installation.

Activation continues on the host, not through chained browser requests. Local-compatible activation does not need a registry request or download. Startup failures attempt to restore the prior saved enablement after outstanding host writes settle. An observed newer configuration change is preserved instead of blindly restoring stale values. The official host toggles acquire separate locks, so this is compensating recovery, not a global multi-client transaction. Restart requirements and health warnings are distinct outcomes, not successful health claims.

## Installation on Another Computer

Install tagged GitHub Release archives using the DSH Plugins page. For local development, a directory link must point to your own checkout; never reuse another user's absolute path. The package remains private to prevent accidental npm publication.

- Use a supported DSH version with the declared host peer services. The existing integration has been verified on Windows Desktop 0.2.2-rc.1, not on every operating system or DSH release.
- A fresh bundle selection leaves the native provider disabled. Turn its switch on to run the prerequisite and activation flow. Installed compatible dependencies are enabled directly, followed by readiness verification and a read-only health check.
- Missing or incompatible components produce an installation-and-enablement confirmation automatically. Approve the exact matching target to download and continue; cancelling leaves the capability off. The separate component-install action still preserves an intentionally disabled provider.
- OS accessibility and capture permissions still apply. Enabling a DSH plugin does not grant or bypass system permissions, and loading changes may require restarting DSH.

The fresh-install sequence is covered with isolated host adapters and a simulated browser workflow; it has not been exercised on a second physical machine.

## Recovery Boundaries

The manager separates saved configuration, compatibility and active runtime state. A normal restart retains the profile selection and enablement override. A full Desktop recovery can deselect custom bundles; installed dependencies remain, but a deselected manager cannot reactivate itself. Re-enable the installed manager bundle from the DSH Plugins page in that case. The driver is disabled by default when no saved override survives.

The manager declares support for the DSH 0.2 API family starting at 0.2.2-rc.1. A future incompatible API family requires updating the manager itself. A matching component update is never a compatibility exemption.

## Validation

Run `node --test core.test.js api.test.js` from this directory. The endpoint tests cover restricted arguments, cross-origin writes, cache policy and error redaction. Core tests cover state, matching-version updates and lifecycle safety.

## License

The original source code of this plugin is licensed under the [MIT License](LICENSE). DSH, Cua Driver and other third-party components retain their own licenses; this license does not relicense those components.
