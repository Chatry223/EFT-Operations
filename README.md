# EFT Operations

Mission / campaign operations and EconomyGuard integration for SPT.

## Compatibility target

- EFT build: `0.16.1.3.35392-P2P`
- SPT: `3.11.1`
- Fika Server: `2.4.3`
- Fika client plugin: `1.2.3`
- Client plugin: .NET Framework 4.7.2 / C# 7.3 / BepInEx

## Project layout (source bundle 1.9.1)

- `user/mods/SPT-EconomyGuard`: server mod, admin panel, mission/operations API and automated tests.
- `client/EFT.Operations.Client`: BepInEx client plugin source.
- `.github/workflows/build-client.yml`: server checks and Windows client build.

## Build requirements

The supplied Library archives were inspected. The game Managed assemblies and BepInEx references required by the client project are present in the user's local source folder. Do not commit game, Unity, BepInEx or Fika binaries to this public repository.

Configure a Windows self-hosted GitHub Actions runner on the EFT machine with labels:
`self-hosted`, `Windows`, `X64`, `eft-build`.

Set repository Actions variables:
- `EFT_MANAGED_DIR`: absolute path to the extracted `EscapeFromTarkov_Data/Managed`
- `BEPINEX_CORE_DIR`: absolute path to the extracted `BepInEx/core`

The workflow passes these to MSBuild as `GameManagedDir` and `BepInExCoreDir`. A DLL artifact is published only after Windows compilation, output verification and SHA-256 reporting succeed.

## Security invariants

- Resolve player identity server-side from the authenticated SPT session / server profile.
- Treat client-submitted mission completion, kills, extraction claims and reward claims as untrusted.
- Fika integration must remain read-only until server-side evidence is validated against the exact Fika 2.4.3 lifecycle.
- Issue rewards only from server-verifiable evidence or explicit administrator review.
- Never commit player data, WireGuard private keys, tokens, EFT/Unity assemblies or BepInEx binaries.

## Current repository status

The CI bootstrap and build-readiness audit are committed. The 1.9.1 source bundle has been located in the user's ChatGPT Library and validated locally, but its source tree is **not yet committed** to this repository. Consequently no CI test run or client DLL artifact has been produced yet.

The local source checks already executed successfully: `npm run check` and `npm test` (26 passed, 0 failed). These do not replace the Windows DLL build or in-game runtime validation.

See [Compatibility and Build Readiness](docs/COMPATIBILITY-AND-BUILD-READINESS.md) for the verified archive inventory, reference mapping, audit findings and remaining work.
