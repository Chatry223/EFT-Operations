# Compatibility and build readiness

Audit date: 2026-11-09

## Exact target

| Component | Verified target |
|---|---|
| EFT | `0.16.1.3.35392-P2P` |
| SPT | `3.11.1` |
| Fika Server | `2.4.3` |
| Fika client plugin | `1.2.3` / assembly `1.2.3.0` |
| SPT Common client assembly | `3.11.1.0` |
| Client plugin | .NET Framework 4.7.2, C# 7.3, BepInEx |

Fika Server and Fika client versions are separate tracks. The official Fika Server 2.4.3 `package.json` identifies `sptVersion: ~3.11`; the installed Fika client config and assembly identify 1.2.3. The upstream Fika Plugin `v1.2.3` source was checked for the native matchmaker UI fields.

## Dependency archives: verified

The user's Library source archives were materialized and inspected:

- `EscapeFromTarkov_Data.zip`: 183 entries; ZIP CRC test passed.
- `BepInEx-(no server-is player).zip`: 160 entries; ZIP CRC test passed.
- The EFT archive contains `Managed/Assembly-CSharp.dll` and all required Unity modules.
- The BepInEx archive contains `BepInEx/core/BepInEx.dll`, `0Harmony.dll`, `BepInEx/plugins/Fika.Core.dll`, `BepInEx/plugins/spt/spt-common.dll`, and `BepInEx/config/com.fika.core.cfg`.

The user then added the compact equivalents to the repository:
- `source/EscapeFromTarkov_Data.zip` (6,212,293 bytes)
- `source/BepInEx.zip` (1,550,865 bytes)

The new GitHub Actions dependency verifier passed on commit `a3360cc51e67918a0804761b591a91888729338c`. It validates archive CRCs, exact SHA-256 fingerprints for the required game/Unity/BepInEx/Fika/SPT DLLs, and the Fika config header. These are build-time inputs only and are not included in the installable mod artifact.

Verified fingerprints captured from the inspected Library archives:

| File | SHA-256 |
|---|---|
| `Assembly-CSharp.dll` | `12d5fd1728c58a9cd71a454fb5eae506b5a0a3c2bb35d543c4022800e10f47d5` |
| `UnityEngine.CoreModule.dll` | `f7cfb53eb5b6a652d6bef329b33c154d8ccb0de7448ac5bfa1318762e10f7241` |
| `BepInEx.dll` | `2674d3aecf3097bee817abe7e8bbcc42bf583df51402069d5fcd4fbed55017ce` |
| `Fika.Core.dll` | `246d45e0f9ef445484802379383cb8bb52901d013a1e244ba2209048c7dce65a` |
| `spt-common.dll` | `970dab34fa09f8c6930f5011aae4025d1f2dc4874a27ff0b3cd7da06899b964f` |

**Distribution caution:** EFT game assemblies are copyrighted game binaries. Do not put these archives into the mod release ZIP. Since they are currently in a public GitHub repository, verify your right to publish them; private/local storage is safer.

## Client project reference audit

The client source uses BepInEx and Unity types directly. The project references BepInEx, Harmony and the Unity modules needed for IMGUI/JsonUtility. It does **not** directly reference `Assembly-CSharp.dll`, `Fika.Core.dll`, or `spt-common.dll`; the client bridge uses reflection for EFT/Fika/SPT runtime discovery. These assemblies are validated by the builder as exact target inputs, not passed to the compiler as direct project references.

The SPT 3.11.x source was checked:
- `SPT.Common.Http.RequestHandler` is in assembly **`spt-common.dll`**, whose `AssemblyName` is `spt-common`, not `SPT.Common`.
- It exposes static `Host`, `SessionId`, and `HttpClient`.
- Its `HttpClient` is `SPT.Common.Http.Client`; it exposes `GetAsync(string)` and `PostAsync(string, byte[], bool)`.
- The Operations client bridge was corrected to search loaded assemblies first and then load the exact `spt-common` assembly identity. This avoids relying on the incorrect `SPT.Common` assembly name.

The SPT 3.11.x server source was also checked for `StaticRouterModService.registerStaticRouter` and `HttpResponseUtil.noBody`; the Operations custom router prefix and JSON response shape follow that API.

## Build pipeline and actual result

The graphical helper now:
- loads the two repository ZIPs into a hash-keyed local cache;
- validates the exact target SHA-256 values and Fika/SPT assembly versions;
- runs MSBuild with NuGet restore;
- requires the actual installed BepInEx root as a separate install destination, so it cannot silently place the plugin in the temporary dependency cache;
- backs up any existing plugin DLL and writes a build report.

GitHub Actions validates the dependency archives and builds on a Windows-hosted runner. The first Windows attempt failed with `NETSDK1004` because project assets had not been restored; MSBuild `/restore` was added. A subsequent build on commit `248e5924bc331167a908f050f8eee7a6574dde12` succeeded, verified the DLL output, and uploaded artifact `13705463291`.

Build output:
- `EFTOperations.Client.dll`: 27,136 bytes
- SHA-256: `443602390928327e748d6e8d7cc6e810b7d04bf8e0abed9b9d8fe325b0e0d4ef`
- Artifact: [GitHub Actions build](https://github.com/Chatry223/EFT-Operations/actions/runs/42687894189/artifacts/13705463291)

The DLL is compile-verified, not yet runtime-verified in the user's SPT/Fika installation.

## Fika 2.4.3 mission lifecycle: current truth

The version-gated adapter:
- validates Fika server `2.4.3` and SPT `~3.11`;
- binds a mission group only after all accepted, Ready members are present in the same Fika match and map;
- calls `OperationsService.startGroup` to move that group into `in_raid`;
- observes Fika `endMatch` and direct `deleteMatch` paths before the roster is deleted; `createMatch` clears the dedupe marker if a server ID is reused;
- calls `OperationsService.finishGroup` with roster/death flags and any matching raid-end reports, but explicitly sets `verified: false`;
- moves the group to manual review; it never automatically awards points/items from these events.

Important limitations:
1. Production code does not yet call `recordRaidEvent`; objective counters do not advance from real game events. The test suite manually injects a synthetic extract event, which is not proof that the live adapter collects it.
2. Fika's `handlePlayerDied` callback contains `serverId` and `profileId`, but not a killer identity. The adapter validates the profile/session relationship and stores an `authenticated_client_report` death event for admin review; it does not progress kill objectives.
3. SPT `IEndLocalRaidRequestData.results.profile.Stats.Eft` includes client-reported `Victims`, `SessionCounters`, `FoundInRaidItems`, and `DroppedItems`. The adapter stores these as untrusted evidence and cross-checks victim profile IDs against Fika death reports when possible.
4. For loot evidence, the adapter snapshots inventory at raid start and counts only new `SpawnedInSession` items that remain in the SaveServer profile after SPT processes the raid-end request. This is stronger than a raw client list, but it is still not server-authoritative proof of where an item was obtained.
5. Visit-zone position telemetry is not yet implemented in the client plugin; `visit` objectives currently require manual evidence. A fully server-authoritative kill/loot/visit objective feed has not yet been implemented. `recordRaidEvent` accepts only explicitly marked server-verified events and is not called by the production adapter. Admin review remains mandatory.

## Runtime acceptance still required

On a disposable copy of SPT, validate:
- BepInEx loads the built DLL without type-load or missing-method errors.
- F8 panel can authenticate using the native SPT session and configured backend URL.
- Fika client 1.2.3 host UI is found and the native Start button is invoked only for the ready squad leader on the correct map.
- Fika Server 2.4.3 links all PMC/Scav members to the correct Operations group.
- Fika match end creates a review record without issuing automatic rewards.
- Manual approval and reward delivery are idempotent and auditable.

The audit container has no .NET/MSBuild/Mono toolchain, so actual C# compilation is delegated to the Windows GitHub Actions runner.
