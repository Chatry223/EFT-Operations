# EFT Operations

Mission / campaign operations and EconomyGuard integration for SPT.

## Compatibility target

- EFT build: `0.16.1.3.35392-P2P`
- SPT: `3.11.1`
- Fika Server: `2.4.3`
- Fika client plugin target: `1.2.3` (the BepInEx config's hidden `Last Version` value is advisory; loaded plugin metadata is authoritative)
- Client plugin: .NET Framework 4.7.2 / C# 7.3 / BepInEx

## Project layout

- `source/EFT-Operations-1.9.1/user/mods/SPT-EconomyGuard`: server mod, admin panel, mission API, Fika adapter and tests.
- `source/EFT-Operations-1.9.1/client/EFT.Operations.Client`: BepInEx client plugin source and graphical build helper.
- `.github/workflows/server-checks.yml`: Linux server tests plus Windows PowerShell helper validation.
- `source/EscapeFromTarkov_Data.zip` and `source/BepInEx.zip`: build-time dependency archives; the CI verifier checks their ZIP integrity and exact target SHA-256 fingerprints.
- `.github/workflows/build-client.yml`: dependency verification plus a Windows-hosted client DLL build on pushes (not on pull requests).

## Build the client plugin with the graphical helper

The source is already committed in this repository. On the Windows machine containing EFT/SPT and BepInEx:

1. Open `source/EFT-Operations-1.9.1/client/EFT.Operations.Client/BUILD-GUI.bat`.
2. Click **Load bundled ZIPs** to extract the verified build references into the local cache, or browse to your installed EFT/BepInEx folders.
3. Select the **actual installed BepInEx root** in the third field (the folder containing `core` and `plugins`). If the actual EFT and BepInEx paths are selected, the helper can infer this folder.
4. Click **Build and Install DLL**.

The GUI validates exact SHA-256 fingerprints for `Assembly-CSharp.dll`, `Fika.Core.dll` and `spt-common.dll`, checks Fika client `1.2.3.0` and SPT Common `3.11.1.0`, runs MSBuild with NuGet restore, backs up an existing plugin DLL, installs the new DLL into the actual selected `BepInEx/plugins/EFTOperations` folder, and writes a build report. It never installs into the temporary dependency cache.

Visual Studio/MSBuild and the .NET Framework 4.7.2 targeting pack are required for the local GUI build. The GitHub Actions build uses the same two archives on a Windows-hosted runner and uploads the DLL plus report when the build succeeds.

**Binary distribution caution:** the two dependency ZIPs are currently present in this repository as build inputs. They must not be copied into the installable mod package or redistributed as game files. Because EFT assemblies are copyrighted game binaries, confirm you have permission to keep them in a public repository; a private repository or local-only copies are safer.

## Tested server-mod package

The latest successful Actions run publishes an installable archive named `EFT-Operations-ServerMod-<commit>`. Download the Actions artifact ZIP and extract it once; inside it is `SPT-EconomyGuard-1.9.1-<commit>.zip` plus its SHA-256 file. Extract that inner mod ZIP into the SPT server root so the included `user/mods/SPT-EconomyGuard` path is preserved. Stop the SPT server first and back up the existing `user/mods/SPT-EconomyGuard` folder; the separate `SPT-EconomyGuard-Data` directory contains live server data and is not part of the package. This is one updated server mod, not a second SPT server installation. The CI package includes a ZIP integrity check and SHA-256 file.

The package is a CI-tested server-mod build, not yet a runtime-certified release. Validate it on a backed-up test server before replacing the live installation.

## Mission and reward trust model
- Approved points update the rank ledger immediately. Rouble/item rewards are delivered through SPT system mail after approval; failed or interrupted deliveries enter `delivery_attention_required` and are never retried automatically. The admin Awards ledger provides an audited manual retry / mark-delivered reconciliation action.

- Player identity is resolved server-side from the authenticated SPT session.
- Ready mission groups are linked to Fika matches only after every accepted member is present in the same map/match. PMC and Scav character IDs are both matched to the same SPT account. The in-game leader action invokes Fika client 1.2.3's native Start button only when the native host screen is active, the client plugin version is 1.2.3, the squad is fully ready, and the selected map matches the mission. Other members still join through Fika's native raid list; direct auto-join is not claimed.
- Fika's authenticated registered-player roster is captured before match deletion. Cached death flags originate from player update callbacks and are corroborating, not authoritative proof.
- Fika player registration/create/leave callbacks are bound to the authenticated SPT session. A player's own death flag and extraction/raid-result report still originate from that client; they can populate a manual review record but cannot auto-award.
- Manual approval requires an evidence reference and explicit administrator confirmation of objectives and all member extractions.
- No client route can submit mission progress or award requests.

## Current validation boundary

The dependency-archive verifier now checks CRC integrity and exact SHA-256 fingerprints against the verified target archives. The Windows client build has been enabled on GitHub-hosted Windows runners; its first attempt reached MSBuild but failed because NuGet restore had not been requested. The workflow and GUI were updated to run MSBuild with `/restore`; the next run is the acceptance check. A successful CI compile still does not replace an in-game SPT 3.11.1 + Fika 2.4.3 runtime test. The adapter links ready groups to Fika matches and moves them to manual review at match end, but it does not yet collect authoritative kill/loot/visit objective progress.
