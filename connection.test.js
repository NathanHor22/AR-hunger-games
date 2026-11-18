import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import test from 'node:test';
import { createConnection } from './connection.js';
import { createGameServer } from './server.js';

const welcome = { type: 'welcome', code: '123456', playerId: 'p1', token: 'tab-token' };
const resume = { type: 'resume', code: welcome.code, token: welcome.token };

function tab(t, options = {}, values = new Map()) {
  const browser = Object.assign(new EventTarget(), {
    location: new URL('https://game.example:8443/?room=123456'),
    navigator: { onLine: true },
    sessionStorage: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: key => values.delete(key),
    },
    WebSocket, setTimeout, clearTimeout,
    ...options,
  });

  const events = new EventEmitter();
  const previous = globalThis.window;
  globalThis.window = browser;
  let connection;

  try {
    connection = createConnection({
      onWelcome: message => events.emit('welcome', message),
      onState: room => events.emit('state', room),
      onStatus: message => events.emit('status', message),
      onReset: message => events.emit('reset', message),
    });
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }

  t.after(() => connection.leave());

  return { browser, events, connection, values };
}

function simulatedTab(t, options) {
  const sockets = [];
  const timers = new Map();
  let nextTimer = 0;

  class TestSocket {
    static OPEN = 1;
    readyState = 0;
    sent = [];
    constructor(url) {
      this.url = url;
      sockets.push(this);
    }
    open() {
      this.readyState = 1;
      this.onopen();
    }
    send(data) {
      this.sent.push(JSON.parse(data));
    }
    receive(message) {
      this.onmessage({ data: JSON.stringify(message) });
    }
    close() {
      this.readyState = 3;
    }
  }

  const client = tab(t, {
    WebSocket: TestSocket,
    setTimeout(fn, delay) {
      timers.set(++nextTimer, { fn, delay });

      return nextTimer;
    },
    clearTimeout(id) { timers.delete(id); },
    ...options,
  });

  function tick() {
    assert.equal(timers.size, 1);
    const [[id, timer]] = timers;
    timers.delete(id);
    timer.fn();

    return timer.delay;
  }

  return { ...client, sockets, timers, tick };
}

test('welcome survives a drop before state, including overlapping close and offline events', t => {
  const { browser, connection, events, sockets, values, timers, tick } = simulatedTab(t);
  const states = [];
  events.on('state', room => states.push(room));
  connection.enter({ type: 'create', name: 'Ada' });
  const [first] = sockets;
  assert.equal(first.url, 'wss://game.example:8443/ws');
  first.open();
  assert.deepEqual(first.sent, [{ type: 'create', name: 'Ada' }]);
  assert.equal(connection.send({ type: 'ready', ready: true }), false);
  first.receive(welcome);
  assert.deepEqual(JSON.parse([...values.values()][0]), welcome);
  assert.equal(connection.connected, true);
  first.onerror();
  first.onclose({ code: 1006 });
  first.receive({ type: 'state', room: { code: welcome.code } });
  assert.deepEqual(states, []);
  assert.equal(connection.connected, false);
  assert.equal(connection.send({ type: 'throw' }), false);
  assert.equal(timers.size, 1);
  browser.navigator.onLine = false;
  browser.dispatchEvent(new Event('offline'));
  assert.equal(timers.size, 0);
  browser.navigator.onLine = true;
  browser.dispatchEvent(new Event('online'));
  browser.dispatchEvent(new Event('online'));
  assert.equal(sockets.length, 2);
  const second = sockets[1];
  second.open();
  assert.deepEqual(second.sent, [resume]);
  second.receive(welcome);
  // An open socket can also stall after welcome without delivering a close.
  tick();
  assert.equal(connection.connected, false);
  tick();
  const third = sockets[2];
  third.open();
  third.receive(welcome);
  first.onclose({ code: 4001 });
  const room = { code: welcome.code, players: [{ id: welcome.playerId }] };
  third.receive({ type: 'state', room });
  assert.deepEqual(states, [room]);
  assert.equal(timers.size, 0);
  assert.equal(connection.send({ type: 'ready', ready: true }), true);
  connection.leave();
  connection.leave();
  assert.deepEqual(third.sent, [resume, { type: 'ready', ready: true }, { type: 'leave' }]);
  assert.equal(values.size, 0);
  assert.equal(connection.connected, false);
  third.onclose({ code: 1000 });
  browser.dispatchEvent(new Event('online'));
  assert.equal(timers.size, 0);
  assert.equal(sockets.length, 3);
});

test('retry delay is capped, and supersession clears credentials and cancels reconnects', t => {
  const { connection, events, sockets, timers, tick } = simulatedTab(t);
  const resets = [];
  events.on('reset', message => resets.push(message));
  connection.enter({ type: 'join', code: welcome.code });
  sockets[0].open();
  sockets[0].receive(welcome);

  for (const delay of [250, 500, 1000, 2000, 4000, 4000, 4000]) {
    sockets.at(-1).onclose({ code: 1006 });
    assert.equal(tick(), delay);
    sockets.at(-1).open();
    assert.deepEqual(sockets.at(-1).sent, [resume]);
  }

  sockets.at(-1).onclose({ code: 4001 });
  assert.equal(resets.length, 1);
  assert.match(resets[0], /another tab/);
  assert.equal(timers.size, 0);
  assert.equal(connection.restore(), false);
});

test('restore respects the invite, and terminal errors allow a fresh join', t => {
  const original = simulatedTab(t);
  original.connection.enter({ type: 'create' });
  original.sockets[0].open();
  original.sockets[0].receive(welcome);
  const reload = simulatedTab(t, { sessionStorage: original.browser.sessionStorage });
  const { connection, sockets, events } = reload;
  const resets = [];
  events.on('reset', message => resets.push(message));
  assert.equal(connection.restore('654321'), false);
  assert.equal(connection.restore(''), false);
  assert.equal(sockets.length, 0);
  assert.equal(connection.restore(welcome.code), true);
  sockets[0].open();
  assert.deepEqual(sockets[0].sent, [resume]);
  sockets[0].receive({ type: 'error', code: 'INVALID_TOKEN', message: 'Expired token' });
  assert.equal(connection.restore(), false);

  for (const code of ['ROOM_FULL', 'ROOM_NOT_FOUND']) {
    connection.enter({ type: 'join', code: '654321', name: 'Grace' });
    const current = sockets.at(-1);
    current.open();
    assert.deepEqual(current.sent, [{ type: 'join', code: '654321', name: 'Grace' }]);
    current.receive({ type: 'error', code, message: code });
  }

  connection.enter({ type: 'create' });
  const pending = sockets.at(-1);
  pending.open();
  pending.onclose({ code: 1006 });
  assert.deepEqual(resets.slice(0, 3), ['Expired token', 'ROOM_FULL', 'ROOM_NOT_FOUND']);
  assert.equal(resets.length, 4);
  assert.equal(reload.timers.size, 0);
});

test('real server preserves identity on a dropped TCP connection and releases a seat on leave',
  { timeout: 8000 }, async t => {
    const server = createGameServer();
    const transports = [];
    server.on('upgrade', (_request, socket) => transports.push(socket));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const location = new URL('http://127.0.0.1:' + server.address().port);
    const host = tab(t, { location });
    const peer = tab(t, { location });
    t.after(async () => {
      for (const socket of transports) socket.destroy();
      await new Promise(resolve => server.close(resolve));
    });
    const created = once(host.events, 'state');
    host.connection.enter({ type: 'create' });
    const [{ code }] = await created;
    const joined = once(peer.events, 'state');
    const welcomed = once(peer.events, 'welcome');
    peer.connection.enter({ type: 'join', code, name: 'Peer' });
    const [identity] = await welcomed;
    const [room] = await joined;
    assert.equal(room.players.length, 2);
    assert.deepEqual(JSON.parse([...peer.values.values()][0]), identity);
    assert.notEqual([...host.values.values()][0], [...peer.values.values()][0]);
    const dropped = once(peer.events, 'status');
    const resumed = once(peer.events, 'welcome');
    const refreshed = once(peer.events, 'state');
    transports[1].destroy();
    await dropped;
    assert.equal(peer.connection.send({ type: 'ready', ready: true }), false);
    assert.deepEqual((await resumed)[0], identity);
    assert.deepEqual((await refreshed)[0].players.map(p => p.id), room.players.map(p => p.id));
    const rejected = once(peer.events, 'status');
    assert.equal(peer.connection.send({ type: 'start' }), true);
    assert.match((await rejected)[0], /start/i);
    assert.equal(peer.connection.connected, true);
    // A duplicated browser tab inherits a copy of sessionStorage.
    const takeover = tab(t, { location }, new Map(peer.values));
    const superseded = once(peer.events, 'reset');
    const recovered = once(takeover.events, 'welcome');
    assert.equal(takeover.connection.restore(code), true);
    assert.match((await superseded)[0], /another tab/);
    assert.deepEqual((await recovered)[0], identity);
    assert.equal(peer.values.size, 0);
    assert.equal(peer.connection.restore(), false);

    const left = new Promise(resolve => host.events.on('state', state => {
      if (state.players.length === 1) resolve(state);
    }));

    takeover.connection.leave();
    assert.equal(takeover.values.size, 0);
    assert.equal((await left).players[0].id, room.hostId);
  });
