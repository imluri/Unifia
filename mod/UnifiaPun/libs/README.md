# Reference assemblies

Drop the target game's reference DLLs here before building. They are **not**
committed (proprietary, and version-specific to each game).

Copy from `<Game>_Data/Managed/`:

- `UnityEngine.dll`
- `UnityEngine.CoreModule.dll`
- `UnityEngine.InputLegacyModule.dll` (provides `Input`)
- `UnityEngine.JSONSerializeModule.dll` (provides `JsonUtility`)
- `PhotonUnityNetworking.dll`
- `PhotonRealtime.dll`
- `Photon3Unity3D.dll`

Older PUN builds may name the Photon assemblies differently — match whatever the
game ships, and adjust the `<Reference>` HintPaths in `UnifiaPun.csproj` to suit.

Then build:

```
dotnet build -c Release
# optional: copy straight into the game after build
dotnet build -c Release -p:GameDir="C:\Path\To\Game"
```
