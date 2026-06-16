// Get the deployment target for a mod
export function getModDeploymentTarget(fullName) {
  return /bepinexpack/i.test(fullName) ? 'root' : 'plugins';
}

// Get display label for deployment target
export function getDeploymentTargetLabel(fullName) {
  const target = getModDeploymentTarget(fullName);
  return target === 'root' ? 'Game Root (Loader)' : 'BepInEx/plugins';
}
