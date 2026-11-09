using BepInEx;
using BepInEx.Configuration;
using HarmonyLib;
using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using System.Text;
using System.Threading.Tasks;
using UnityEngine;

namespace EFTOperations.Client
{
    [BepInPlugin("com.eft.operations.client", "EFT Operations", "0.1.0")]
    [BepInDependency("com.fika.core", BepInDependency.DependencyFlags.SoftDependency)]
    public sealed class Plugin : BaseUnityPlugin
    {
        private ConfigEntry<KeyCode> toggleKey;
        private ConfigEntry<float> refreshSeconds;
        private static Plugin instance;
        private static bool inputLookupAttempted;
        private Harmony fikaHarmony;
        private bool fikaKillHookInstalled;
        private readonly HashSet<string> reportedHostKillKeys = new HashSet<string>();
        private readonly Queue<string> reportedHostKillOrder = new Queue<string>();
        private static MethodInfo inputGetKeyDown;
        private bool visible;
        private bool busy;
        private string status = "Connecting to Operations service...";
        private MissionListResponse missions = new MissionListResponse();
        private PlayerStateResponse playerState = new PlayerStateResponse();
        private Vector2 scroll;
        private Vector2 raidHudScroll;
        private float nextRefresh;
        private readonly HashSet<string> knownMissionIds = new HashSet<string>();
        private bool hasInitialMissionSync;
        private bool fikaStartRequested;
        private float fikaStartRequestedUntil;
        private string notificationText = String.Empty;
        private float notificationUntil;

        private void Awake()
        {
            instance = this;
            toggleKey = Config.Bind("Interface", "ToggleKey", KeyCode.F8, "Open or close the mission interface.");
            refreshSeconds = Config.Bind("Interface", "RefreshSeconds", 12f, "Automatic status refresh interval.");
            Version bepinexVersion = typeof(BaseUnityPlugin).Assembly.GetName().Version;
            Logger.LogInfo("EFT Operations client loaded. UI key: " + toggleKey.Value);
            Logger.LogInfo("Runtime fingerprint: Unity " + Application.unityVersion
                + " / CLR " + Environment.Version
                + " / BepInEx " + (bepinexVersion == null ? "unknown" : bepinexVersion.ToString()));
            if (!String.Equals(Application.unityVersion, "2022.3.43f1", StringComparison.Ordinal))
                Logger.LogWarning("EFT Operations was built for Unity 2022.3.43f1; detected " + Application.unityVersion + ". Continue only after compatibility review.");
            if (bepinexVersion == null || bepinexVersion.Major != 5 || bepinexVersion.Minor != 4 || bepinexVersion.Build != 22)
                Logger.LogWarning("EFT Operations was validated against BepInEx 5.4.22.0; detected " + (bepinexVersion == null ? "unknown" : bepinexVersion.ToString()) + ".");
            EnsureInputBridge();
            Logger.LogInfo("Authentication bridge: SPT 3.11.1 RequestHandler (SessionId + native HttpClient).");
            StartCoroutine(RefreshLoop());
            StartCoroutine(FikaKillHookBootstrap());
        }

        private void Update()
        {
            if (fikaStartRequested && Time.realtimeSinceStartup >= fikaStartRequestedUntil)
            {
                fikaStartRequested = false;
                status = "No active Fika match was detected after the host request. Review Fika's message and retry if needed.";
            }
            if (IsToggleKeyDown())
            {
                visible = !visible;
                if (visible) RefreshAll();
            }
        }

        private IEnumerator RefreshLoop()
        {
            while (true)
            {
                if (Time.realtimeSinceStartup >= nextRefresh && !busy)
                {
                    nextRefresh = Time.realtimeSinceStartup + Mathf.Clamp(refreshSeconds.Value, 5f, 60f);
                    RefreshAll();
                }
                yield return new WaitForSecondsRealtime(1f);
            }
        }

        private void RefreshAll()
        {
            if (busy) return;
            StartCoroutine(Request("/client/eft/operations/missions", null, delegate(string body)
            {
                MissionListResponse nextMissions = JsonUtility.FromJson<MissionListResponse>(body) ?? new MissionListResponse();
                if (nextMissions.ok && nextMissions.missions != null)
                {
                    foreach (MissionDto mission in nextMissions.missions)
                    {
                        if (String.IsNullOrEmpty(mission.id)) continue;
                        if (hasInitialMissionSync && !knownMissionIds.Contains(mission.id))
                            Notify("NEW OPERATION AVAILABLE  /  " + (mission.title ?? "FIELD ASSIGNMENT"));
                        knownMissionIds.Add(mission.id);
                    }
                    hasInitialMissionSync = true;
                }
                missions = nextMissions;
                if (!missions.ok) status = "Mission list: " + missions.error;
                else status = "Mission board synchronized.";
                StartCoroutine(Request("/client/eft/operations/state", null, delegate(string stateBody)
                {
                    PlayerStateResponse nextState = JsonUtility.FromJson<PlayerStateResponse>(stateBody) ?? new PlayerStateResponse();
                    if (nextState.ok)
                    {
                        string previousGroupState = playerState.group == null ? null : playerState.group.state;
                        string currentGroupState = nextState.group == null ? null : nextState.group.state;
                        if (currentGroupState == "in_raid") fikaStartRequested = false;
                        if (currentGroupState == "in_raid" && previousGroupState != "in_raid")
                            Notify("OPERATION DEPLOYED  /  " + (nextState.mission == null ? "MISSION ACTIVE" : nextState.mission.title));
                        else if (previousGroupState == "in_raid" && currentGroupState != "in_raid")
                            Notify("RAID SESSION ENDED  /  RESULT PENDING ADMIN REVIEW");
                    }
                    playerState = nextState;
                    if (!playerState.ok) status = "Player state: " + playerState.error;
                }));
            }));
        }

        private IEnumerator Request(string route, string jsonBody, Action<string> completed)
        {
            // Serialize requests. This also prevents the mission/state callbacks from
            // racing each other and incorrectly clearing the shared busy flag.
            while (busy) yield return null;
            busy = true;

            string sessionId;
            string host;
            object nativeClient;
            string bridgeError;
            if (!SptBackendBridge.TryGetContext(out sessionId, out host, out nativeClient, out bridgeError))
            {
                status = bridgeError;
                Logger.LogWarning(status);
                busy = false;
                yield break;
            }

            string path = "/EFTOperations" + (route.StartsWith("/") ? route : "/" + route);
            Task<byte[]> task;
            try
            {
                byte[] payload = String.IsNullOrEmpty(jsonBody) ? null : Encoding.UTF8.GetBytes(jsonBody);
                task = SptBackendBridge.Send(nativeClient, path, payload);
            }
            catch (Exception ex)
            {
                status = "Could not start SPT backend request: " + ex.GetBaseException().Message;
                Logger.LogError(status);
                busy = false;
                yield break;
            }

            while (!task.IsCompleted) yield return null;

            if (task.IsCanceled || task.IsFaulted)
            {
                Exception error = task.Exception == null ? null : task.Exception.GetBaseException();
                status = "Operations request failed: " + (error == null ? "REQUEST_CANCELLED" : error.Message);
                Logger.LogWarning(status + " [" + host + path + "]");
                busy = false;
            }
            else
            {
                string body = Encoding.UTF8.GetString(task.Result ?? new byte[0]);
                // Release the queue before invoking callbacks: callbacks may enqueue the
                // next request (mission list -> player state, accept -> refresh).
                busy = false;
                try
                {
                    if (completed != null) completed(body);
                }
                catch (Exception ex)
                {
                    status = "Invalid Operations response: " + ex.GetBaseException().Message;
                    Logger.LogWarning(status);
                }
            }
        }

        private void StartFikaHost()
        {
            if (!playerState.canStart || playerState.group == null || !playerState.group.isLeader)
            {
                status = "Only the squad leader can start after every required operator is ready.";
                return;
            }
            try
            {
                string fikaVersion = GetFikaPluginVersion();
                if (fikaVersion != "1.2.3" && fikaVersion != "1.2.3.0")
                {
                    status = "Fika client 1.2.3 is required for the operation host bridge. Detected: " + (fikaVersion ?? "not loaded");
                    return;
                }

                Type scriptType = FindLoadedType("Fika.Core.UI.Custom.MatchMakerUIScript");
                if (scriptType == null)
                {
                    status = "Fika host screen not found. Select the mission map and time, continue to Fika's host screen, then open Operations.";
                    return;
                }

                UnityEngine.Object[] components = Resources.FindObjectsOfTypeAll(scriptType);
                foreach (UnityEngine.Object component in components)
                {
                    if (component == null) continue;
                    // Fika client 1.2.3 (the user's installed build) uses the lower-camel
                    // fields `fikaMatchMakerUi` and `raidSettings`. Later Fika builds renamed
                    // these to `_fikaMatchMakerUi` / `RaidSettings`; support both without
                    // compiling against Fika's private implementation types.
                    object fikaUi = ReadMember(component, "fikaMatchMakerUi") ?? ReadMember(component, "_fikaMatchMakerUi");
                    object raidSettings = ReadMember(component, "raidSettings") ?? ReadMember(component, "RaidSettings");
                    if (fikaUi == null || raidSettings == null) continue;

                    object selectedLocation = ReadMember(raidSettings, "SelectedLocation");
                    string selectedMap = ReadMember(selectedLocation, "_Id") as string;
                    if (String.IsNullOrWhiteSpace(selectedMap)) selectedMap = ReadMember(selectedLocation, "Id") as string;
                    if (String.IsNullOrWhiteSpace(selectedMap) || !String.Equals(selectedMap, playerState.mission == null ? "" : playerState.mission.map, StringComparison.OrdinalIgnoreCase))
                    {
                        status = "Selected EFT map does not match the operation map (" + (playerState.mission == null ? "unknown" : playerState.mission.map) + "). Return and select the required map.";
                        return;
                    }

                    object dedicatedToggle = ReadMember(fikaUi, "DedicatedToggle");
                    object dedicatedValue = ReadMember(dedicatedToggle, "isOn");
                    if (dedicatedValue is bool && (bool)dedicatedValue)
                    {
                        status = "Dedicated/headless hosting is not supported by this one-click client host action. Turn off Dedicated Host in Fika.";
                        return;
                    }

                    object startButton = ReadMember(fikaUi, "StartButton");
                    object active = ReadMember(ReadMember(startButton, "gameObject"), "activeInHierarchy");
                    object interactable = ReadMember(startButton, "interactable");
                    if (startButton == null || (active is bool && !(bool)active) || (interactable is bool && !(bool)interactable))
                    {
                        status = "Fika Start button is not currently available.";
                        return;
                    }
                    object onClick = ReadMember(startButton, "onClick");
                    MethodInfo invoke = onClick == null ? null : onClick.GetType().GetMethod("Invoke", Type.EmptyTypes);
                    if (invoke == null)
                    {
                        status = "Could not resolve Fika's native Start button event.";
                        return;
                    }

                    // Invoke the exact Fika client 1.2.3 native Start button listener. This preserves
                    // Fika's Force IP validation, match creation, and normal EFT transition.
                    invoke.Invoke(onClick, null);
                    fikaStartRequested = true;
                    fikaStartRequestedUntil = Time.realtimeSinceStartup + 30f;
                    status = "Fika host start requested. Waiting for the native Fika match to appear.";
                    return;
                }
                status = "Fika host UI is not active. Open the native Fika Host Raid screen first.";
            }
            catch (Exception ex)
            {
                status = "Fika host bridge failed safely: " + ex.GetBaseException().Message;
                Logger.LogWarning(status);
            }
        }

        private static string GetFikaPluginVersion()
        {
            try
            {
                Type chainloader = typeof(BaseUnityPlugin).Assembly.GetType("BepInEx.Bootstrap.Chainloader");
                object pluginInfos = ReadMember(chainloader, "PluginInfos");
                if (pluginInfos is IDictionary)
                {
                    object pluginInfo = ((IDictionary)pluginInfos)["com.fika.core"];
                    object metadata = ReadMember(pluginInfo, "Metadata");
                    object version = ReadMember(metadata, "Version");
                    return version == null ? null : version.ToString();
                }
            }
            catch { }
            return null;
        }

        private static Type FindLoadedType(string fullName)
        {
            foreach (Assembly assembly in AppDomain.CurrentDomain.GetAssemblies())
            {
                Type found = assembly.GetType(fullName, false);
                if (found != null) return found;
            }
            return null;
        }

        private static object ReadMember(object instance, string name)
        {
            if (instance == null) return null;
            const BindingFlags flags = BindingFlags.Instance | BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic;
            Type type = instance as Type ?? instance.GetType();
            FieldInfo field = type.GetField(name, flags);
            if (field != null) return field.GetValue(instance is Type ? null : instance);
            PropertyInfo property = type.GetProperty(name, flags);
            if (property != null && property.GetIndexParameters().Length == 0)
                return property.GetValue(instance is Type ? null : instance, null);
            return null;
        }

        private void Accept(string missionId)
        {
            StartCoroutine(Request("/client/eft/operations/accept", "{\"missionId\":\"" + Escape(missionId) + "\"}", delegate(string body)
            {
                ActionResponse response = JsonUtility.FromJson<ActionResponse>(body);
                status = response != null && response.ok ? "Mission accepted. Squad is forming." : "Accept failed: " + (response == null ? "INVALID_RESPONSE" : response.error);
                RefreshAll();
            }));
        }

        private void Ready(bool ready)
        {
            if (playerState.group == null) return;
            string body = "{\"groupId\":\"" + Escape(playerState.group.id) + "\",\"ready\":" + (ready ? "true" : "false") + "}";
            StartCoroutine(Request("/client/eft/operations/ready", body, delegate(string responseBody)
            {
                ActionResponse response = JsonUtility.FromJson<ActionResponse>(responseBody);
                status = response != null && response.ok ? (response.canStart ? "All members ready. The squad leader can start through Fika." : "Ready status updated.") : "Ready failed: " + (response == null ? "INVALID_RESPONSE" : response.error);
                RefreshAll();
            }));
        }

        private void Leave()
        {
            if (playerState.group == null) return;
            string body = "{\"groupId\":\"" + Escape(playerState.group.id) + "\"}";
            StartCoroutine(Request("/client/eft/operations/leave", body, delegate(string responseBody)
            {
                ActionResponse response = JsonUtility.FromJson<ActionResponse>(responseBody);
                status = response != null && response.ok ? "You left the forming squad." : "Leave failed: " + (response == null ? "INVALID_RESPONSE" : response.error);
                RefreshAll();
            }));
        }

        private void Notify(string message)
        {
            notificationText = message ?? String.Empty;
            notificationUntil = Time.realtimeSinceStartup + 9f;
        }

        private void OnGUI()
        {
            if (Time.realtimeSinceStartup < notificationUntil && !String.IsNullOrEmpty(notificationText))
            {
                float bannerWidth = Mathf.Min(760f, Screen.width - 36f);
                Rect banner = new Rect((Screen.width - bannerWidth) / 2f, 18f, bannerWidth, 46f);
                GUI.Box(banner, GUIContent.none);
                GUI.Label(new Rect(banner.x + 14f, banner.y + 8f, banner.width - 28f, 30f), notificationText, NotificationStyle());
            }
            DrawRaidHud();
            if (!visible) return;
            float width = Mathf.Min(720f, Screen.width - 30f);
            float height = Mathf.Min(680f, Screen.height - 30f);
            Rect panel = new Rect((Screen.width - width) / 2f, (Screen.height - height) / 2f, width, height);
            GUI.Box(panel, GUIContent.none);
            GUILayout.BeginArea(new Rect(panel.x + 16f, panel.y + 12f, panel.width - 32f, panel.height - 24f));
            GUILayout.BeginHorizontal();
            GUILayout.Label("FIELD OPERATIONS  /  MISSION CONTROL", HeaderStyle());
            GUILayout.FlexibleSpace();
            if (GUILayout.Button("REFRESH", GUILayout.Width(90f))) RefreshAll();
            if (GUILayout.Button("X", GUILayout.Width(28f))) visible = false;
            GUILayout.EndHorizontal();
            GUILayout.Label(status, SmallStyle());
            if (playerState.player != null)
                GUILayout.Label("OPERATOR RANK  /  " + (playerState.player.rank ?? "Recruit").ToUpperInvariant() + "     ·     " + playerState.player.points + " POINTS", SmallStyle());
            GUILayout.Space(8f);

            if (playerState.group != null)
            {
                GroupDto group = playerState.group;
                int memberCount = group.members == null ? 0 : group.members.Length;
                int readyCount = group.readyCount;
                GUILayout.Label("YOUR SQUAD  ·  " + group.state.ToUpperInvariant(), HeaderStyle());
                GUILayout.Label(memberCount + " / " + group.maxPlayers + " OPERATORS  ·  " + readyCount + " READY  ·  MINIMUM " + group.minPlayers, SmallStyle());
                if (!String.IsNullOrEmpty(group.leaderName)) GUILayout.Label("SQUAD LEADER: " + group.leaderName, SmallStyle());
                if (group.members != null) foreach (MemberDto member in group.members)
                    GUILayout.Label((member.ready ? "[READY] " : "[WAITING] ") + member.displayName, SmallStyle());
                if (group.state == "forming" && playerState.canStart && group.isLeader)
                {
                    GUILayout.Label("All required operators are ready. Continue through EFT's map/time selection and Fika host screen.", SmallStyle());
                    GUI.enabled = !fikaStartRequested;
                    if (GUILayout.Button(fikaStartRequested ? "FIKA HOST REQUEST SENT" : "START OPERATION THROUGH FIKA", GUILayout.Height(38f)))
                        StartFikaHost();
                    GUI.enabled = true;
                }
                else if (group.state == "forming" && playerState.canStart && !group.isLeader)
                {
                    GUILayout.Label("Squad is ready. Wait for " + (group.leaderName ?? "the squad leader") + " to host through Fika, then join the raid from Fika's raid list.", SmallStyle());
                }
                GUILayout.BeginHorizontal();
                if (GUILayout.Button("READY", GUILayout.Height(32f))) Ready(true);
                if (GUILayout.Button("NOT READY", GUILayout.Height(32f))) Ready(false);
                GUI.enabled = group.state == "forming";
                if (GUILayout.Button("LEAVE SQUAD", GUILayout.Height(32f))) Leave();
                GUI.enabled = true;
                GUILayout.EndHorizontal();
                GUILayout.Space(8f);
            }

            GUILayout.Label("AVAILABLE OPERATIONS", HeaderStyle());
            scroll = GUILayout.BeginScrollView(scroll, GUILayout.ExpandHeight(true));
            if (missions.missions == null || missions.missions.Length == 0)
                GUILayout.Label("No active missions are currently published.", SmallStyle());
            else foreach (MissionDto mission in missions.missions)
            {
                GUILayout.BeginVertical(GUI.skin.box);
                GUILayout.Label(mission.title ?? "Untitled operation", HeaderStyle());
                GUILayout.Label((mission.map ?? "Unknown map").ToUpperInvariant() + "  ·  " + (mission.mode ?? "solo").ToUpperInvariant() + "  ·  " + mission.minPlayers + "–" + mission.maxPlayers + " OPERATORS", SmallStyle());
                string briefingBody = mission.briefing == null ? String.Empty : mission.briefing.body;
                GUILayout.Label(!String.IsNullOrEmpty(mission.description) ? mission.description : briefingBody, SmallStyle());
                if (mission.rewards != null)
                    GUILayout.Label("REWARD  /  " + mission.rewards.points + " PTS  ·  " + mission.rewards.roubles.ToString("N0") + " RUB", SmallStyle());
                if (mission.objectives != null) foreach (ObjectiveDto objective in mission.objectives)
                    GUILayout.Label("• " + (objective.target ?? objective.type) + "  ×" + objective.count + (objective.required ? "  [REQUIRED]" : ""), SmallStyle());
                GUILayout.BeginHorizontal();
                GUILayout.FlexibleSpace();
                if (GUILayout.Button("ACCEPT OPERATION", GUILayout.Width(190f), GUILayout.Height(32f))) Accept(mission.id);
                GUILayout.EndHorizontal();
                GUILayout.EndVertical();
            }
            GUILayout.EndScrollView();
            GUILayout.EndArea();
        }

        private void DrawRaidHud()
        {
            if (playerState == null || playerState.group == null || playerState.group.state != "in_raid" || playerState.mission == null)
                return;

            MissionDto mission = playerState.mission;
            float width = Mathf.Min(420f, Screen.width - 24f);
            float height = Mathf.Min(270f, Screen.height - 110f);
            if (width < 220f || height < 130f) return;

            Rect hud = new Rect(Screen.width - width - 12f, 72f, width, height);
            GUI.Box(hud, GUIContent.none);
            GUILayout.BeginArea(new Rect(hud.x + 12f, hud.y + 9f, hud.width - 24f, hud.height - 18f));
            GUILayout.Label("ACTIVE FIELD OPERATION", HeaderStyle());
            GUILayout.Label(mission.title ?? "UNTITLED OPERATION", NotificationStyle());
            GUILayout.Label((mission.map ?? "UNKNOWN MAP").ToUpperInvariant(), SmallStyle());
            if (playerState.player != null)
                GUILayout.Label("OPERATOR RANK  /  " + (playerState.player.rank ?? "UNRANKED") + "  ·  " + playerState.player.points + " PTS", SmallStyle());

            string briefing = mission.briefing == null ? String.Empty : mission.briefing.body;
            if (!String.IsNullOrEmpty(briefing))
                GUILayout.Label(briefing, SmallStyle());

            if (mission.rewards != null)
                GUILayout.Label("AUTHORIZED REWARD  /  " + mission.rewards.points + " PTS  ·  " + mission.rewards.roubles.ToString("N0") + " RUB", SmallStyle());

            GUILayout.Label("OBJECTIVES  /  LIVE HOST TELEMETRY", HeaderStyle());
            raidHudScroll = GUILayout.BeginScrollView(raidHudScroll, GUILayout.Height(Mathf.Max(64f, hud.height - 145f)));
            bool hasHostEvidence = false;
            if (mission.objectives == null || mission.objectives.Length == 0)
                GUILayout.Label("No objectives listed.", SmallStyle());
            else
            {
                foreach (ObjectiveDto objective in mission.objectives)
                {
                    if (objective == null) continue;
                    ObjectiveProgressDto progress = null;
                    if (playerState.group.objectiveProgress != null)
                        foreach (ObjectiveProgressDto item in playerState.group.objectiveProgress)
                            if (item != null && item.id == objective.id) { progress = item; break; }
                    int current = progress == null ? 0 : progress.progress;
                    string trust = progress == null ? "none" : progress.trust;
                    string trustLabel = trust == "server_verified" ? "VERIFIED" : (trust == "host_attested" ? "HOST REPORTED" : "AWAITING EVENT");
                    if (trust == "host_attested") hasHostEvidence = true;
                    string objectiveName = !String.IsNullOrEmpty(objective.target) ? objective.target : (objective.type ?? "OBJECTIVE");
                    GUILayout.Label((objective.required ? "[REQUIRED] " : "[OPTIONAL] ") + objectiveName + "  " + current + "/" + objective.count + "  ·  " + trustLabel, SmallStyle());
                }
            }
            GUILayout.EndScrollView();
            bool localIsFikaHost = fikaKillHookInstalled && IsFikaServer();
            GUILayout.Label(hasHostEvidence
                ? "Host-reported evidence is visible. Final completion and rewards still require admin review."
                : (localIsFikaHost
                    ? "Fika host telemetry is active. Waiting for objective events; rewards still require admin review."
                    : (fikaKillHookInstalled
                        ? "Waiting for the Fika squad host to provide objective telemetry."
                        : "Fika 1.2.3 host bridge is not active. Objective progress may remain pending.")), SmallStyle());
            GUILayout.EndArea();
        }

        private IEnumerator FikaKillHookBootstrap()
        {
            float deadline = Time.realtimeSinceStartup + 90f;
            while (Time.realtimeSinceStartup < deadline)
            {
                string version = GetFikaPluginVersion();
                if (version == "1.2.3" || version == "1.2.3.0")
                {
                    if (TryInstallFikaKillHook()) yield break;
                }
                else if (!String.IsNullOrEmpty(version))
                {
                    Logger.LogWarning("Fika host telemetry is disabled: expected client 1.2.3, detected " + version + ".");
                    yield break;
                }
                yield return new WaitForSecondsRealtime(2f);
            }
            Logger.LogWarning("Fika host telemetry hook was not installed. Mission progress will remain pending.");
        }

        private bool TryInstallFikaKillHook()
        {
            if (fikaKillHookInstalled) return true;
            Type coopPlayerType = FindLoadedType("Fika.Core.Coop.Players.CoopPlayer");
            if (coopPlayerType == null || coopPlayerType.BaseType == null) return false;
            // Patch the EFT Player base implementation, not only Fika's CoopPlayer override.
            // Fika 1.2.3 uses CoopPlayer for the host/local player while AI actors can be native EFT Player instances.
            Type playerType = coopPlayerType.BaseType;
            MethodInfo target = null;
            foreach (MethodInfo candidate in playerType.GetMethods(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance))
            {
                if (candidate.Name == "OnBeenKilledByAggressor" && candidate.GetParameters().Length == 4)
                {
                    target = candidate;
                    break;
                }
            }
            MethodInfo postfix = typeof(Plugin).GetMethod("FikaKillPostfix", BindingFlags.Static | BindingFlags.NonPublic);
            if (target == null || postfix == null) return false;
            try
            {
                fikaHarmony = new Harmony("com.eft.operations.client.fika-host-evidence");
                fikaHarmony.Patch(target, null, new HarmonyMethod(postfix), null, null);
                fikaKillHookInstalled = true;
                Logger.LogInfo("Fika 1.2.3 host kill telemetry hook installed on EFT Player.OnBeenKilledByAggressor.");
                return true;
            }
            catch (Exception ex)
            {
                Logger.LogWarning("Fika host telemetry hook could not be installed: " + ex.GetBaseException().Message);
                return false;
            }
        }

        private static void FikaKillPostfix(object __instance, object[] __args)
        {
            Plugin current = instance;
            if (current == null || __args == null || __args.Length < 1) return;
            current.CaptureFikaHostKill(__instance, __args[0]);
        }

        private bool IsFikaServer()
        {
            Type backendUtils = FindLoadedType("Fika.Core.Coop.Utils.FikaBackendUtils");
            object isServer = ReadMember(backendUtils, "IsServer");
            return isServer is bool && (bool)isServer;
        }

        private string GetFikaMatchId()
        {
            Type coopHandlerType = FindLoadedType("Fika.Core.Coop.Components.CoopHandler");
            MethodInfo getServerId = coopHandlerType == null ? null : coopHandlerType.GetMethod("GetServerId", BindingFlags.Public | BindingFlags.Static);
            if (getServerId == null) return null;
            try { return getServerId.Invoke(null, null) as string; }
            catch { return null; }
        }

        private void CaptureFikaHostKill(object victim, object aggressor)
        {
            try
            {
                if (!IsFikaServer() || victim == null || aggressor == null) return;
                object victimAiValue = ReadMember(victim, "IsAI");
                object aggressorAiValue = ReadMember(aggressor, "IsAI");
                if (!(victimAiValue is bool) || !(bool)victimAiValue || (aggressorAiValue is bool && (bool)aggressorAiValue)) return;

                string killerProfileId = ReadMember(aggressor, "ProfileId") as string;
                string victimProfileId = ReadMember(victim, "ProfileId") as string;
                if (!IsProfileId(killerProfileId) || !IsProfileId(victimProfileId)) return;

                object profile = ReadMember(victim, "Profile");
                object info = ReadMember(profile, "Info");
                object settings = ReadMember(info, "Settings");
                string victimRole = ReadMember(settings, "Role") == null ? String.Empty : ReadMember(settings, "Role").ToString();
                string victimSide = ReadMember(victim, "Side") == null ? String.Empty : ReadMember(victim, "Side").ToString();
                if (String.IsNullOrWhiteSpace(victimRole)) victimRole = "unknown";

                string matchId = GetFikaMatchId();
                if (String.IsNullOrWhiteSpace(matchId)) return;
                string dedupeKey = matchId + ":" + victimProfileId;
                if (!reportedHostKillKeys.Add(dedupeKey)) return;
                reportedHostKillOrder.Enqueue(dedupeKey);
                while (reportedHostKillOrder.Count > 1000)
                    reportedHostKillKeys.Remove(reportedHostKillOrder.Dequeue());

                string payload = "{\"eventId\":\"" + Guid.NewGuid().ToString("N")
                    + "\",\"matchId\":\"" + Escape(matchId)
                    + "\",\"killerProfileId\":\"" + Escape(killerProfileId)
                    + "\",\"victimProfileId\":\"" + Escape(victimProfileId)
                    + "\",\"victimRole\":\"" + Escape(victimRole)
                    + "\",\"victimSide\":\"" + Escape(victimSide)
                    + "\",\"victimIsAi\":true}";
                StartCoroutine(PostFikaHostEvent(payload));
            }
            catch (Exception ex)
            {
                Logger.LogDebug("Fika host kill telemetry skipped safely: " + ex.GetBaseException().Message);
            }
        }

        private static bool IsProfileId(string value)
        {
            if (String.IsNullOrEmpty(value) || value.Length != 24) return false;
            for (int i = 0; i < value.Length; i++)
            {
                char ch = value[i];
                if (!((ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F'))) return false;
            }
            return true;
        }

        private IEnumerator PostFikaHostEvent(string jsonBody)
        {
            string sessionId;
            string host;
            object nativeClient;
            string error;
            if (!SptBackendBridge.TryGetContext(out sessionId, out host, out nativeClient, out error))
            {
                Logger.LogDebug("Fika host telemetry not sent: " + error);
                yield break;
            }

            Task<byte[]> task;
            try
            {
                task = SptBackendBridge.Send(nativeClient, "/EFTOperations/client/eft/operations/host-event", Encoding.UTF8.GetBytes(jsonBody));
            }
            catch (Exception ex)
            {
                Logger.LogWarning("Could not start Fika host telemetry request: " + ex.GetBaseException().Message);
                yield break;
            }
            while (!task.IsCompleted) yield return null;
            if (task.IsCanceled || task.IsFaulted)
            {
                Exception taskError = task.Exception == null ? null : task.Exception.GetBaseException();
                Logger.LogWarning("Fika host telemetry request failed: " + (taskError == null ? "REQUEST_CANCELLED" : taskError.Message));
                yield break;
            }
            string responseBody = Encoding.UTF8.GetString(task.Result ?? new byte[0]);
            ActionResponse response = JsonUtility.FromJson<ActionResponse>(responseBody);
            if (response == null || !response.ok)
                Logger.LogDebug("Fika host telemetry was rejected: " + (response == null ? "INVALID_RESPONSE" : response.error));
        }

        private void EnsureInputBridge()
        {
            if (inputLookupAttempted) return;
            inputLookupAttempted = true;
            Type inputType = Type.GetType("UnityEngine.Input, UnityEngine.InputLegacyModule", false);
            if (inputType == null)
            {
                try { inputType = Assembly.Load("UnityEngine.InputLegacyModule").GetType("UnityEngine.Input", false); }
                catch { }
            }
            if (inputType != null)
            {
                inputGetKeyDown = inputType.GetMethod("GetKeyDown", BindingFlags.Public | BindingFlags.Static,
                    null, new Type[] { typeof(KeyCode) }, null);
            }
            if (inputGetKeyDown == null) Logger.LogWarning("Unity InputLegacyModule.GetKeyDown was not found; the F8 panel toggle will be unavailable.");
        }

        private bool IsToggleKeyDown()
        {
            EnsureInputBridge();
            if (inputGetKeyDown == null) return false;
            try { return (bool)inputGetKeyDown.Invoke(null, new object[] { toggleKey.Value }); }
            catch (Exception ex) { Logger.LogDebug("Input bridge call failed: " + ex.Message); return false; }
        }

        private static GUIStyle HeaderStyle() { return new GUIStyle(GUI.skin.label) { fontSize = 16, normal = { textColor = new Color(0.82f, 0.72f, 0.50f) } }; }
        private static GUIStyle NotificationStyle() { return new GUIStyle(GUI.skin.label) { fontSize = 15, wordWrap = true, normal = { textColor = new Color(0.95f, 0.82f, 0.55f) } }; }
        private static GUIStyle SmallStyle() { return new GUIStyle(GUI.skin.label) { fontSize = 12, wordWrap = true, normal = { textColor = new Color(0.88f, 0.89f, 0.84f) } }; }
        private static string Escape(string value) { return (value ?? String.Empty).Replace("\\", "\\\\").Replace("\"", "\\\""); }
    }

    /// <summary>
    /// Uses the exact public SPT 3.11.1 contract instead of guessing session field names.
    /// SPT.Common.Http.RequestHandler.SessionId is populated from the launcher's -token arg;
    /// RequestHandler.HttpClient already sends PHPSESSID, compresses POST bodies and handles
    /// the SPT server certificate in the same way as native backend calls.
    /// </summary>
    internal static class SptBackendBridge
    {
        private const string RequestHandlerTypeName = "SPT.Common.Http.RequestHandler";
        // SPT 3.11.1 ships this assembly as spt-common.dll (AssemblyName: spt-common),
        // not "SPT.Common". Keep the namespace and assembly identity separate.
        private const string RequestHandlerAssemblyName = "spt-common";
        private const BindingFlags StaticFlags = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static;
        private static Type cachedType;

        public static bool TryGetContext(out string sessionId, out string host, out object client, out string error)
        {
            sessionId = null;
            host = null;
            client = null;
            error = null;

            try
            {
                Type type = GetRequestHandlerType();
                if (type == null)
                {
                    error = "SPT backend bridge unavailable: SPT.Common.Http.RequestHandler was not loaded. Check that SPT 3.11.1 is installed.";
                    return false;
                }

                // Reading these fields invokes SPT's static initializer, which parses -config and -token.
                sessionId = ReadStaticString(type, "SessionId");
                host = ReadStaticString(type, "Host");
                client = ReadStaticField(type, "HttpClient");

                if (String.IsNullOrWhiteSpace(sessionId))
                {
                    error = "SPT login token is empty. Start the game through SPT Launcher and log in first.";
                    return false;
                }
                if (String.IsNullOrWhiteSpace(host) || client == null)
                {
                    error = "SPT backend is not initialized (BackendUrl / HttpClient unavailable).";
                    return false;
                }
                return true;
            }
            catch (Exception ex)
            {
                error = "Could not read the native SPT session: " + ex.GetBaseException().Message;
                return false;
            }
        }

        public static Task<byte[]> Send(object client, string path, byte[] payload)
        {
            if (client == null) throw new ArgumentNullException("client");
            Type type = client.GetType();
            string methodName = payload == null ? "GetAsync" : "PostAsync";
            MethodInfo method = null;
            foreach (MethodInfo candidate in type.GetMethods(BindingFlags.Public | BindingFlags.Instance))
            {
                if (candidate.Name != methodName) continue;
                ParameterInfo[] parameters = candidate.GetParameters();
                if (payload == null && parameters.Length == 1 && parameters[0].ParameterType == typeof(string))
                {
                    method = candidate;
                    break;
                }
                if (payload != null && parameters.Length == 3 && parameters[0].ParameterType == typeof(string)
                    && parameters[1].ParameterType == typeof(byte[]) && parameters[2].ParameterType == typeof(bool))
                {
                    method = candidate;
                    break;
                }
            }
            if (method == null) throw new MissingMethodException(type.FullName, methodName);
            object result = payload == null
                ? method.Invoke(client, new object[] { path })
                : method.Invoke(client, new object[] { path, payload, true });
            Task<byte[]> task = result as Task<byte[]>;
            if (task == null) throw new InvalidOperationException("SPT HttpClient returned an unexpected task type.");
            return task;
        }

        private static Type GetRequestHandlerType()
        {
            if (cachedType != null) return cachedType;

            // Prefer the assembly already loaded by SPT/BepInEx. This avoids probing a
            // duplicate copy and preserves the game's native HttpClient instance.
            foreach (Assembly assembly in AppDomain.CurrentDomain.GetAssemblies())
            {
                try
                {
                    cachedType = assembly.GetType(RequestHandlerTypeName, false);
                    if (cachedType != null) return cachedType;
                }
                catch { }
            }

            // Exact SPT 3.11.1 assembly identity from SPT.Common.csproj.
            try
            {
                cachedType = Type.GetType(RequestHandlerTypeName + ", " + RequestHandlerAssemblyName, false);
                if (cachedType != null) return cachedType;

                Assembly common = Assembly.Load(RequestHandlerAssemblyName);
                cachedType = common.GetType(RequestHandlerTypeName, false);
            }
            catch { }

            return cachedType;
        }

        private static object ReadStaticField(Type type, string name)
        {
            FieldInfo field = type.GetField(name, StaticFlags);
            if (field != null) return field.GetValue(null);
            PropertyInfo property = type.GetProperty(name, StaticFlags);
            if (property != null && property.GetIndexParameters().Length == 0) return property.GetValue(null, null);
            return null;
        }

        private static string ReadStaticString(Type type, string name)
        {
            object value = ReadStaticField(type, name);
            return value as string;
        }
    }

    [Serializable] internal class MissionListResponse { public bool ok; public string error; public MissionDto[] missions; }
    [Serializable] internal class PlayerStateResponse { public bool ok; public string error; public bool canStart; public PlayerDto player; public GroupDto group; public MissionDto mission; }
    [Serializable] internal class ActionResponse { public bool ok; public string error; public GroupDto group; public bool canStart; }
    [Serializable] internal class PlayerDto { public int points; public string rank; }
    [Serializable] internal class MissionDto { public string id; public string title; public string description; public BriefingDto briefing; public RewardDto rewards; public string map; public string mode; public int minPlayers; public int maxPlayers; public ObjectiveDto[] objectives; }
    [Serializable] internal class BriefingDto { public string kind; public string media; public string body; }
    [Serializable] internal class RewardDto { public int points; public int roubles; }
    [Serializable] internal class ObjectiveDto { public string id; public string type; public string target; public int count; public bool required; }
    [Serializable] internal class GroupDto { public string id; public string missionId; public string state; public bool isLeader; public string leaderName; public int minPlayers; public int maxPlayers; public int readyCount; public MemberDto[] members; public ObjectiveProgressDto[] objectiveProgress; }
    [Serializable] internal class ObjectiveProgressDto { public string id; public int progress; public int count; public bool required; public string trust; }
    [Serializable] internal class MemberDto { public string displayName; public bool ready; }
}
