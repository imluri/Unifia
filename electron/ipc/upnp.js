// Best-effort UPnP / NAT-PMP port mapping so a host's IP is reachable over the
// internet without manual router config. Entirely optional: if nat-api isn't
// installed or no IGD responds, everything degrades to "forward the port
// yourself" and the rest of the app is unaffected. No cloud involved — this
// just asks the local router to open a port.

let NatAPI = null;
try {
  NatAPI = require('nat-api');
} catch {
  NatAPI = null; // optional dependency
}

let client = null;
function getClient() {
  if (!NatAPI) return null;
  if (!client) client = new NatAPI();
  return client;
}

// Reject if a UPnP op hangs (some routers never answer).
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('UPnP timed out')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function mapPort(port, protocol) {
  return new Promise((resolve, reject) => {
    const c = getClient();
    if (!c) return reject(new Error('UPnP unavailable'));
    c.map(
      { publicPort: port, privatePort: port, protocol, description: `Unifia ${protocol} ${port}` },
      (err) => (err ? reject(err) : resolve())
    );
  });
}

function unmapPort(port, protocol) {
  return new Promise((resolve) => {
    const c = getClient();
    if (!c) return resolve();
    c.unmap({ publicPort: port, privatePort: port, protocol }, () => resolve());
  });
}

function externalIp() {
  return new Promise((resolve) => {
    const c = getClient();
    if (!c) return resolve(null);
    c.externalIp((err, ip) => resolve(err ? null : ip));
  });
}

// Open the host's two ports: Photon (UDP, game traffic) and the lobby (TCP,
// coordination). Sequential so the gateway is discovered once then reused.
// Returns a structured result the UI can show; never throws.
async function openHostPorts({ photonPort, lobbyPort }, timeoutMs = 5000) {
  if (!NatAPI) return { available: false, reason: 'nat-api not installed' };

  const tryMap = async (port, protocol) => {
    try {
      await withTimeout(mapPort(port, protocol), timeoutMs);
      return { ok: true, port };
    } catch (err) {
      return { ok: false, port, reason: err.message };
    }
  };

  const externalIpAddr = await withTimeout(externalIp(), timeoutMs).catch(() => null);
  // photonPort is only forwarded for self-hosted mode; cloud-region relays
  // game traffic through Photon Cloud and just needs the lobby (TCP) reachable.
  const photon = photonPort ? await tryMap(photonPort, 'UDP') : null;
  const lobby = await tryMap(lobbyPort, 'TCP');
  return { available: true, photon, lobby, externalIp: externalIpAddr };
}

async function closeHostPorts({ photonPort, lobbyPort }) {
  if (!NatAPI) return;
  if (photonPort) await unmapPort(photonPort, 'UDP').catch(() => {});
  await unmapPort(lobbyPort, 'TCP').catch(() => {});
}

// Tear down the client (and its refresh timers) on app quit.
function shutdown() {
  return new Promise((resolve) => {
    if (!client) return resolve();
    try {
      client.destroy(() => {
        client = null;
        resolve();
      });
    } catch {
      client = null;
      resolve();
    }
  });
}

module.exports = { openHostPorts, closeHostPorts, externalIp, shutdown };
