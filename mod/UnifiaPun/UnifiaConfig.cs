using System;
using System.IO;
using BepInEx;
using UnityEngine;

namespace Unifia.Pun
{
    // The room descriptor Unifia writes into BepInEx/config/unifia_net.cfg.
    // Mirrors the [Unifia] ini block produced by the launcher (patcher.js).
    public class NetConfig
    {
        public string ServerIP;
        public int Port = 5055;
        public string AppId;
        public string RoomCode;
        public string Username;
        public string Version;

        public bool HasRoom => !string.IsNullOrEmpty(ServerIP) && !string.IsNullOrEmpty(RoomCode);
    }

    // Per-game behavior, written by the launcher to unifia_profile.json from its
    // profile registry. Parsed with Unity's JsonUtility (no extra dependency).
    [Serializable]
    public class UnifiaProfile
    {
        public string game = "";
        public string netcode = "pun2";       // pun2 | pun1 | (future: mirror, fishnet…)
        public string hookStrategy = "manual"; // manual | auto-on-load | reconnect-on-load
        public float autoDelaySeconds = 3f;    // delay for auto-on-load
        public bool supportsNativeLobby = false;
        public string connectHookType = "";    // for reconnect-on-load: type to patch
        public string connectHookMethod = "";  // for reconnect-on-load: method to patch

        public static UnifiaProfile Default()
        {
            return new UnifiaProfile();
        }
    }

    public static class UnifiaConfig
    {
        // Both files live in the game's BepInEx/config folder.
        private static string NetPath => Path.Combine(Paths.ConfigPath, "unifia_net.cfg");
        private static string ProfilePath => Path.Combine(Paths.ConfigPath, "unifia_profile.json");

        // Parse the tiny ini. Ignores comments (#), the [Unifia] header, and blanks.
        public static NetConfig LoadNetConfig()
        {
            if (!File.Exists(NetPath)) return null;

            var net = new NetConfig();
            foreach (var raw in File.ReadAllLines(NetPath))
            {
                var line = raw.Trim();
                if (line.Length == 0 || line.StartsWith("#") || line.StartsWith("[")) continue;

                int eq = line.IndexOf('=');
                if (eq < 0) continue;
                var key = line.Substring(0, eq).Trim();
                var val = line.Substring(eq + 1).Trim();

                switch (key)
                {
                    case "ServerIP": net.ServerIP = val; break;
                    case "Port": int.TryParse(val, out net.Port); break;
                    case "AppId": net.AppId = val; break;
                    case "RoomCode": net.RoomCode = val; break;
                    case "Username": net.Username = val; break;
                    case "Version": net.Version = val; break;
                }
            }
            return net;
        }

        public static UnifiaProfile LoadProfile()
        {
            try
            {
                if (!File.Exists(ProfilePath)) return UnifiaProfile.Default();
                var profile = JsonUtility.FromJson<UnifiaProfile>(File.ReadAllText(ProfilePath));
                return profile ?? UnifiaProfile.Default();
            }
            catch
            {
                return UnifiaProfile.Default();
            }
        }
    }
}
