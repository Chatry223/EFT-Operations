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

The client build references Unity and BepInEx assemblies from the actual EFT installation. Do not commit those proprietary/runtime DLLs to this public repository.

Configure a Windows self-hosted GitHub Actions runner on the EFT machine with labels:
`self-hosted`, `Windows`, `X64`, `eft-build`.

Set repository Actions variables:
- `EFT_MANAGED_DIR`: full path to `EscapeFromTarkov_Data/Managed`
- `BEPINEX_CORE_DIR`: full path to `BepInEx/core`

The workflow passes these to MSBuild as `GameManagedDir` and `BepInExCoreDir`, matching the project file. Run **Actions → EFT Operations CI and Client Build → Run workflow**. A DLL artifact is published only after compilation and output verification succeed.

## Security invariants

- Resolve player identity server-side from the authenticated SPT session / server profile.
- Treat client-submitted mission completion, kills, extraction claims and reward claims as untrusted.
- Fika Server 2.4.3 integration is read-only/observer; do not assume unsupported lifecycle control.
- Issue rewards only from server-verifiable evidence or explicit administrator review.
- Never commit player data, WireGuard private keys, tokens, EFT/Unity assemblies or BepInEx binaries.

## Source import status

The 1.9.1 source bundle is available as a conversation attachment for import into this repository. The repository workflow bootstrap is present, but the source tree must be committed before CI can pass. A workflow file is not a compiled or tested DLL.
