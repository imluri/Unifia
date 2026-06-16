using System.Collections.Generic;
using System.IO;
using BepInEx;
using Photon.Pun;
using Photon.Realtime;
using UnityEngine;

namespace Unifia.Pun
{
    // inject-settings connector: registers a Harmony postfix that overwrites the
    // Photon AppId/version at the game's native connect, then stays out of the way.
    // The player joins via the game's own server browser. No disconnect, no hotkey.
    // Still a MonoBehaviourPunCallbacks so it can report room status (read by the
    // launcher's Multiplayer tab) once the player joins a room normally.
    public class PunController : MonoBehaviourPunCallbacks
    {
        private UnifiaProfile _profile;

        public void Init(UnifiaProfile profile)
        {
            _profile = profile ?? UnifiaProfile.Default();
            UnifiaPlugin.Log.LogInfo($"Unifia ready — strategy={_profile.hookStrategy}.");

            if (_profile.hookStrategy == "inject-settings")
            {
                HarmonyHooks.ApplyInject(
                    _profile.connectHookType, _profile.connectHookMethod,
                    _profile.photonAppId, _profile.photonVoiceAppId, _profile.photonAppVersion);
            }
            WriteStatus();
        }

        // --- Edition status file (read by the launcher's Multiplayer tab) --------

        private static string StatusPath() => Path.Combine(Paths.ConfigPath, "unifia_status.json");

        private static string JsonStr(string s) =>
            "\"" + (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";

        private static string PlayerJson(Player p, string originalAppId)
        {
            string nick = p != null ? p.NickName : "";
            return "{\"nick\":" + JsonStr(nick) + ",\"originalAppId\":" + JsonStr(originalAppId) + "}";
        }

        private void WriteStatus()
        {
            try
            {
                string room = PhotonNetwork.InRoom && PhotonNetwork.CurrentRoom != null
                    ? PhotonNetwork.CurrentRoom.Name : "";
                var sb = new System.Text.StringBuilder();
                sb.Append("{");
                sb.Append("\"loaded\":true,");
                sb.Append("\"room\":").Append(JsonStr(room)).Append(",");
                sb.Append("\"joined\":").Append(PhotonNetwork.InRoom ? "true" : "false").Append(",");
                sb.Append("\"self\":").Append(PlayerJson(PhotonNetwork.LocalPlayer, UnifiaPlugin.OriginalAppId)).Append(",");
                sb.Append("\"players\":[");
                if (PhotonNetwork.InRoom)
                {
                    var others = new List<string>();
                    foreach (var p in PhotonNetwork.PlayerListOthers)
                    {
                        object appid;
                        string oid = p.CustomProperties.TryGetValue("unifia_appid", out appid) ? appid as string : "";
                        others.Add(PlayerJson(p, oid));
                    }
                    sb.Append(string.Join(",", others.ToArray()));
                }
                sb.Append("]}");
                File.WriteAllText(StatusPath(), sb.ToString());
            }
            catch (System.Exception e) { UnifiaPlugin.Log.LogWarning($"status write failed: {e.Message}"); }
        }

        public override void OnJoinedRoom()
        {
            // Tag ourselves so the game's player list shows who came in via Unifia.
            var props = new ExitGames.Client.Photon.Hashtable { { "unifia_appid", UnifiaPlugin.OriginalAppId } };
            PhotonNetwork.LocalPlayer.SetCustomProperties(props);
            if (!string.IsNullOrEmpty(PhotonNetwork.NickName) && !PhotonNetwork.NickName.EndsWith(" [U]"))
                PhotonNetwork.NickName = PhotonNetwork.NickName + " [U]";

            int count = PhotonNetwork.CurrentRoom != null ? PhotonNetwork.CurrentRoom.PlayerCount : 0;
            string name = PhotonNetwork.CurrentRoom != null ? PhotonNetwork.CurrentRoom.Name : "";
            UnifiaPlugin.Log.LogInfo($"Joined room '{name}' ({count} players).");
            WriteStatus();
        }

        public override void OnLeftRoom() { WriteStatus(); }
        public override void OnPlayerEnteredRoom(Player newPlayer) { WriteStatus(); }
        public override void OnPlayerLeftRoom(Player otherPlayer) { WriteStatus(); }
        public override void OnPlayerPropertiesUpdate(Player target, ExitGames.Client.Photon.Hashtable changedProps) { WriteStatus(); }
    }
}
