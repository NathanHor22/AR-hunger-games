import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createGameServer } from './server.js';
import { inkColors } from './public/ink.js';


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

test('camera-free entry, rapid coverage scoring, chosen paint, recovery and rematch', { timeout: 8000 }, async t => {
  const game = await arena(t);
  const green = '#49e066';
  const blue = '#319cff';
  const a = await game.connect({ type: 'create', name: 'A', color: blue });
  const owner = await a.wait(m => m.type === 'welcome');
  const b = await game.connect({ type: 'join', name: 'B', code: owner.code, color: '#a369ff' });
  const peer = await b.wait(m => m.type === 'welcome');
  b.send({ type: 'color', color: green });
  const enrolled = await a.state(r => r.players[1]?.color === green);
  assert.ok(enrolled.players.every(p => !('descriptor' in p) && !p.ready));
  assert.ok(!JSON.stringify(enrolled).includes(peer.token));
  a.send({ type:'color', color: green });
  const conflict = await a.wait(m => m.code === 'COLOR_TAKEN');
  assert.equal(conflict.color, green);
  b.send({ type:'color', color:'invalid' });
  await b.wait(m => m.type === 'error');
  a.send({ type:'start' });
  const started = await a.state(r => r.phase === 'playing');
  const round = started.round;
  assert.equal(started.startsAt - started.serverNow, 3000);
  const hit = (id, triangle = 2) => ({ type:'spray', round, shotId:id, targetId:peer.playerId, anchor:{ triangle, u:.1, v:.45 } });
  a.send(hit('in-countdown'));
  a.send({type:'sync'});
  await a.state(r => r.phase === 'playing' && r.paintSeq === 0);
  game.advance(3000);
  a.send({...hit('first'), color:green, shooterId:peer.playerId});
  const first = await b.wait(m => m.type === 'paint');
  assert.ok(first.score > 0 && first.coverage > 0);
  assert.equal(first.color, blue);
  assert.equal(first.splat.color, blue);
  assert.equal(first.splat.shooterId, owner.playerId);
  a.send(hit('first')); // Exact replays can never score.
  a.send(hit('second'));
  const repeat = await b.wait(m => m.type === 'paint');
  assert.equal(repeat.score, first.score);
  assert.equal(repeat.coverage, first.coverage);
  assert.equal(repeat.hits, 2);
  assert.equal(repeat.splat, undefined);
  assert.equal(repeat.color, blue);
  a.send(hit('over-budget', 152)); // Only two packets may arrive together.
  a.send({type:'sync'});
  await a.state(r => r.paintSeq === 2);
  game.advance(180);
  a.send(hit('head', 152));
  const spread = await b.wait(m => m.type === 'paint');
  assert.ok(spread.score > repeat.score && spread.coverage > repeat.coverage);
  assert.equal(spread.splat.triangle, 152);

  for (let i=0; i<12; i++) {
    game.advance(180);
    a.send(hit('pulse-'+i));
    await b.wait(m => m.type === 'paint' && m.hits === 4+i);
  }

  a.ws.close();
  const saved = await b.state(r => r.hostId === peer.playerId);
  assert.equal(saved.phase,'playing');
  assert.equal(saved.players[1].splats.length,2);
  assert.equal(saved.players[1].health,10);
  assert.equal(saved.leaderboard[0].score,spread.score);
  const resumed = await game.connect({ type:'resume', code:owner.code, token:owner.token });
  assert.equal((await resumed.wait(m => m.type === 'welcome')).playerId,owner.playerId);
  const replay = await resumed.state(r => r.phase === 'playing');
  assert.equal(replay.paintSeq,saved.paintSeq);
  assert.deepEqual(replay.players[1].splats,saved.players[1].splats);
  game.advance(90_001);
  const result = await resumed.state(r => r.phase === 'finished');
  assert.deepEqual(result.leaderboard.map(p => p.rank),[1,2]);
  b.send({type:'rematch'});
  const reset = await resumed.state(r => r.phase === 'lobby');
  assert.ok(reset.players.every(p => !p.splats.length && !p.score && !p.coverage));
  assert.deepEqual(reset.players.map(p => p.color), [blue, green]);
  const intruder = await game.connect({type:'resume', code:owner.code, token:'guess'});
  assert.equal((await intruder.wait(m => m.type === 'error')).code,'INVALID_TOKEN');
});

test(
  'timeout shares ranks, and an empty room expires after disconnect grace',
  { timeout: 5000 },
  async (t) => {
    const game = await arena(t);
    const a = await game.connect({ type: 'create' });
    const { code, token } = await a.wait((m) => m.type === 'welcome');
    const b = await game.connect({ type: 'join', code });
    a.send({ type: 'ready', ready: true });
    b.send({ type: 'ready', ready: true });
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

test('late spectators, unavailable targets and invalid anchors cannot add coverage', { timeout: 5000 }, async t => {
  const game = await arena(t);
  const a = await game.connect({type:'create'});
  const {code,playerId} = await a.wait(m => m.type === 'welcome');
  const b = await game.connect({type:'join',code});
  const peer = await b.wait(m => m.type === 'welcome');
  a.send({type:'start'});
  const {round} = await a.state(r => r.phase === 'playing');
  game.advance(3000);
  const c = await game.connect({type:'join',code});
  const late = await c.wait(m => m.type === 'welcome');
  await a.state(r => r.players.some(p => p.id === late.playerId && p.spectator));
  const base = {type:'spray', round, targetId:peer.playerId, anchor:{triangle:2,u:.1,v:.2}};
  c.send({...base,shotId:'spectator'});
  c.send({type:'sync'});
  await c.state(r => r.paintSeq === 0);

  for (const [i,changed] of [{targetId:playerId},{targetId:late.playerId},{anchor:{triangle:160,u:0,v:0}},
    {anchor:{triangle:0,u:.8,v:.9}},{round:round+1}].entries()) {
    game.advance(180);
    a.send({...base,...changed,shotId:'rejected-'+i});
    a.send({type:'sync'});
    await a.state(r => r.serverNow === 103180 + i*180 && r.paintSeq === 0);
  }

  c.send({type:'leave'});
  await c.wait(m => m.type === 'left');
  assert.equal((await a.state(r => r.players.length === 2 && r.round === round && r.serverNow > 103000)).leaderboard.length,2);
});

test(
  'disconnected players can rejoin within grace then forfeit after grace',
  { timeout: 5000 },
  async (t) => {
    const game = await arena(t);
    const a = await game.connect({ type: 'create' });
    const owner = await a.wait((m) => m.type === 'welcome');
    const b = await game.connect({ type: 'join', code: owner.code });
    const peer = await b.wait((m) => m.type === 'welcome');
    a.send({ type: 'ready', ready: true });
    b.send({ type: 'ready', ready: true });
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
  host.send({ type: 'ready', ready: true });
  teammate.send({ type: 'ready', ready: true });
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

test('a resumed lobby player keeps a chosen color and camera-free start', { timeout: 5000 }, async t => {
  const game = await arena(t);
  const a = await game.connect({type:'create'});
  const {code} = await a.wait(m => m.type === 'welcome');
  const invalid = await game.connect({type:'join',code,color:'chartreuse'});
  await invalid.wait(m => m.type === 'error');
  const b = await game.connect({type:'join',code,color:'#ff59a3'});
  const {token,playerId} = await b.wait(m => m.type === 'welcome');
  b.ws.close();
  await a.state(r => r.players.some(p => p.id === playerId && !p.connected));
  a.send({type:'color',color:'#ff59a3'});
  await a.wait(m => m.code === 'COLOR_TAKEN');
  a.send({type:'start'});
  await a.wait(m => m.type === 'error');
  const back = await game.connect({type:'resume',code,token});
  const room = await back.state(r => r.phase === 'lobby');
  assert.equal(room.players[1].color,'#ff59a3');
  a.send({type:'start'});
  await back.state(r => r.phase === 'playing');
});

test('eight seats reserve distinct colors through competing picks, leaving and reconnect grace', { timeout: 6000 }, async t => {
  const game = await arena(t);
  const host = await game.connect({type:'create'});
  const {code,playerId:hostId} = await host.wait(m => m.type === 'welcome');
  const guest = await game.connect({type:'join',code});
  const {playerId} = await guest.wait(m => m.type === 'welcome');
  const cyan = inkColors.find(c => c.name === 'Cyan').hex;
  host.send({type:'color',color:cyan});
  guest.send({type:'color',color:cyan});
  const claimed = await host.state(r => r.players.some(p => p.color === cyan));
  const loser = claimed.players.find(p => p.color !== cyan);
  const rejected = await (loser.id === playerId ? guest : host).wait(m => m.code === 'COLOR_TAKEN');
  assert.equal(rejected.color,cyan);
  const badJoin = await game.connect({type:'join',code,color:cyan});
  assert.equal((await badJoin.wait(m => m.type === 'error')).code,'COLOR_TAKEN');

  const others = await Promise.all(Array.from({length:6}, () => game.connect({type:'join',code})));
  const full = await host.state(r => r.players.length === 8);
  assert.deepEqual(new Set(full.players.map(p => p.color)),new Set(inkColors.map(c => c.hex)));
  const guestColor = full.players.find(p => p.id === playerId).color;
  const ninth = await game.connect({type:'join',code});
  assert.equal((await ninth.wait(m => m.type === 'error')).code,'ROOM_FULL');
  guest.ws.close();
  await host.state(r => r.players.length === 8 && r.players.some(p => p.id === playerId && !p.connected));
  ninth.send({type:'join',code,color:guestColor});
  await ninth.wait(m => m.code === 'ROOM_FULL');
  game.advance(25_001);
  await host.state(r => r.players.length === 7 && !r.players.some(p => p.id === playerId));
  ninth.send({type:'join',code});
  const replacement = await ninth.wait(m => m.type === 'welcome');
  const filled = await host.state(r => r.players.some(p => p.id === replacement.playerId));
  assert.equal(filled.players.find(p => p.id === replacement.playerId).color,guestColor);
  ninth.send({type:'leave'});
  await ninth.wait(m => m.type === 'left');
  badJoin.send({type:'join',code,color:guestColor});
  const {playerId:returningId} = await badJoin.wait(m => m.type === 'welcome');
  host.send({type:'start'});
  const started = await host.state(r => r.phase === 'playing');
  game.advance(3000);
  const thrown = new Set();

  for (const [i,sender] of [host,...others,badJoin].entries()) {
    sender.send({type:'spray',round:started.round,targetId:i ? hostId : returningId,shotId:'shot-'+i,anchor:{triangle:i*16,u:.1,v:.45}});
    const hit = await host.wait(m => m.type === 'paint');
    assert.equal(hit.color,started.players.find(p => p.id === hit.shooterId).color);
    assert.equal(hit.splat.color,hit.color);
    thrown.add(hit.color);
  }

  assert.equal(thrown.size,8);
});

test('overpainting changes the visible color without scoring already covered skin', { timeout: 5000 }, async t => {
  const game = await arena(t);
  const host = await game.connect({type:'create',color:'#319cff'});
  const {code} = await host.wait(m => m.type === 'welcome');
  const green = await game.connect({type:'join',code,color:'#49e066'});
  const target = await game.connect({type:'join',code,color:'#a369ff'});
  const {playerId,token} = await target.wait(m => m.type === 'welcome');
  host.send({type:'start'});
  const {round} = await host.state(r => r.phase === 'playing');
  game.advance(3000);
  const pulse = {type:'spray',round,targetId:playerId,anchor:{triangle:2,u:.1,v:.45}};
  green.send({...pulse,shotId:'green'});
  const first = await target.wait(m => m.type === 'paint');
  assert.equal(first.splat.color,'#49e066');
  assert.ok(first.score > 0);
  host.send({...pulse,shotId:'blue',color:'#a369ff'});
  const overpaint = await target.wait(m => m.type === 'paint');
  assert.equal(overpaint.color,'#319cff');
  assert.equal(overpaint.splat.color,'#319cff');
  assert.equal(overpaint.score,0);
  assert.equal(overpaint.coverage,first.coverage);
  host.send({...pulse,shotId:'repeat-blue'});
  const repeat = await target.wait(m => m.type === 'paint');
  assert.equal(repeat.splat,undefined);
  assert.equal(repeat.color,'#319cff');
  assert.equal(repeat.score,0);
  const observer = await game.connect({type:'join',code});
  const watched = await observer.state(r => r.players.some(p => p.spectator));
  const marks = watched.players.find(p => p.id === playerId).splats;
  assert.deepEqual(marks.map(s => s.color),['#49e066','#319cff']);
  target.ws.close();
  await host.state(r => r.players.some(p => p.id === playerId && !p.connected));
  const resumed = await game.connect({type:'resume',code,token});
  const back = await resumed.state(r => r.phase === 'playing');
  assert.deepEqual(back.players.find(p => p.id === playerId).splats,marks);
});
