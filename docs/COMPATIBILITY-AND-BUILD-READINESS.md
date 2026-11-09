# Compatibility and build readiness

Audit date: 2026-11-09

## Verified local source inputs

The user's Library folder `/Escape From Tarkov - SPT 3.11.1 - Source` contains these archives:

- `EscapeFromTarkov_Data.zip` — 183 entries; ZIP integrity check passed. Includes `Managed/Assembly-CSharp.dll`, `Managed/mscorlib.dll`, `Managed/UnityEngine.dll`, `UnityEngine.CoreModule.dll`, `UnityEngine.IMGUIModule.dll`, `UnityEngine.UnityWebRequestModule.dll`, and `UnityEngine.JSONSerializeModule.dll`.
- `BepInEx-(no server-is player).zip` — 160 entries; ZIP integrity check passed. Includes `BepInEx/core/BepInEx.dll`, `0Harmony.dll`, and `BepInEx/plugins/Fika.Core.dll`.
- `Takove Server - SPT 3.11.1.zip` — includes the Fika server source package. Its `user/mods/fika-server/package.json` identifies Fika Server `2.4.3` and SPT `~3.11`.
- `base file Server - spt 3.11.1.zip` — server distribution archive.
- `Escape.From.Tarkov.v0.16.1.3.35392-P2P-SPT Luncher.zip` — launcher/game bootstrap files.

The BepInEx archive's `BepInEx/config/com.fika.core.cfg` explicitly identifies Fika client plugin `v1.2.3`. Thus the client and server versions are independently confirmed: Fika client 1.2.3 and Fika Server 2.4.3.

All five ZIP archives passed `ZipFile.testzip()` in the audit environment.

## Source bundle validation

The `EFT-Operations-1.9.1.zip` source bundle contains 90 entries and passed ZIP integrity validation. It includes the SPT server mod, browser admin UI, operations service, Fika adapter, BepInEx client plugin source and tests.

Executed in the audit environment using Node.js 22.16.0 / npm 10.9.2:

- `npm run check`: PASS
- `npm test`: PASS — 26 passed, 0 failed

These are source-level checks only. They do not prove SPT runtime compatibility, in-game UI behavior, or a successful C# DLL build.

## Client project references

The client project targets .NET Framework 4.7.2 and C# 7.3. Its project file references:

- BepInEx: `BepInEx/core/BepInEx.dll`
- Harmony: `BepInEx/core/0Harmony.dll`
- Unity: `UnityEngine.dll`, `UnityEngine.CoreModule.dll`, `UnityEngine.IMGUIModule.dll`, `UnityEngine.UnityWebRequestModule.dll`, `UnityEngine.JSONSerializeModule.dll`

All named reference files were found in the user's supplied archives. Do not commit game or Unity assemblies to this public repository. BepInEx and Fika binaries should also remain outside source control; build against the user's local installation.

## Important functional gaps found during static audit

1. The Fika 2.4.3 adapter observes `LocationLifecycleService.endLocalRaid` and `FikaMatchService.endMatch`, but it does not call `OperationsService.startGroup`, `recordRaidEvent`, or `finishGroup`. Those methods currently have no production call sites outside their own definitions. Consequently the raid-to-mission lifecycle is not wired end-to-end.
2. The raid-end request contains client-originated result fields. The adapter correctly marks this evidence `untrusted_client_report` and `rewardEligible: false`; these fields must never directly award mission rewards.
3. The current adapter is a read-only observer, not a Fika raid orchestration controller. Keep that boundary until server-side evidence and actual Fika 2.4.3 lifecycle behavior are validated.
4. Mission acceptance and squad ready state are wired to authenticated SPT static routes. They do not yet prove objective completion or extraction.
5. The BepInEx client UI currently uses Unity IMGUI and F8; it is a functional prototype surface, not a final polished in-game interface.

## Build environment limitation

The audit container has Node.js but no `dotnet`, `msbuild`, `csc`, `mcs`, `mono`, or PowerShell. Therefore it cannot produce or execute `EFTOperations.Client.dll`.

The repository workflow uses a Windows self-hosted runner labelled `self-hosted, Windows, X64, eft-build`. The runner must be registered on the machine containing the extracted EFT and BepInEx folders, with Actions variables:

- `EFT_MANAGED_DIR` = absolute path to `EscapeFromTarkov_Data/Managed`
- `BEPINEX_CORE_DIR` = absolute path to `BepInEx/core`

A DLL is not considered built until the Windows job succeeds, verifies the output file, and uploads the artifact.

## Safe next implementation sequence

1. Import the 1.9.1 source bundle into this repository (source only; exclude game/BepInEx DLLs, player data, configs with secrets and runtime state).
2. Run server checks and all tests in CI.
3. Build the client on the local Windows runner against the verified assemblies.
4. Add integration tests and a server-side raid evidence adapter for the exact SPT/Fika 2.4.3 code paths.
5. Only after evidence validation, connect verified objectives and rewards. Keep administrator review as the fallback.
6. Test in a disposable SPT profile and a private Fika session before deployment.
