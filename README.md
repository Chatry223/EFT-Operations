# EFT Operations

Mission / campaign operations and EconomyGuard integration for SPT.

## Compatibility target

- EFT build: `0.16.1.3.35392-P2P`
- SPT: `3.11.1`
- Fika Server: `2.4.3`
- Fika client plugin: `1.2.3`
- Client plugin: .NET Framework 4.7.2 / C# 7.3 / BepInEx

## Project layout

- `source/EFT-Operations-1.9.1/user/mods/SPT-EconomyGuard`: server mod, admin panel, mission API, Fika adapter and tests.
- `source/EFT-Operations-1.9.1/client/EFT.Operations.Client`: BepInEx client plugin source and graphical build helper.
- `.github/workflows/server-checks.yml`: Linux server tests plus Windows PowerShell helper validation.
- `.github/workflows/build-client.yml`: optional build on a private Windows EFT runner.

## Build the client plugin with the graphical helper

The source is already committed in this repository. On the Windows machine containing EFT/SPT and BepInEx:

1. Open `source/EFT-Operations-1.9.1/client/EFT.Operations.Client/BUILD-GUI.bat`.
2. In the window, select the EFT `EscapeFromTarkov_Data/Managed` folder (or the game root).
3. Select the `BepInEx/core` folder (or the BepInEx root).
4. Click **Build and Install DLL**.

The helper locates Visual Studio MSBuild, validates the required local references, builds Release/net472, installs `EFTOperations.Client.dll` into `BepInEx/plugins/EFTOperations`, and writes a SHA-256 build report. No command-line input is required. It has not yet been executed on the user's Windows machine, so this is a prepared build path, not a claim that the DLL has already been produced.

Visual Studio must include MSBuild and the .NET Framework 4.7.2 targeting pack. Do not copy game/Unity/BepInEx binaries into this public repository.

## Optional GitHub Windows build

The public repository intentionally does not contain EFT or BepInEx assemblies. To enable the optional CI DLL build, configure a private self-hosted Windows runner on the EFT machine with labels `self-hosted`, `Windows`, `X64`, `eft-build`; set Actions variables `EFT_MANAGED_DIR` and `BEPINEX_CORE_DIR`; then set `EFT_BUILD_RUNNER_ENABLED=true`. Until that explicit flag is enabled, the client build job is skipped rather than left queued indefinitely.

## Mission and reward trust model

- Player identity is resolved server-side from the authenticated SPT session.
- Ready mission groups are linked to Fika matches only after every accepted member is present in the same map/match. PMC and Scav character IDs are both matched to the same SPT account.
- Fika's server-side player roster/death state is recorded before match deletion.
- Client-submitted extraction and raid results remain untrusted. They can populate a manual review record but cannot auto-award.
- Manual approval requires an evidence reference and explicit administrator confirmation of objectives and all member extractions.
- No client route can submit mission progress or award requests.

## Current validation boundary

The latest server CI run for the Scav-aware Fika lifecycle bridge passed static checks and **27 tests, 0 failures**. The PowerShell GUI helper has a Windows syntax-validation job. Neither result replaces a local Windows compile or an in-game SPT 3.11.1 + Fika 2.4.3 runtime test. Mission objective events (for example, AI kill attribution) are not yet authoritatively sourced by this adapter; until that is implemented, approval remains a manual admin decision.
