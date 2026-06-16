using System;
using System.Linq;
using System.Reflection;
using HarmonyLib;
using Photon.Pun;
using Photon.Realtime;

namespace Unifia.Pun
{
    // inject-settings: postfix the game's own Photon-setup method (named in the
    // recipe, e.g. DataDirector.PhotonSetAppId) and overwrite AppSettings with the
    // shared community AppId/version so the game connects natively to the shared
    // Photon app and crossplay shows up in the game's own server browser.
    //
    // Reflection-based on purpose — no compile-time reference to the game; the
    // target method is recipe data.
    internal static class HarmonyHooks
    {
        private static Harmony _harmony;
        private static string _appId;
        private static string _voiceAppId;
        private static string _appVersion;

        public static void ApplyInject(string typeName, string methodName,
            string appId, string voiceAppId, string appVersion)
        {
            if (string.IsNullOrEmpty(typeName) || string.IsNullOrEmpty(methodName))
            {
                UnifiaPlugin.Log.LogWarning(
                    "inject-settings needs connectHookType + connectHookMethod in the profile.");
                return;
            }

            _appId = appId;
            _voiceAppId = voiceAppId;
            _appVersion = appVersion;

            var type = AppDomain.CurrentDomain
                .GetAssemblies()
                .Select(a => SafeGetType(a, typeName))
                .FirstOrDefault(t => t != null);
            if (type == null)
            {
                UnifiaPlugin.Log.LogWarning($"Hook type '{typeName}' not found in loaded assemblies.");
                return;
            }

            var method = type.GetMethod(
                methodName,
                BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.Static);
            if (method == null)
            {
                UnifiaPlugin.Log.LogWarning($"Hook method '{typeName}.{methodName}' not found.");
                return;
            }

            try
            {
                _harmony = new Harmony(UnifiaPlugin.Guid);
                var postfix = new HarmonyMethod(
                    typeof(HarmonyHooks).GetMethod(nameof(InjectSettings), BindingFlags.NonPublic | BindingFlags.Static));
                _harmony.Patch(method, postfix: postfix);
                UnifiaPlugin.Log.LogInfo(
                    $"Hooked {typeName}.{methodName} for inject-settings — will inject " +
                    $"AppId={Mask(_appId)}, Voice={Mask(_voiceAppId)}, Version='{_appVersion}'.");
            }
            catch (Exception ex)
            {
                UnifiaPlugin.Log.LogError($"Failed to patch {typeName}.{methodName}: {ex.Message}");
            }
        }

        // Neutralize the game's Steam-auth-ticket method (recipe `disableSteamAuth`).
        // On a cracked copy the Steam emulator can't produce an auth ticket, so the
        // game's connect coroutine hangs in GetAuthSessionTicket before it ever
        // reaches ConnectUsingSettings. REPO uses AuthType=None (Photon doesn't
        // validate the ticket), so skipping it is safe — we set clean AuthValues and
        // let the connect proceed. Patches SteamManager.SendSteamAuthTicket.
        public static void ApplyDisableSteamAuth(string typeName, string methodName)
        {
            var t = string.IsNullOrEmpty(typeName) ? "SteamManager" : typeName;
            var m = string.IsNullOrEmpty(methodName) ? "SendSteamAuthTicket" : methodName;

            var type = AppDomain.CurrentDomain.GetAssemblies()
                .Select(a => SafeGetType(a, t)).FirstOrDefault(x => x != null);
            var method = type?.GetMethod(m,
                BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.Static);
            if (method == null)
            {
                UnifiaPlugin.Log.LogWarning($"disableSteamAuth: '{t}.{m}' not found — Steam auth left as-is.");
                return;
            }
            try
            {
                _harmony = _harmony ?? new Harmony(UnifiaPlugin.Guid);
                var prefix = new HarmonyMethod(
                    typeof(HarmonyHooks).GetMethod(nameof(SkipSteamAuth), BindingFlags.NonPublic | BindingFlags.Static));
                _harmony.Patch(method, prefix: prefix);
                UnifiaPlugin.Log.LogInfo($"disableSteamAuth: patched {t}.{m} — connect won't block on the Steam ticket.");
            }
            catch (Exception ex)
            {
                UnifiaPlugin.Log.LogError($"disableSteamAuth: failed to patch {t}.{m}: {ex.Message}");
            }
        }

        // Prefix replacement for SendSteamAuthTicket: set clean AuthValues (no ticket,
        // AuthType=None) and skip the original (which would block fetching the ticket).
        private static bool SkipSteamAuth()
        {
            try
            {
                PhotonNetwork.AuthValues = new AuthenticationValues { AuthType = CustomAuthenticationType.None };
                UnifiaPlugin.Log.LogInfo("Steam auth neutralized — connecting without a Steam ticket.");
            }
            catch (Exception ex)
            {
                UnifiaPlugin.Log.LogError($"SkipSteamAuth failed: {ex.Message}");
            }
            return false; // skip the original SendSteamAuthTicket
        }

        private static Type SafeGetType(Assembly asm, string typeName)
        {
            try { return asm.GetType(typeName, false); }
            catch { return null; }
        }

        // Runs after the game's Photon-setup method; overwrite the AppId/version so
        // both copies share one Photon virtual app.
        private static void InjectSettings()
        {
            try
            {
                var app = PhotonNetwork.PhotonServerSettings.AppSettings;
                UnifiaPlugin.Log.LogInfo($"inject-settings fired — game's AppId was {Mask(app.AppIdRealtime)}.");

                // Set each field independently — pin the version even if no AppId is
                // configured (e.g. a cracked copy already has the right AppId via ini).
                if (!string.IsNullOrEmpty(_appId)) app.AppIdRealtime = _appId;
                if (!string.IsNullOrEmpty(_voiceAppId)) app.AppIdVoice = _voiceAppId;
                if (!string.IsNullOrEmpty(_appVersion)) app.AppVersion = _appVersion;

                if (string.IsNullOrEmpty(_appId))
                {
                    UnifiaPlugin.Log.LogWarning(
                        "inject-settings: photonAppId is EMPTY — AppId NOT overridden (version still pinned). " +
                        "Crossplay needs a shared AppId: set one in the Multiplayer invite, Unifia → Settings → " +
                        "Crossplay, or the recipe, then relaunch.");
                }
                else
                {
                    UnifiaPlugin.Log.LogInfo(
                        $"inject-settings APPLIED → AppIdRealtime={Mask(_appId)}, " +
                        $"AppIdVoice={Mask(_voiceAppId)}, AppVersion='{_appVersion}'. " +
                        "Both copies on this app+version will meet in the in-game server browser.");
                }
            }
            catch (Exception ex)
            {
                UnifiaPlugin.Log.LogError($"Inject failed: {ex.Message}");
            }
        }

        // Short, log-safe rendering of an AppId (it's a GUID-ish key).
        private static string Mask(string s)
        {
            if (string.IsNullOrEmpty(s)) return "<empty>";
            return s.Length <= 10 ? s : s.Substring(0, 8) + "…";
        }
    }
}
