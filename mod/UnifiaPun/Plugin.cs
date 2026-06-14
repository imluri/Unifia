using BepInEx;
using BepInEx.Logging;
using UnityEngine;

namespace Unifia.Pun
{
    // BepInEx entry point. On load it reads the launcher-written config; if a
    // room descriptor is present it spins up a persistent PunController. With no
    // descriptor it stays completely idle, so installing the plugin never affects
    // normal single-player / vanilla multiplayer.
    [BepInPlugin(Guid, Name, Version)]
    public class UnifiaPlugin : BaseUnityPlugin
    {
        public const string Guid = "dev.unifia.pun";
        public const string Name = "Unifia PUN Connector";
        public const string Version = "0.1.0";

        internal static ManualLogSource Log;
        // The game's baked-in Photon AppId, captured before anything overrides it —
        // this is the edition signal (official copy vs crack carry different ids).
        internal static string OriginalAppId = "";
        private GameObject _controller;

        private void Awake()
        {
            Log = Logger;
            Log.LogInfo($"{Name} {Version} loaded.");

            try { OriginalAppId = Photon.Pun.PhotonNetwork.PhotonServerSettings.AppSettings.AppIdRealtime; }
            catch { OriginalAppId = ""; }

            var net = UnifiaConfig.LoadNetConfig();
            if (net == null || !net.HasRoom)
            {
                Log.LogInfo("No unifia_net.cfg room descriptor — staying idle.");
                return;
            }

            var profile = UnifiaConfig.LoadProfile();
            if (profile.netcode != "pun2" && profile.netcode != "pun1")
            {
                Log.LogWarning($"Profile netcode '{profile.netcode}' is not PUN — this plugin only handles PUN.");
                return;
            }

            _controller = new GameObject("UnifiaPunController");
            DontDestroyOnLoad(_controller);
            _controller.hideFlags = HideFlags.HideAndDontSave;
            _controller.AddComponent<PunController>().Init(net, profile);
        }
    }
}
