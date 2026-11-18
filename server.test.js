import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createGameServer } from './server.js';

const redShirt = [0.82, 0.49, 0.35, 0.81, 0.49, 0.36, 0.79, 0.48, 0.34, 0.8, 0.48, 0.33];
const blueShirt = [0.45, 0.8, 0.32, 0.43, 0.8, 0.31, 0.44, 0.79, 0.31, 0.46, 0.8, 0.32];

async function arena(t) {
  let time = 100_000;
  const server = createGameServer({ now: () => time });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const clients = [];
  t.after(async () => {
    for (const ws of clients) ws.terminate();
    await new Promise((resolve) => server.close(resolve));
  });

  return {
    advance(ms) {
      time += ms;
    },
    async connect(message) {
      const ws = new WebSocket('ws://127.0.0.1:' + server.address().port + '/ws');
      clients.push(ws);
      const pending = [];
      const waiters = [];
      ws.on('message', (data) => {
        const m = JSON.parse(data);
        const index = waiters.findIndex((w) => w.match(m));

        if (index < 0) pending.push(m);
        else waiters.splice(index, 1)[0].resolve(m);
      });

      const wait = (match) => {
        const i = pending.findIndex(match);

        return i < 0
          ? new Promise((resolve) => waiters.push({ match, resolve }))
          : Promise.resolve(pending.splice(i, 1)[0]);
      };

      await once(ws, 'open');
      const send = (m) => ws.send(JSON.stringify(m));
      send(message);

      return {
        ws,
        send,
        wait,
        state: async (predicate) => (await wait((m) => m.type === 'state' && predicate(m.room))).room,
      };
    },
  };
}

test('round, identity, idempotent hits, rematch and secure recovery', { timeout: 8000 }, async (t) => {
  const game = await arena(t);
  const a = await game.connect({ type: 'create', name: 'A' });
  const owner = await a.wait((m) => m.type === 'welcome');
  const b = await game.connect({ type: 'join', name: 'B', code: owner.code });
  const peer = await b.wait((m) => m.type === 'welcome');
  b.send({ type: 'descriptor', targetId: owner.playerId, descriptor: blueShirt });
  assert.equal((await b.wait((m) => m.type === 'error')).code, 'INVALID_ACTION');
  a.send({ type: 'descriptor', targetId: peer.playerId, descriptor: blueShirt });
  const enrolled = await a.state((r) => r.players[1]?.descriptor);
  assert.deepEqual(enrolled.players[1].descriptor, blueShirt);
  assert.ok(!JSON.stringify(enrolled).includes(peer.token));
  a.send({ type: 'ready', ready: true });
  b.send({ type: 'ready', ready: true });
  await a.state((r) => r.players.length === 2 && r.players.every((p) => p.ready));
  a.send({ type: 'start' });
  assert.match((await a.wait((m) => m.type === 'error')).message, /shirt color/);
  a.send({ type: 'descriptor', descriptor: redShirt });
  await a.state((r) => r.phase === 'lobby' && r.players[0].descriptor);
  a.send({ type: 'start' });
  const started = await a.state((r) => r.phase === 'playing');
  const round = started.round;
  assert.equal(started.startsAt - started.serverNow, 3000);
  game.advance(3000);
  const late = await game.connect({ type: 'join', code: owner.code });
  await late.state((r) => r.players[2]?.spectator);
  const anchor = { triangle: 2, u: 0.1, v: 0.55 };

  // An acknowledgement from the same connection orders the launch before advancing the test clock.
  for (let n = 1; n <= 10; n++) {
    game.advance(400);
    const shotId = 'shot' + n;
    a.send({ type: 'throw', round, shotId });
    a.send({ type: 'throw', round, shotId: shotId + '-cooldown' });
    a.send({ type: 'barrier' });
    await a.wait((m) => m.type === 'error');
    game.advance(200);
    const impact = { type: 'impact', round, shotId, targetId: peer.playerId, anchor };
    a.send({ ...impact, shotId: shotId + '-cooldown' });
    a.send(impact);
    a.send(impact);
    const state = await a.state((r) => r.players[0].hits === n);
    assert.equal(state.players[1].health, 10 - n);
    assert.equal(state.players[1].splats.length, n);
    assert.equal(state.players[1].splats.at(-1).triangle, 2);

    if (n === 10) {
      assert.equal(state.phase, 'finished');
      assert.equal(state.players[0].eliminations, 1);
      assert.deepEqual(
        state.leaderboard.map((row) => row.id),
        [owner.playerId, peer.playerId],
      );
    }
  }

  a.ws.close();
  await b.state((r) => r.hostId === peer.playerId);
  const resumed = await game.connect({ type: 'resume', code: owner.code, token: owner.token });
  assert.equal((await resumed.wait((m) => m.type === 'welcome')).playerId, owner.playerId);
  b.send({ type: 'rematch' });
  const reset = await resumed.state((r) => r.phase === 'lobby');
  assert.equal(reset.players[1].health, 10);
  assert.equal(reset.players[1].splats.length, 0);
  assert.ok(reset.players.every((p) => !p.spectator && !p.ready));
  b.send({ type: 'start' });
  assert.match((await b.wait((m) => m.type === 'error')).message, /ready camera/);
  const intruder = await game.connect({ type: 'resume', code: owner.code, token: 'guess' });
  assert.equal((await intruder.wait((m) => m.type === 'error')).code, 'INVALID_TOKEN');
});

test(
  'timeout shares ranks, and an empty room expires after disconnect grace',
  { timeout: 5000 },
  async (t) => {
    const game = await arena(t);
    const a = await game.connect({ type: 'create' });
    const { code, token } = await a.wait((m) => m.type === 'welcome');
    const b = await game.connect({ type: 'join', code });
    a.send({ type: 'ready', ready: true, descriptor: redShirt });
    b.send({ type: 'ready', ready: true, descriptor: blueShirt });
    await a.state((r) => r.players.length === 2 && r.players.every((p) => p.ready));
    a.send({ type: 'start' });
    await a.state((r) => r.phase === 'playing');
    game.advance(93_001);
    assert.deepEqual(
      (await a.state((r) => r.phase === 'finished')).leaderboard.map((p) => p.rank),
      [1, 1],
    );
    a.ws.close();
    await b.state((r) => r.phase === 'finished' && !r.players[0].connected);
    const closed = once(b.ws, 'close');
    b.ws.close();
    await closed;
    await new Promise((resolve) => setTimeout(resolve, 30));
    game.advance(25_001);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const stale = await game.connect({ type: 'resume', code, token });
    assert.equal((await stale.wait((m) => m.type === 'error')).code, 'ROOM_NOT_FOUND');
  },
);

test(
  'countdown locks damage and the final opponent can trade after two eliminations in the same millisecond',
  { timeout: 5000 },
  async (t) => {
    const game = await arena(t);
    const a = await game.connect({ type: 'create' });
    const owner = await a.wait((m) => m.type === 'welcome');
    const c = await game.connect({ type: 'join', code: owner.code });
    const earlier = await c.wait((m) => m.type === 'welcome');
    c.send({type:'ready', ready:true, descriptor:Array(12).fill(0.2)});
    const b = await game.connect({ type: 'join', code: owner.code });
    const peer = await b.wait((m) => m.type === 'welcome');
    a.send({ type: 'ready', ready: true, descriptor: redShirt });
    b.send({ type: 'ready', ready: true, descriptor: blueShirt });
    await a.state((r) => r.players.length === 3 && r.players.every((p) => p.ready));
    a.send({ type: 'start' });
    const { round } = await a.state((r) => r.phase === 'playing');
    const throwAt = (client, shotId) => client.send({ type: 'throw', round, shotId });

    const hit = (client, shotId, targetId) =>
      client.send({ type: 'impact', round, shotId, targetId, anchor: { triangle: 0, u: 0, v: 0.5 } });

    const flush = async (client) => {
      client.send({ type: 'barrier' });
      await client.wait((m) => m.type === 'error');
    };

    game.advance(2900);
    throwAt(a, 'early');
    await flush(a);
    game.advance(200);
    hit(a, 'early', peer.playerId);
    await flush(a);

    for (let n = 1; n <= 10; n++) {
      game.advance(400);
      const shotId = 's' + n;
      throwAt(a, 'first-' + n);
      await flush(a);
      game.advance(410);
      throwAt(a, shotId);
      throwAt(b, shotId);
      await Promise.all([flush(a), flush(b)]);
      game.advance(200);
      hit(a, 'first-' + n, earlier.playerId);
      await c.state(r => r.players[1].health === 10-n);
      hit(a, shotId, peer.playerId);
      const s = await b.state((r) => r.players[2].health === 10 - n);
      assert.equal(s.phase, 'playing');

      if (n === 10) game.advance(801); // Final pose result arrives after the opponent's lethal hit.
      hit(b, shotId, owner.playerId);
      await a.state((r) => r.players[0].health === 10 - n);
    }

    const done = await b.state((r) => r.phase === 'finished');
    assert.deepEqual(
      done.leaderboard.map((p) => p.rank),
      [1, 1, 3],
    );
    assert.ok(done.players.every((p) => p.health === 0));
    assert.deepEqual(done.players.map(p=>p.eliminations),[2,0,1]);
    b.send({ type: 'leave' });
    const closed = once(b.ws, 'close');
    await b.wait((m) => m.type === 'left');
    assert.equal((await closed)[0], 1000);
    const previous = await game.connect({ type: 'resume', code: owner.code, token: peer.token });
    assert.equal((await previous.wait((m) => m.type === 'error')).code, 'INVALID_TOKEN');
  },
);

test(
  'disconnected players can rejoin within grace then forfeit after grace',
  { timeout: 5000 },
  async (t) => {
    const game = await arena(t);
    const a = await game.connect({ type: 'create' });
    const owner = await a.wait((m) => m.type === 'welcome');
    const b = await game.connect({ type: 'join', code: owner.code });
    const peer = await b.wait((m) => m.type === 'welcome');
    a.send({ type: 'ready', ready: true, descriptor: redShirt });
    b.send({ type: 'ready', ready: true, descriptor: blueShirt });
    await a.state((r) => r.players.length === 2 && r.players.every((p) => p.ready));
    a.send({ type: 'start' });
    await a.state((r) => r.phase === 'playing');
    b.ws.close();
    await a.state((r) => r.phase === 'playing' && !r.players[1].connected);
    game.advance(3000);
    const resumed = await game.connect({ type: 'resume', code: owner.code, token: peer.token });
    const back = await resumed.state((r) => r.phase === 'playing' && r.players[1].connected);
    assert.equal(back.players[1].health, 10);
    resumed.ws.close();
    await a.state((r) => r.serverNow === back.serverNow && !r.players[1].connected);
    game.advance(25_001);
    const done = await a.state((r) => r.phase === 'finished');
    assert.equal(done.leaderboard[0].id, owner.playerId);
    assert.equal(done.players[1].health, 0);
  },
);

test('spectators release full-room slots on leave or after reconnect grace', { timeout: 5000 }, async (t) => {
  const game = await arena(t);
  const host = await game.connect({ type: 'create' });
  const { code } = await host.wait((m) => m.type === 'welcome');
  const teammate = await game.connect({ type: 'join', code });
  host.send({ type: 'ready', ready: true, descriptor: redShirt });
  teammate.send({ type: 'ready', ready: true, descriptor: blueShirt });
  await host.state((r) => r.players.length === 2 && r.players.every((p) => p.ready));
  host.send({ type: 'start' });
  await host.state((r) => r.phase === 'playing');

  const audience = await Promise.all(Array.from({ length: 6 }, () => game.connect({ type: 'join', code })));
  await host.state((r) => r.players.length === 8);
  const replacement = await game.connect({ type: 'join', code });
  assert.equal((await replacement.wait((m) => m.type === 'error')).code, 'ROOM_FULL');

  audience[0].send({ type: 'leave' });
  await audience[0].wait((m) => m.type === 'left');
  replacement.send({ type: 'join', code });
  const replacementId = (await replacement.wait((m) => m.type === 'welcome')).playerId;
  await host.state((r) => r.players.some((p) => p.id === replacementId));

  const spot = await audience[1].wait((m) => m.type === 'welcome');
  audience[1].ws.close();
  const retained = await host.state((r) => r.players.some((p) => p.id === spot.playerId && !p.connected));
  assert.equal(retained.players.length, 8);
  game.advance(25_001);
  const released = await host.state((r) => r.serverNow > retained.serverNow && !r.players.some((p) => p.id === spot.playerId));
  assert.equal(released.players.length, 7);

  game.advance(93_000);
  await host.state((r) => r.phase === 'finished');
  replacement.ws.close();
  await host.state((r) => r.phase === 'finished' && r.players.some((p) => p.id === replacementId && !p.connected));
  game.advance(25_001);
  const scores = await host.state((r) => r.phase === 'finished' && !r.players.some((p) => p.id === replacementId));
  assert.equal(scores.leaderboard.length, 2);
});

test('a resumed lobby camera must report ready before the host can start', { timeout: 5000 }, async (t) => {
  const game = await arena(t);
  const host = await game.connect({ type: 'create' });
  const { code } = await host.wait((m) => m.type === 'welcome');
  const guest = await game.connect({ type: 'join', code });
  const { token, playerId } = await guest.wait((m) => m.type === 'welcome');
  host.send({ type: 'ready', ready: true, descriptor: redShirt });
  guest.send({ type: 'ready', ready: true, descriptor: blueShirt });
  await host.state((r) => r.players.length === 2 && r.players.every((p) => p.ready));

  guest.ws.close();
  await host.state((r) => r.players.some((p) => p.id === playerId && !p.connected));
  game.advance(500);
  const restored = await game.connect({ type: 'resume', code, token });
  const fresh = await restored.state((r) => r.phase === 'lobby');
  const returned = await host.state((r) => r.serverNow === fresh.serverNow);
  assert.equal(returned.players.find((p) => p.id === playerId).ready, false);
  assert.deepEqual(returned.players.find((p) => p.id === playerId).descriptor, blueShirt);
  host.send({ type: 'start' });
  assert.match((await host.wait((m) => m.type === 'error')).message, /ready camera/);

  restored.send({ type: 'ready', ready: true });
  await host.state((r) => r.serverNow === fresh.serverNow && r.players.every((p) => p.ready));
  host.send({ type: 'start' });
  assert.equal((await host.state((r) => r.phase === 'playing')).round, 1);
});
