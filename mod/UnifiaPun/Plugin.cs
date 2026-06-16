using BepInEx;
using BepInEx.Logging;
using UnityEngine;

namespace Unifia.Pun
{
    // BepInEx entry point. Reads the launcher-written profile (unifia_profile.json).
    // It spins up the connector only for the inject-settings strategy with a PUN
    // netcode; otherwise it stays idle, so the plugin never affects normal play.
    [BepInPlugin(Guid, Name, Version)]
    public class UnifiaPlugin : BaseUnityPlugin
    {
        public const string Guid = "dev.unifia.pun";
        public const string Name = "Unifia PUN Connector";
        public const string Version = "0.2.0";

        internal static ManualLogSource Log;
        // The game's baked-in Photon AppId, captured before we override it — the
        // edition signal (official copy vs crack carry different ids).
        internal static string OriginalAppId = "";
        private GameObject _controller;

        private void Awake()
        {
            Log = Logger;
            Log.LogInfo($"{Name} {Version} loaded.");

            try { OriginalAppId = Photon.Pun.PhotonNetwork.PhotonServerSettings.AppSettings.AppIdRealtime; }
            catch { OriginalAppId = ""; }

            var profile = UnifiaConfig.LoadProfile();
            Log.LogInfo(
                $"Profile loaded: netcode={profile.netcode}, strategy={profile.hookStrategy}, " +
                $"hook={profile.connectHookType}.{profile.connectHookMethod}, " +
                $"photonAppId={(string.IsNullOrEmpty(profile.photonAppId) ? "<EMPTY>" : "set")}, " +
                $"version='{profile.photonAppVersion}'. Game's own AppId={(string.IsNullOrEmpty(OriginalAppId) ? "<none>" : "set")}.");
            if (profile.netcode != "pun2" && profile.netcode != "pun1")
            {
                Log.LogWarning($"Profile netcode '{profile.netcode}' is not PUN — staying idle.");
                return;
            }
            if (profile.hookStrategy != "inject-settings")
            {
                Log.LogInfo($"hookStrategy '{profile.hookStrategy}' — connector idle (only inject-settings is active).");
                return;
            }

            _controller = new GameObject("UnifiaPunController");
            DontDestroyOnLoad(_controller);
            _controller.hideFlags = HideFlags.HideAndDontSave;
            _controller.AddComponent<PunController>().Init(profile);
        }
    }
}
