import { inkStandings } from './public/ink.js';

const sessionKey = 'tomato-riot.welcome';
const firstRetryMs = 250;
const maxRetryMs = 4000;
const firstStateTimeoutMs = 8000;

function validWelcome(message) {
  return message?.type === 'welcome'
    && [message.code, message.playerId, message.token].every(
      value => Object.prototype.toString.call(value) === '[object String]' && value.length > 0,
    )
    && /^\d{6}$/.test(message.code);
}

export function createConnection({ onState, onWelcome, onStatus, onReset, onPaint }) {
  const browser = window;
  let saved = null;
  let handshake = null;
  let socket = null;
  let welcomed = false;
  let timer;
  let retryMs = firstRetryMs;
  let lastRoom, waitingForSync = false;

  try {
    const stored = JSON.parse(browser.sessionStorage.getItem(sessionKey));

    if (validWelcome(stored)) saved = stored;
  } catch {
    // Storage can be unavailable in a privacy-restricted tab.
  }

  function save(welcome) {
    saved = welcome;

    try {
      if (welcome) browser.sessionStorage.setItem(sessionKey, JSON.stringify(welcome));
      else browser.sessionStorage.removeItem(sessionKey);
    } catch {
      // The in-memory credential still supports reconnects in this document.
    }
  }

  function stopSocket() {
    browser.clearTimeout(timer);
    timer = undefined;
    const previous = socket;
    socket = null;
    welcomed = false;
    lastRoom = null;
    waitingForSync = false;
    previous?.close();
  }

  function stop() {
    stopSocket();
    handshake = null;
    browser.removeEventListener('online', online);
    browser.removeEventListener('offline', offline);
    save(null);
  }

  function reset(message) {
    stop();
    onReset(message);
  }

  function disconnected() {
    stopSocket();

    // Replaying create/join after a lost welcome could allocate a second seat.
    if (handshake.type !== 'resume') {
      reset('Could not join the room. Check your connection and try again.');

      return;
    }

    if (browser.navigator.onLine === false) {
      onStatus('Offline. The room will reconnect when you are back online.');

      return;
    }

    timer = browser.setTimeout(connect, retryMs);
    retryMs = Math.min(maxRetryMs, retryMs * 2);
    onStatus('Connection lost. Reconnecting to the room…');
  }

  function online() {
    if (!socket && handshake) connect();
  }

  function offline() {
    if (socket || timer !== undefined) disconnected();
  }

  function write(message) {
    if (socket?.readyState !== browser.WebSocket.OPEN) return false;
    let data;

    try {
      data = JSON.stringify(message);
    } catch {
      return false;
    }

    if (data === undefined) return false;

    try {
      socket.send(data);

      return true;
    } catch {
      disconnected();

      return false;
    }
  }

  function connect() {
    if (socket || !handshake) return;
    browser.clearTimeout(timer);

    if (browser.navigator.onLine === false) {
      disconnected();

      return;
    }

    const protocol = browser.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let ws;

    try {
      ws = new browser.WebSocket(protocol + '//' + browser.location.host + '/ws');
    } catch {
      disconnected();

      return;
    }

    socket = ws;
    timer = browser.setTimeout(() => {
      if (socket === ws) disconnected();
    }, firstStateTimeoutMs);
    ws.onopen = () => {
      if (socket === ws) write(handshake);
    };

    ws.onerror = () => {
      if (socket === ws) disconnected();
    };

    ws.onclose = event => {
      if (socket !== ws) return;

      if (event.code === 4001) reset('Your session was resumed in another tab.');
      else disconnected();
    };

    ws.onmessage = event => {
      if (socket !== ws) return;
      let message;

      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }

      if (message?.type === 'welcome' && !welcomed) {
        if (!validWelcome(message) || (handshake.code && message.code !== handshake.code)) {
          reset('The room returned an invalid welcome. Try joining again.');

          return;
        }

        save(message);
        handshake = { type: 'resume', code: message.code, token: message.token };
        welcomed = true;
        onWelcome(message);
      } else if (message?.type === 'state' && welcomed && message.room?.code === handshake.code) {
        browser.clearTimeout(timer);
        timer = undefined;
        retryMs = firstRetryMs;
        lastRoom = message.room;
        waitingForSync = false;
        onState(lastRoom);
      } else if (message?.type === 'paint' && welcomed && lastRoom?.phase === 'playing'
        && lastRoom.code === message.code && lastRoom.round === message.round && message.seq > lastRoom.paintSeq) {
        if (waitingForSync) return;

        if (message.seq !== lastRoom.paintSeq + 1) {
          waitingForSync = write({ type: 'sync' });

          return;
        }

        const players = lastRoom.players.map(p => {
          if (p.id === message.shooterId) return { ...p, score: message.score, hits: message.hits };

          if (p.id === message.targetId) return { ...p, coverage: message.coverage,
            splats: message.splat ? [...p.splats, message.splat] : p.splats };

          return p;
        });

        lastRoom = { ...lastRoom, players, paintSeq: message.seq, serverNow: message.serverNow, leaderboard: inkStandings(players) };
        onState(lastRoom);
        onPaint?.(message);
      } else if (message?.type === 'error') {
        if (!welcomed || message.code === 'ROOM_NOT_FOUND' || message.code === 'INVALID_TOKEN') {
          reset(message.message);
        } else {
          onStatus(message.message);
        }
      } else if (message?.type === 'left') {
        reset('You left the room.');
      }
    };
  }

  function begin(request) {
    stopSocket();
    handshake = request;
    retryMs = firstRetryMs;
    browser.addEventListener('online', online);
    browser.addEventListener('offline', offline);
    connect();
  }

  function restore(expectedRoomCode) {
    if (!saved || (expectedRoomCode != null && String(expectedRoomCode).trim() !== saved.code)) return false;
    begin({ type: 'resume', code: saved.code, token: saved.token });

    return true;
  }

  return {
    get connected() {
      return welcomed && socket?.readyState === browser.WebSocket.OPEN;
    },
    enter({ type, code, name, color }) {
      const roomCode = String(code ?? '').trim();

      if (type === 'join' && roomCode && restore(roomCode)) return;
      save(null);
      begin(type === 'join' ? { type, code: roomCode, name, color } : { type, name, color });
    },
    restore,
    send(message) {
      return welcomed && write(message);
    },
    leave() {
      // WebSocket.close flushes already queued frames before the closing handshake.
      if (socket?.readyState === browser.WebSocket.OPEN) write({ type: 'leave' });
      stop();
    },
  };
}
