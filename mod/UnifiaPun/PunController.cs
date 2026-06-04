using Photon.Pun;
using Photon.Realtime;
using UnityEngine;

namespace Unifia.Pun
{
    // Drives the actual PUN2 repoint. Lives on a DontDestroyOnLoad GameObject so
    // it survives scene changes. MonoBehaviourPunCallbacks auto-registers the
    // Photon callbacks while enabled.
    //
    // Flow when activated:
    //   1. Disconnect from Photon Cloud (if connected).
    //   2. Override AppSettings → host's self-hosted server, name server off.
    //   3. ConnectUsingSettings() → OnConnectedToMaster → JoinOrCreateRoom(code).
    //
    // Activation timing is the one genuinely game-specific bit. Two strategies
    // are built in (manual hotkey, auto-after-delay). "reconnect-on-load" is left
    // as a Harmony hook point for games whose own connect flow must be wrapped.
    public class PunController : MonoBehaviourPunCallbacks
    {
        private const KeyCode Hotkey = KeyCode.F9;

        private NetConfig _net;
        private UnifiaProfile _profile;
        private bool _activating;
        private float _autoTimer = -1f;

        public void Init(NetConfig net, UnifiaProfile profile)
        {
            _net = net;
            _profile = profile ?? UnifiaProfile.Default();

            UnifiaPlugin.Log.LogInfo(
                $"Unifia ready — strategy={_profile.hookStrategy}, room={_net.RoomCode}, " +
                $"server={_net.ServerIP}:{_net.Port}. Press {Hotkey} to (re)join.");

            if (_profile.hookStrategy == "auto-on-load")
            {
                _autoTimer = Mathf.Max(0.5f, _profile.autoDelaySeconds);
            }
            else if (_profile.hookStrategy == "reconnect-on-load")
            {
                // Wrap the game's own connect call so we activate right after it.
                HarmonyHooks.Apply(this, _profile.connectHookType, _profile.connectHookMethod);
            }
            // "manual" waits for the hotkey.
        }

        private void Update()
        {
            if (_autoTimer > 0f)
            {
                _autoTimer -= Time.deltaTime;
                if (_autoTimer <= 0f) Activate();
            }
            if (Input.GetKeyDown(Hotkey)) Activate();
        }

        // Repoint PUN at the host's server and connect. Idempotent while in flight.
        public void Activate()
        {
            if (_activating) return;
            if (_net == null || !_net.HasRoom)
            {
                UnifiaPlugin.Log.LogWarning("No room descriptor — nothing to join.");
                return;
            }

            _activating = true;
            var mode = string.IsNullOrEmpty(_net.ConnectionMode) ? "cloud-region" : _net.ConnectionMode;
            UnifiaPlugin.Log.LogInfo($"Activating Unifia ({mode}) → room '{_net.RoomCode}'…");

            if (PhotonNetwork.IsConnected)
                PhotonNetwork.Disconnect();

            var app = PhotonNetwork.PhotonServerSettings.AppSettings;
            // Only swap the AppId for a real one — never clobber the game's own
            // Photon Cloud AppId with the self-hosted placeholder in cloud mode.
            bool overrideAppId = !string.IsNullOrEmpty(_net.AppId) && _net.AppId != "unifia-local";

            if (mode == "self-hosted")
            {
                // Point straight at the host's self-hosted Photon server.
                app.UseNameServer = false;
                app.Server = _net.ServerIP;
                app.Port = _net.Port;
                app.FixedRegion = "";
                if (!string.IsNullOrEmpty(_net.AppId)) app.AppIdRealtime = _net.AppId;
            }
            else
            {
                // Stay on Photon Cloud but pin everyone to one region + room so
                // cross-store players converge. Keep the game's own AppId.
                app.UseNameServer = true;
                app.Server = "";
                app.FixedRegion = string.IsNullOrEmpty(_net.Region) ? "" : _net.Region;
                if (overrideAppId) app.AppIdRealtime = _net.AppId;
            }

            if (!string.IsNullOrEmpty(_net.Username)) PhotonNetwork.NickName = _net.Username;
            // Force a shared game version so Photon doesn't segregate by AppVersion.
            if (!string.IsNullOrEmpty(_net.Version)) PhotonNetwork.GameVersion = _net.Version;

            PhotonNetwork.ConnectUsingSettings();
        }

        public override void OnConnectedToMaster()
        {
            if (!_activating) return;
            UnifiaPlugin.Log.LogInfo($"Connected to host master. Joining room '{_net.RoomCode}'…");
            // MaxPlayers 0 = use the game/server default.
            PhotonNetwork.JoinOrCreateRoom(_net.RoomCode, new RoomOptions { MaxPlayers = 0 }, TypedLobby.Default);
        }

        public override void OnJoinedRoom()
        {
            _activating = false;
            int count = PhotonNetwork.CurrentRoom != null ? PhotonNetwork.CurrentRoom.PlayerCount : 0;
            UnifiaPlugin.Log.LogInfo($"Joined Unifia room '{_net.RoomCode}' ({count} players).");
        }

        public override void OnJoinRoomFailed(short returnCode, string message)
        {
            _activating = false;
            UnifiaPlugin.Log.LogWarning($"JoinRoom failed ({returnCode}): {message}");
        }

        public override void OnDisconnected(DisconnectCause cause)
        {
            _activating = false;
            UnifiaPlugin.Log.LogInfo($"Disconnected: {cause}");
        }
    }
}
