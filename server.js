import { bodyTriangleCount } from './public/body.js';
import { addInk, createInkSurface, inkColors, inkStandings, sprayIntervalMs, totalInkCells } from './public/ink.js';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { createServer as httpServer } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { createReadStream, readFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';

const root = dirname(fileURLToPath(import.meta.url));
const palette = inkColors.map(ink => ink.hex);
const roundMs = 90_000;
const graceMs = 25_000;

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

async function serve(req, res) {
  try {
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405).end();

      return;
    }

    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);

    if (/[\\:\0]/.test(path) || path.split('/').includes('..')) {
      res.writeHead(400).end();

      return;
    }

    let base = resolve(root, 'dist');
    let name = path.slice(1) || 'index.html';

    if (path === '/pose.task') {
      base = resolve(root, 'assets');
      name = 'pose.task';
    }

    if (path.startsWith('/vision-wasm/')) {
      base = resolve(root, 'node_modules/@mediapipe/tasks-vision/wasm');
      name = path.slice('/vision-wasm/'.length);
    }

    const file = resolve(base, name);

    if (!file.startsWith(base + sep)) {
      res.writeHead(404).end();

      return;
    }

    const info = await stat(file);

    if (!info.isFile()) {
      res.writeHead(404).end();

      return;
    }

    res.writeHead(200, {
      'Content-Type': mime[extname(file)] || 'application/octet-stream',
      'Content-Length': info.size,
      'X-Content-Type-Options': 'nosniff',
    });

    if (req.method === 'HEAD') res.end();
    else
      createReadStream(file)
        .on('error', () => res.destroy())
        .pipe(res);
  } catch {
    res.writeHead(404).end();
  }
}

function send(ws, payload) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

function error(ws, message, code = 'INVALID_ACTION') {
  send(ws, { type: 'error', message, code });
}

function colorTaken(ws, color) {
  send(ws, { type:'error', code:'COLOR_TAKEN', color, message:'That color is taken. Pick an available color.' });
}

function snapshot(room, now) {
  const players = [...room.players.values()];

  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    round: room.round,
    startsAt: room.startsAt,
    endsAt: room.endsAt,
    serverNow: now,
    paintSeq: room.paintSeq,
    leaderboard: inkStandings(players),
    players: players.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      connected: !!p.ws,
      ready: p.ready,
      health: p.health,
      hits: p.hits,
      score: p.score,
      coverage: p.coverage,
      spectator: p.spectator,
      splats: p.splats,
    })),
  };
}

function broadcast(room, now) {
  const state = { type: 'state', room: snapshot(room, now) };

  for (const p of room.players.values()) send(p.ws, state);
}

function finishIfNeeded(room, now) {
  if (room.phase !== 'playing') return;
  const remaining = [...room.players.values()].filter(p => !p.spectator && p.health > 0);

  if (now >= room.endsAt || remaining.length < 2) room.phase = 'finished';
}

function resetPlayer(p) {
  Object.assign(p, {
    spectator: false, health: 10, hits: 0, score: 0, coverage: 0, inked: 0,
    cells: createInkSurface(), splats: [], shots: new Set(), nextSpray: -Infinity,
  });
}

function spray(room, player, m, at) {
  if (room.phase !== 'playing' || room.round !== m.round || player.spectator || !player.health || at < room.startsAt) return;

  if (!/^[a-zA-Z0-9_:-]{1,80}$/.test(jsonText(m.shotId))) return error(player.ws, 'Invalid spray ID');

  // Allow a pair of pulses to arrive together after a network stall, while
  // preserving the six-per-second cadence over a sustained burst.
  if (at < player.nextSpray - sprayIntervalMs || player.shots.has(m.shotId)) return;
  player.nextSpray = Math.max(player.nextSpray, at) + sprayIntervalMs;
  player.shots.add(m.shotId);
  const target = room.players.get(m.targetId);

  if (!target?.ws || target === player || target.spectator || !target.health) return;
  const { triangle, u, v } = m.anchor || {};

  if (!Number.isInteger(triangle) || triangle < 0 || triangle >= bodyTriangleCount
    || !Number.isFinite(u) || !Number.isFinite(v) || u < 0 || v < 0 || u+v > 1.00001) return;
  // Zero represents bare skin; each palette entry has its own positive cell value.
  const { fresh, changed } = addInk(target.cells, { triangle, u, v }, palette.indexOf(player.color) + 1);
  let splat;
  player.hits++;

  if (changed) {
    target.inked += fresh;
    target.coverage = Math.round(target.inked * 1000 / totalInkCells) / 10;
    player.score += fresh;
    splat = { id: player.id + '-' + m.shotId, shooterId: player.id, color: player.color,
      triangle, u, v, scale: 1, seed: randomInt(0x7fffffff) };
    target.splats.push(splat);
  }

  const event = { type: 'paint', code: room.code, round: room.round, seq: ++room.paintSeq, serverNow: at,
    shooterId: player.id, color: player.color, targetId: target.id, score: player.score, hits: player.hits, coverage: target.coverage, splat };

  for (const member of room.players.values()) send(member.ws, event);
}

// Parsed JSON has no boxed primitives or Symbol.toStringTag overrides.
function jsonText(value) {
  return Object.prototype.toString.call(value) === '[object String]' ? value : '';
}

export function createGameServer({ now = Date.now, tls, socketPath = '/ws' } = {}) {
  const server = tls ? httpsServer(tls, serve) : httpServer(serve);
  const sockets = new WebSocketServer({ server, path: socketPath, maxPayload: 8192 });
  const rooms = new Map();
  sockets.on('connection', (ws) => {
    let room,
      player,
      windowAt = now(),
      count = 0;

    ws.alive = true;
    ws.on('pong', () => {
      ws.alive = true;
    });
    ws.on('error', () => ws.terminate());
    ws.on('message', (data, binary) => {
      const at = now();

      if (at - windowAt >= 1000) {
        windowAt = at;
        count = 0;
      }

      if (++count > 60) {
        ws.close(1008, 'Too many messages');

        return;
      }

      let m;

      try {
        m = JSON.parse(data);
      } catch {
        return error(ws, 'Invalid message');
      }

      if (binary || !jsonText(m?.type)) return error(ws, 'Invalid message');

      if (!room) {
        if (!['create', 'join', 'resume'].includes(m.type)) return error(ws, 'Join a room first');

        if (m.type !== 'resume' && m.color !== undefined && !palette.includes(m.color)) return error(ws, 'Pick a lobby ink color');
        let candidate;

        if (m.type === 'create') {
          if (rooms.size >= 2000) return error(ws, 'Rooms are busy. Try again shortly');
          let code;

          do {
            code = String(randomInt(100000, 1000000));
          } while (rooms.has(code));

          candidate = {
            code,
            hostId: null,
            phase: 'lobby',
            round: 0,
            startsAt: 0,
            endsAt: 0,
            paintSeq: 0,
            players: new Map(),
          };
          rooms.set(code, candidate);
        } else {
          candidate = rooms.get(m.code);

          if (!candidate) return error(ws, 'Room has expired or does not exist', 'ROOM_NOT_FOUND');
        }

        if (m.type === 'resume') {
          player = [...candidate.players.values()].find((p) => p.token && p.token === m.token);

          if (!player) return error(ws, 'Player session has expired', 'INVALID_TOKEN');

          if (player.ws) player.ws.close(4001, 'Session resumed');

          if (candidate.phase === 'lobby') player.ready = false;
        } else {
          if (candidate.players.size >= palette.length) return error(ws, 'Room is full', 'ROOM_FULL');

          const name = jsonText(m.name)
            .replace(/[\p{Cc}\p{Cf}]/gu, '')
            .trim()
            .slice(0, 24);

          const taken = new Set([...candidate.players.values()].map((p) => p.color));

          if (taken.has(m.color)) return colorTaken(ws, m.color);
          player = {
            id: randomUUID(),
            token: randomBytes(24).toString('hex'),
            name: name || 'Player ' + (candidate.players.size + 1),
            color: m.color ?? palette.find(c => !taken.has(c)),
            ready: false,
          };
          resetPlayer(player);
          player.spectator = candidate.phase !== 'lobby';
          candidate.players.set(player.id, player);
        }

        room = candidate;
        player.ws = ws;
        player.offlineAt = null;
        room.hostId ??= player.id;
        send(ws, { type: 'welcome', code: room.code, playerId: player.id, token: player.token });

        return broadcast(room, at);
      }

      if (player.ws !== ws) return;

      if (room.phase === 'playing' && at >= room.endsAt) {
        finishIfNeeded(room, at);
        broadcast(room, at);
      }

      if (m.type === 'sync') return send(ws, { type:'state', room:snapshot(room, at) });

      if (m.type === 'leave') {
        send(ws, { type: 'left' });
        player.token = null;
        player.ws = null;
        player.offlineAt = at - graceMs;

        if (player.spectator || room.phase === 'lobby') room.players.delete(player.id);
        else if (room.phase === 'playing') player.health = 0;

        if (room.hostId === player.id) room.hostId = [...room.players.values()].find((p) => p.ws)?.id ?? null;
        finishIfNeeded(room, at);
        broadcast(room, at);
        ws.close(1000, 'Left room');

        return;
      }

      if (m.type === 'color') {
        if (room.phase !== 'lobby' || !palette.includes(m.color)) return error(ws, 'Pick a lobby ink color');

        if ([...room.players.values()].some(p => p !== player && p.color === m.color)) {
          colorTaken(ws, m.color);

          return send(ws, { type:'state', room:snapshot(room, at) });
        }

        player.color = m.color;
      } else if (m.type === 'ready') {
        if (room.phase !== 'lobby' || ![true, false].includes(m.ready)) return error(ws, 'Ready up in the lobby');
        player.ready = m.ready;
      } else if (m.type === 'start') {
        const online = [...room.players.values()].filter(p => p.ws);

        if (room.hostId !== player.id || room.phase !== 'lobby' || online.length < 2)
          return error(ws, 'The host needs at least two connected players to start');

        for (const p of room.players.values()) {
          resetPlayer(p);
          p.spectator = !p.ws;
        }

        room.phase = 'playing';
        room.startsAt = at + 3000;
        room.endsAt = room.startsAt + roundMs;
        room.paintSeq = 0;
        room.round++;
      } else if (m.type === 'rematch') {
        if (room.hostId !== player.id || room.phase !== 'finished')
          return error(ws, 'Only the host can reset a finished round');
        room.phase = 'lobby';
        room.startsAt = room.endsAt = 0;

        for (const p of room.players.values()) {
          if (!p.ws && (p.token === null || at - p.offlineAt >= graceMs)) room.players.delete(p.id);
          else {
            resetPlayer(p);
            p.ready = false;
          }
        }
      } else if (m.type === 'spray') {
        return spray(room, player, m, at);
      } else {
        return error(ws, 'Unknown action');
      }

      broadcast(room, at);
    });
    ws.on('close', () => {
      if (!room || player.ws !== ws) return;
      player.ws = null;
      player.offlineAt = now();

      if (room.hostId === player.id) room.hostId = [...room.players.values()].find((p) => p.ws)?.id ?? null;
      broadcast(room, now());
    });
  });

  const heartbeat = setInterval(() => {
    for (const ws of sockets.clients) {
      if (!ws.alive) ws.terminate();
      else if (ws.readyState === WebSocket.OPEN) {
        ws.alive = false;
        ws.ping();
      }
    }
  }, 10_000);

  heartbeat.unref();

  const housekeeping = setInterval(() => {
    const at = now();

    for (const room of rooms.values()) {
      let changed = false;
      const previous = room.phase;

      for (const p of room.players.values()) {
        if (p.ws || p.offlineAt === null || at - p.offlineAt < graceMs) continue;

        if (p.spectator || room.phase === 'lobby') {
          room.players.delete(p.id);
          changed = true;
        } else if (room.phase === 'playing' && p.health > 0) {
          p.health = 0;
          changed = true;
        }
      }

      if ([...room.players.values()].every((p) => !p.ws && at - p.offlineAt >= graceMs)) {
        rooms.delete(room.code);
        continue;
      }

      finishIfNeeded(room, at);

      if (changed || previous !== room.phase) broadcast(room, at);
    }
  }, 250);

  housekeeping.unref();
  server.on('close', () => {
    clearInterval(heartbeat);
    clearInterval(housekeeping);
    sockets.close();
  });

  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { TLS_CERT, TLS_KEY, HOST = '0.0.0.0', PORT = '3000' } = process.env;

  if (!!TLS_CERT !== !!TLS_KEY) throw new Error('Provide both TLS_CERT and TLS_KEY');
  const tls = TLS_CERT ? { cert: readFileSync(TLS_CERT), key: readFileSync(TLS_KEY) } : undefined;
  createGameServer({ tls }).listen(Number(PORT), HOST, () =>
    console.log('Room server listening on ' + HOST + ':' + PORT),
  );
}
