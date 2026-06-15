using System.Text.Json;
using System.Text.Json.Serialization;
using Mono.Cecil;
using Mono.Cecil.Cil;

// UnifiaAnalyzer <path-to-Assembly-CSharp.dll>
// Scans IL for known Photon/Steamworks call sites and prints a JSON report.
// JSON uses source generation (ReportContext) so the tool can be published
// trimmed/self-contained (~13 MB) without breaking serialization.

static class Catalog
{
    // declaringTypeContains, method ("" = any), role, netcode (null = no netcode signal)
    public static readonly (string Type, string Method, string Role, string Netcode)[] Rules =
    {
        ("Photon.Pun.PhotonNetwork", "ConnectUsingSettings", "connect", "pun2"),
        ("Photon.Pun.PhotonNetwork", "JoinOrCreateRoom",     "join",    "pun2"),
        ("Photon.Pun.PhotonNetwork", "JoinRoom",             "join",    "pun2"),
        ("Photon.Pun.PhotonNetwork", "CreateRoom",           "host",    "pun2"),
        ("Photon.Realtime.AuthenticationValues", ".ctor",    "authValues", "pun2"),
        ("Steamworks.SteamUser",        "GetAuthSessionTicket", "authTicket", null),
        ("Steamworks.SteamMatchmaking", "CreateLobby",          "steamLobby", null),
        ("Steamworks.SteamMatchmaking", "JoinLobby",            "steamLobby", null),
        ("Mirror.NetworkManager",  "StartHost",   "host",    "mirror"),
        ("FishNet.Managing.NetworkManager", "", "connect",   "fishnet"),
    };
}

record Hook(string type, string method);
record Match(string api, string role, string type, string method);

class Report
{
    public int schema { get; set; } = 1;
    public string netcode { get; set; } = "unknown";
    public bool usesSteamLobbies { get; set; }
    public bool usesSteamAuth { get; set; }
    public Dictionary<string, Hook> hooks { get; set; } = new();
    public List<Match> matches { get; set; } = new();
    public string feasibility { get; set; } = "unknown";
    public double confidence { get; set; }
    public string error { get; set; }
}

[JsonSourceGenerationOptions(DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull)]
[JsonSerializable(typeof(Report))]
partial class ReportContext : JsonSerializerContext { }

class Program
{
    static int Main(string[] args)
    {
        if (args.Length < 1)
        {
            Print(new Report { error = "usage: UnifiaAnalyzer <assembly.dll>" });
            return 2;
        }
        var report = new Report();
        try
        {
            var asm = AssemblyDefinition.ReadAssembly(args[0]);
            foreach (var type in AllTypes(asm.MainModule))
            {
                foreach (var method in type.Methods)
                {
                    if (!method.HasBody) continue;
                    foreach (var ins in method.Body.Instructions)
                    {
                        if (ins.OpCode.Code != Code.Call && ins.OpCode.Code != Code.Callvirt && ins.OpCode.Code != Code.Newobj)
                            continue;
                        if (ins.Operand is not MethodReference mref) continue;
                        var declTypeFull = mref.DeclaringType?.FullName ?? "";
                        var calledName = mref.Name ?? "";
                        foreach (var rule in Catalog.Rules)
                        {
                            // Steam matchmaking wrappers vary (CreateLobby / CreateLobbyAsync /
                            // JoinLobby / JoinLobbyAsync across Steamworks.NET vs Facepunch), so
                            // lobby methods match by prefix; everything else is exact.
                            bool nameOk = rule.Method.Length == 0
                                || calledName == rule.Method
                                || (rule.Role == "steamLobby" && calledName.StartsWith(rule.Method, StringComparison.Ordinal));
                            if (!declTypeFull.Contains(rule.Type) || !nameOk) continue;
                            ApplyMatch(report, rule, type.FullName, method.Name);
                        }
                    }
                }
            }
            Finalize(report);
        }
        catch (Exception e)
        {
            report.error = e.Message;
            report.netcode = "unknown";
            report.feasibility = "unknown";
            Print(report);
            return 1;
        }
        Print(report);
        return 0;
    }

    static void Print(Report r) => Console.WriteLine(JsonSerializer.Serialize(r, ReportContext.Default.Report));

    static IEnumerable<TypeDefinition> AllTypes(ModuleDefinition mod)
    {
        foreach (var t in mod.Types)
        {
            yield return t;
            foreach (var n in Nested(t)) yield return n;
        }
    }
    static IEnumerable<TypeDefinition> Nested(TypeDefinition t)
    {
        foreach (var n in t.NestedTypes)
        {
            yield return n;
            foreach (var nn in Nested(n)) yield return nn;
        }
    }

    static void ApplyMatch(Report r, (string Type, string Method, string Role, string Netcode) rule, string containingType, string containingMethod)
    {
        r.matches.Add(new Match(rule.Type + "::" + rule.Method, rule.Role, containingType, containingMethod));
        if (rule.Role == "steamLobby") r.usesSteamLobbies = true;
        if (rule.Role == "authTicket") r.usesSteamAuth = true;
        if (rule.Netcode != null && r.netcode == "unknown") r.netcode = rule.Netcode;
        // First container wins for the named hook slots.
        if ((rule.Role is "connect" or "host" or "join" or "authTicket") && !r.hooks.ContainsKey(rule.Role))
            r.hooks[rule.Role] = new Hook(containingType, containingMethod);
    }

    static void Finalize(Report r)
    {
        if (r.netcode == "pun2")
            r.feasibility = r.usesSteamLobbies ? "needs-reroute" : "supported";
        else if (r.netcode is "mirror" or "fishnet")
            r.feasibility = "unsupported";
        else
            r.feasibility = "unknown";
        r.confidence = r.matches.Count == 0 ? 0.0 : Math.Min(1.0, 0.4 + 0.1 * r.matches.Count);
    }
}
