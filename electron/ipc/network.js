const net = require('net');
const os = require('os');
const { store } = require('../store');

// Lightweight lobby networking over raw TCP. The host opens a port and accepts
// clients; each side exchanges a newline-delimited JSON handshake carrying the
// game id, version and username. Version mismatches are reported, not fatal —
// the UI decides what to do. Periodic ping messages keep a latency estimate.
//
// createNetwork(emit) returns the API. `emit(channel, payload)` forwards events
// to the renderer (player-joined, player-left, version-mismatch).

const PING_INTERVAL = 3000;

function getLocalIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

// Frame helpers: one JSON object per line.
function send(socket, obj) {
  try {
    socket.write(JSON.stringify(obj) + '\n');
  } catch {
    /* socket may have closed mid-write */
  }
}

function createNetwork(emit) {
  let server = null;
  let hostState = null; // { port, gameId, version, players: Map }
  let clientState = null; // { socket, host, port, players, pingTimer }

  function selfIdentity(gameId) {
    const settings = store.get('settings') || {};
    const games = store.get('games') || [];
    const game = games.find((g) => g.id === gameId);
    return {
      gameId,
      version: game ? game.version : 'unknown',
      username: settings.username || 'Player',
    };
  }

  // --- Host mode -----------------------------------------------------------
  function hostSession(gameId, port = 7777) {
    if (server) stopHost();

    const identity = selfIdentity(gameId);
    const players = new Map(); // id -> { id, name, ping, socket }
    let nextId = 1;

    // Add the host itself as the first player entry.
    const hostId = 'host';
    players.set(hostId, { id: hostId, name: identity.username, ping: 0, socket: null });

    server = net.createServer((socket) => {
      const id = `c${nextId++}`;
      let buffer = '';
      let pingSentAt = 0;

      socket.setEncoding('utf8');
      socket.on('data', (chunk) => {
        buffer += chunk;
        let idx;
        while ((idx = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          if (!line.trim()) continue;
          let msg;
          try {
            msg = JSON.parse(line);
          } catch {
            continue;
          }

          if (msg.type === 'hello') {
            // Version handshake. Report mismatch but still register the player.
            if (msg.version !== identity.version) {
              const payload = {
                code: 'VERSION_MISMATCH',
                hostVersion: identity.version,
                clientVersion: msg.version,
                player: msg.username,
              };
              send(socket, { type: 'version-mismatch', ...payload });
              emit('version-mismatch', payload);
            }
            players.set(id, { id, name: msg.username || id, ping: 0, socket });
            send(socket, {
              type: 'welcome',
              gameId: identity.gameId,
              hostVersion: identity.version,
              players: serializePlayers(players),
            });
            emit('player-joined', { id, name: msg.username || id, ping: 0 });
            broadcastPlayers(players);
          } else if (msg.type === 'pong') {
            const p = players.get(id);
            if (p && pingSentAt) p.ping = Date.now() - pingSentAt;
          }
        }
      });

      const pingTimer = setInterval(() => {
        pingSentAt = Date.now();
        send(socket, { type: 'ping', t: pingSentAt });
      }, PING_INTERVAL);

      const cleanup = () => {
        clearInterval(pingTimer);
        const p = players.get(id);
        players.delete(id);
        if (p) emit('player-left', { id, name: p.name });
        broadcastPlayers(players);
      };
      socket.on('close', cleanup);
      socket.on('error', cleanup);
    });

    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, () => {
        hostState = { port, gameId: identity.gameId, version: identity.version, players };
        resolve({ hosting: true, ip: getLocalIP(), port, gameId: identity.gameId });
      });
    });
  }

  function serializePlayers(players) {
    return Array.from(players.values()).map(({ id, name, ping }) => ({ id, name, ping }));
  }

  function broadcastPlayers(players) {
    const list = serializePlayers(players);
    for (const p of players.values()) {
      if (p.socket) send(p.socket, { type: 'players', players: list });
    }
  }

  function stopHost() {
    if (hostState) {
      for (const p of hostState.players.values()) {
        if (p.socket) p.socket.destroy();
      }
    }
    if (server) {
      server.close();
      server = null;
    }
    hostState = null;
  }

  // --- Client mode ---------------------------------------------------------
  function joinSession(gameId, host, port = 7777) {
    if (clientState) stopClient();
    const identity = selfIdentity(gameId);

    return new Promise((resolve, reject) => {
      const socket = net.connect(port, host, () => {
        send(socket, { type: 'hello', ...identity });
      });
      socket.setEncoding('utf8');
      let buffer = '';
      let settled = false;

      socket.on('data', (chunk) => {
        buffer += chunk;
        let idx;
        while ((idx = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          if (!line.trim()) continue;
          let msg;
          try {
            msg = JSON.parse(line);
          } catch {
            continue;
          }

          if (msg.type === 'welcome') {
            clientState.players = msg.players || [];
            if (!settled) {
              settled = true;
              const match = msg.hostVersion === identity.version;
              resolve({
                connected: true,
                host,
                port,
                hostVersion: msg.hostVersion,
                clientVersion: identity.version,
                versionMatch: match,
                players: clientState.players,
              });
            }
          } else if (msg.type === 'version-mismatch') {
            emit('version-mismatch', msg);
          } else if (msg.type === 'players') {
            clientState.players = msg.players || [];
            emit('player-joined', { players: clientState.players });
          } else if (msg.type === 'ping') {
            send(socket, { type: 'pong', t: msg.t });
          }
        }
      });

      socket.on('error', (err) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      });
      socket.on('close', () => {
        emit('player-left', { self: true });
      });

      clientState = { socket, host, port, players: [] };
    });
  }

  function stopClient() {
    if (clientState && clientState.socket) clientState.socket.destroy();
    clientState = null;
  }

  function getPlayers() {
    if (hostState) return serializePlayers(hostState.players);
    if (clientState) return clientState.players;
    return [];
  }

  function stopSession() {
    stopHost();
    stopClient();
    return { stopped: true };
  }

  return {
    getLocalIP,
    hostSession,
    joinSession,
    stopSession,
    getPlayers,
  };
}

module.exports = { createNetwork, getLocalIP };
