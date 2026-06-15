// Pure mapping from an analyzer report to the connector's per-game profile
// fields (netcode/hookStrategy/connectHookType/connectHookMethod/feasibility).
function mapReportToProfile(report) {
  const hooks = report.hooks || {};
  const hook = hooks.join || hooks.connect || {};
  const hookStrategy = hooks.join
    ? 'reconnect-on-load'
    : report.netcode === 'pun2'
      ? 'auto-on-load'
      : 'manual';
  return {
    netcode: report.netcode || 'unknown',
    feasibility: report.feasibility || 'unknown',
    hookStrategy,
    connectHookType: hook.type || '',
    connectHookMethod: hook.method || '',
  };
}

module.exports = { mapReportToProfile };
