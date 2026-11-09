using BepInEx;
using BepInEx.Configuration;
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
    public sealed class Plugin : BaseUnityPlugin
    {
        private ConfigEntry<KeyCode> toggleKey;
        private ConfigEntry<float> refreshSeconds;
        private bool visible;
        private bool busy;
        private string status = "Connecting to Operations service...";
        private MissionListResponse missions = new MissionListResponse();
        private PlayerStateResponse playerState = new PlayerStateResponse();
        private Vector2 scroll;
        private float nextRefresh;

        private void Awake()
        {
            toggleKey = Config.Bind("Interface", "ToggleKey", KeyCode.F8, "Open or close the mission interface.");
            refreshSeconds = Config.Bind("Interface", "RefreshSeconds", 12f, "Automatic status refresh interval.");
            Logger.LogInfo("EFT Operations client loaded. UI key: " + toggleKey.Value);
            Logger.LogInfo("Authentication bridge: SPT 3.11.1 RequestHandler (SessionId + native HttpClient).");
            StartCoroutine(RefreshLoop());
        }

        private void Update()
        {
            if (Input.GetKeyDown(toggleKey.Value))
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
                    if (visible) RefreshAll();
                }
                yield return new WaitForSecondsRealtime(1f);
            }
        }

        private void RefreshAll()
        {
            if (busy) return;
            StartCoroutine(Request("/client/eft/operations/missions", null, delegate(string body)
            {
                missions = JsonUtility.FromJson<MissionListResponse>(body) ?? new MissionListResponse();
                if (!missions.ok) status = "Mission list: " + missions.error;
                else status = "Mission board synchronized.";
                StartCoroutine(Request("/client/eft/operations/state", null, delegate(string stateBody)
                {
                    playerState = JsonUtility.FromJson<PlayerStateResponse>(stateBody) ?? new PlayerStateResponse();
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
                status = response != null && response.ok ? (response.canStart ? "All members ready. Host start is not yet automated." : "Ready status updated.") : "Ready failed: " + (response == null ? "INVALID_RESPONSE" : response.error);
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

        private void OnGUI()
        {
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
            GUILayout.Space(8f);

            if (playerState.group != null)
            {
                GUILayout.Label("YOUR SQUAD  ·  " + playerState.group.state.ToUpperInvariant(), HeaderStyle());
                foreach (MemberDto member in playerState.group.members)
                    GUILayout.Label((member.ready ? "[READY] " : "[WAIT]  ") + member.displayName, SmallStyle());
                GUILayout.BeginHorizontal();
                if (GUILayout.Button("READY", GUILayout.Height(32f))) Ready(true);
                if (GUILayout.Button("NOT READY", GUILayout.Height(32f))) Ready(false);
                GUI.enabled = playerState.group.state == "forming";
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
                GUILayout.Label(mission.description ?? mission.briefing ?? String.Empty, SmallStyle());
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

        private static GUIStyle HeaderStyle() { return new GUIStyle(GUI.skin.label) { fontSize = 16, fontStyle = FontStyle.Bold, normal = { textColor = new Color(0.82f, 0.72f, 0.50f) } }; }
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
        private const BindingFlags StaticFlags = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static;
        private static Type cachedType;
        private static bool typeResolved;

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
            if (typeResolved) return cachedType;
            typeResolved = true;

            cachedType = Type.GetType(RequestHandlerTypeName + ", SPT.Common", false);
            if (cachedType != null) return cachedType;

            try
            {
                Assembly common = Assembly.Load("SPT.Common");
                cachedType = common.GetType(RequestHandlerTypeName, false);
            }
            catch { }

            if (cachedType != null) return cachedType;
            foreach (Assembly assembly in AppDomain.CurrentDomain.GetAssemblies())
            {
                try
                {
                    cachedType = assembly.GetType(RequestHandlerTypeName, false);
                    if (cachedType != null) return cachedType;
                }
                catch { }
            }
            return null;
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
    [Serializable] internal class PlayerStateResponse { public bool ok; public string error; public PlayerDto player; public GroupDto group; public MissionDto mission; }
    [Serializable] internal class ActionResponse { public bool ok; public string error; public GroupDto group; public bool canStart; }
    [Serializable] internal class PlayerDto { public int points; public string rank; }
    [Serializable] internal class MissionDto { public string id; public string title; public string description; public string briefing; public string map; public string mode; public int minPlayers; public int maxPlayers; public ObjectiveDto[] objectives; }
    [Serializable] internal class ObjectiveDto { public string id; public string type; public string target; public int count; public bool required; }
    [Serializable] internal class GroupDto { public string id; public string missionId; public string state; public MemberDto[] members; }
    [Serializable] internal class MemberDto { public string displayName; public bool ready; }
}
