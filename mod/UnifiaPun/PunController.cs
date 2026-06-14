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

        private const float ReconnectBackoff = 2f;
        private const int MaxReconnects = 5;

        private NetConfig _net;
        private UnifiaProfile _profile;
        private bool _activating;
        private float _autoTimer = -1f;

        // Once activated we stay "engaged" for the session and re-assert our
        // settings if anything knocks us off, so the host's AppId/room win.
        private bool _engaged;
        private bool _selfDisconnect; // guards the pre-connect Disconnect() below
        private float _reconnectTimer = -1f;
        private int _reconnects;

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
            if (_reconnectTimer > 0f)
            {
                _reconnectTimer -= Time.deltaTime;
                if (_reconnectTimer <= 0f)
                {
                    _reconnectTimer = -1f;
                    Activate(); // re-asserts AppId + room and reconnects
                }
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
            _engaged = true;
            var mode = string.IsNullOrEmpty(_net.ConnectionMode) ? "cloud-region" : _net.ConnectionMode;
            UnifiaPlugin.Log.LogInfo($"Activating Unifia ({mode}) → room '{_net.RoomCode}'…");

            if (PhotonNetwork.IsConnected)
            {
                _selfDisconnect = true; // our own teardown — don't treat as a knock-off
                PhotonNetwork.Disconnect();
            }

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
                // Stay on Photon Cloud. Match only the AppId (the "key") — the game
                // exposes its own Photon region selector, so leave FixedRegion as the
                // player set it and never pin a region from Unifia.
                app.UseNameServer = true;
                app.Server = "";
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
            _reconnects = 0; // back in the room — reset the re-assert budget
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

            // Our own pre-connect teardown — expected, don't fight it.
            if (_selfDisconnect)
            {
                _selfDisconnect = false;
                UnifiaPlugin.Log.LogInfo($"Disconnected (self): {cause}");
                return;
            }

            UnifiaPlugin.Log.LogInfo($"Disconnected: {cause}");

            // Something knocked us off (the game's own connect flow, another mod,
            // a transient drop). Re-assert our AppId + room and rejoin so the
            // host's settings win — capped so we never loop forever.
            if (_engaged && _reconnects < MaxReconnects)
            {
                _reconnects++;
                _reconnectTimer = ReconnectBackoff;
                UnifiaPlugin.Log.LogInfo(
                    $"Re-asserting Unifia (attempt {_reconnects}/{MaxReconnects}) in {ReconnectBackoff}s…");
            }
        }
    }
}
