using System;
using System.Linq;
using System.Reflection;
using HarmonyLib;

namespace Unifia.Pun
{
    // Optional support for the "reconnect-on-load" strategy: for games whose own
    // networking-connect call must be wrapped, patch the method named in the
    // profile (connectHookType / connectHookMethod) so Unifia activates right
    // after the game tries to connect.
    //
    // Reflection-based on purpose — it needs no compile-time reference to the
    // game, so the same plugin binary works across titles; the target is data.
    internal static class HarmonyHooks
    {
        private static PunController _controller;
        private static Harmony _harmony;

        public static void Apply(PunController controller, string typeName, string methodName)
        {
            if (string.IsNullOrEmpty(typeName) || string.IsNullOrEmpty(methodName))
            {
                UnifiaPlugin.Log.LogWarning(
                    "reconnect-on-load needs connectHookType + connectHookMethod in the profile.");
                return;
            }

            _controller = controller;

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
                    typeof(HarmonyHooks).GetMethod(nameof(AfterConnect), BindingFlags.NonPublic | BindingFlags.Static));
                _harmony.Patch(method, postfix: postfix);
                UnifiaPlugin.Log.LogInfo($"Hooked {typeName}.{methodName} for reconnect-on-load.");
            }
            catch (Exception ex)
            {
                UnifiaPlugin.Log.LogError($"Failed to patch {typeName}.{methodName}: {ex.Message}");
            }
        }

        private static Type SafeGetType(Assembly asm, string typeName)
        {
            try
            {
                return asm.GetType(typeName, false);
            }
            catch
            {
                return null;
            }
        }

        // Runs after the game's own connect call; Activate() guards re-entry.
        private static void AfterConnect()
        {
            _controller?.Activate();
        }
    }
}
