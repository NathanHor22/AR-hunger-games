// Color thresholds are prototype values. The ambiguity checks intentionally leave similar shirts untargetable.
export function appearanceDistance(a, b) {
  if (a?.length !== 12 || b?.length !== 12) return Infinity;

  return Math.sqrt(a.reduce((sum, v, i) => sum + (v - b[i]) ** 2, 0) / a.length);
}

function torso(person) {
  const landmarks = person.landmarks;
  const a = landmarks[11], b = landmarks[12];

  return {
    x: (a.x + b.x) / 2, y: (a.y + b.y) / 2,
    width: Math.max(Math.abs(a.x - b.x), 0.035),
    height: Math.max(0.08, (landmarks[23].y + landmarks[24].y - a.y - b.y) / 2),
  };
}

function crossing(a, b) {
  return Math.abs(a.x - b.x) < (a.width + b.width) * 0.55
    && a.y + a.height > b.y && b.y + b.height > a.y;
}

export function createMatcher() {
  let previous = new Map();

  return (people, players, myId, now) => {
    const boxes = people.map(torso);

    const candidates = people.map(p => players.filter(player => player.descriptor?.length === 12)
      .map(player => ({ id: player.id, d: appearanceDistance(p.descriptor, player.descriptor) }))
      .sort((a, b) => a.d - b.d));

    const next = new Map();

    const matched = people.map((person, index) => {
      const [best, second] = candidates[index];
      let id = null;
      const box = boxes[index];

      if (best && best.id !== myId && best.d < 0.085
        && (!second || second.d - best.d > 0.035)
        && !boxes.some((b, i) => i !== index && crossing(b, box))
        && !candidates.some((row, i) => i !== index && row.some(c => c.id === best.id && c.d < best.d + 0.035))) {
        const last = previous.get(best.id);

        const continuous = last && now - last.now < 550
          && Math.hypot(box.x - last.x, box.y - last.y) < Math.max(0.10, box.width * 1.6);

        const seen = continuous ? last.seen + 1 : 1;
        next.set(best.id, { ...box, seen, now });

        if (seen >= 3) id = best.id;
      }

      return { ...person, id };
    });

    previous = next;

    return matched;
  };
}

function stableSample(samples, descriptor) {
  if (!descriptor || (samples.length && appearanceDistance(samples[0], descriptor) > 0.06)) samples.length = 0;

  if (!descriptor) return null;
  samples.push(descriptor);

  if (samples.length < 3) return null;

  return descriptor.map((_, i) => samples.reduce((sum, sample) => sum + sample[i], 0) / samples.length);
}

export function createLobbyEnrollment() {
  let history = [], pending = null, uncertainUntil = -Infinity;

  return {
    observe(id, send, now) {
      // Joins that overlap cannot be matched to their order of arrival.
      if (pending && now - pending.now < 3500 || now < uncertainUntil) {
        pending = null;
        uncertainUntil = now + 3500;

        return;
      }

      pending = { id, send, now, before: history.filter(item => now - item.now < 5000), samples: [] };
    },
    update(people, roster, now) {
      const visible = people.map(p => p.descriptor).filter(Boolean);

      if (pending && (now - pending.now > 3500 || roster.find(p => p.id === pending.id)?.descriptor)) pending = null;

      if (pending) {
        const known = [...pending.before.map(item => item.signature), ...roster.map(p => p.descriptor).filter(Boolean)];
        const fresh = visible.filter(signature => !known.some(other => appearanceDistance(signature, other) < 0.12));
        const signature = stableSample(pending.samples, fresh.length === 1 && visible.length === people.length ? fresh[0] : null);

        if (signature) {
          const done = pending;
          pending = null;
          done.send(signature);
        }
      }

      history = history.filter(item => now - item.now < 5000);

      for (const signature of visible) {
        const existing = history.find(item => appearanceDistance(item.signature, signature) < 0.06);

        if (existing) existing.now = now;
        else history.push({ signature, now });
      }
    },
  };
}

async function createInference() {
  if (globalThis.Worker && globalThis.OffscreenCanvas && globalThis.createImageBitmap) {
    let worker;
    let rejectPending;
    let closed = false;

    try {
      worker = new Worker('/assets/pose-worker.js', { type: 'module' });

      const request = (message, transfer = []) => new Promise((resolve, reject) => {
        rejectPending = reject;
        worker.onmessage = ({ data }) => data.error ? reject(new Error(data.error)) : resolve(data);
        worker.onerror = event => reject(new Error(event.message || 'Camera tracking worker failed'));
        worker.postMessage(message, transfer);
      });

      await request({ type: 'init' });

      return {
        async detect(video, withMasks) {
          const frame = await createImageBitmap(video);

          try {
            if (closed) throw new Error('Tracking stopped');

            return await request({ frame, withMasks }, [frame]);
          } finally {
            frame.close();
          }
        },
        close() {
          closed = true;
          worker.terminate();
          rejectPending?.(new Error('Tracking stopped'));
        },
      };
    } catch {
      worker?.terminate();
    }
  }

  const { openDetector } = await import('./pose-worker.js');

  return openDetector();
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function createTracker(video, { onFrame = () => {}, onStatus = () => {} } = {}) {
  let generation = 0, phase = 'off', stream = null, inference = null, facing = null;
  let playing = false, host = false, onSelf = () => {};
  let roster = [], myId = null, match = createMatcher(), lobby = createLobbyEnrollment();
  let timer = null, pending = Promise.resolve(), lastVideoTime = -1, next = Promise.resolve();

  const serialize = action => {
    next = next.catch(() => {}).then(action);

    return next;
  };

  function releaseCamera() {
    clearTimeout(timer);

    for (const track of stream?.getTracks() || []) track.stop();
    stream = null;
    facing = null;
    match = createMatcher();
    video.srcObject = null;
    onFrame([]);
  }

  async function camera(side, token) {
    if (facing === side && stream?.active) return;
    releaseCamera();

    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access needs HTTPS or localhost.');

    const acquired = await navigator.mediaDevices.getUserMedia({
      audio: false, video: { facingMode: { ideal: side }, width: { ideal: 640 }, height: { ideal: 480 } },
    });

    if (token !== generation) {
      acquired.getTracks().forEach(track => track.stop());

      return;
    }

    // Some single-camera devices satisfy an ideal constraint with the opposite camera.
    const actual = acquired.getVideoTracks()[0]?.getSettings().facingMode;

    if (side === 'user' && actual === 'environment') {
      acquired.getTracks().forEach(track => track.stop());
      throw new Error('Front camera unavailable.');
    }

    stream = acquired;

    for (const track of stream.getVideoTracks()) {
      track.onended = () => {
        if (stream !== acquired || token !== generation) return;
        phase = 'off';
        releaseCamera();
        onStatus('Tracking stopped. Your camera disconnected. Reopen the camera to retry.');
      };
    }

    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    facing = side;
    lastVideoTime = -1;
  }

  async function frame(token, withMasks) {
    if (token !== generation || video.readyState < 2 || video.currentTime === lastVideoTime) return null;
    lastVideoTime = video.currentTime;

    const capturedAt = performance.now();
    const result = await inference.detect(video, withMasks);

    return { ...result, capturedAt };
  }

  async function selfSample(token) {
    await camera('user', token);
    let until = performance.now() + 4500;
    let warmed = false;
    const samples = [];

    while (token === generation && performance.now() < until) {
      const people = (await frame(token, false))?.people;

      if (people && token === generation) {
        // First inference may include model warmup on slower phones.
        if (!warmed) {
          warmed = true;
          until = performance.now() + 2600;
        }

        const only = people.length === 1 ? people[0] : null;
        const box = only && torso(only);

        const signature = stableSample(samples,
          box && Math.abs(box.x - 0.5) < 0.3 && box.width >= 0.14 ? only.descriptor : null);

        if (signature) {
          onSelf(signature);

          return true;
        }
      }

      await sleep(55);
    }

    return false;
  }

  function loop(token) {
    clearTimeout(timer);
    const mode = phase;

    const tick = async () => {
      if (token !== generation || phase !== mode) return;
      const start = performance.now();

      try {
        const result = await frame(token, mode === 'game');

        if (token !== generation || phase !== mode) return;

        if (result) {
          const { people, capturedAt, probe } = result;

          if (mode === 'lobby') lobby.update(people, roster, capturedAt);
          else onFrame(match(people, roster, myId, capturedAt), capturedAt, probe);
        }
      } catch (error) {
        if (token === generation && phase === mode) {
          releaseCamera();
          onStatus('Tracking stopped. Reopen the camera to retry. ' + error.message);
        }

        return;
      }

      if (phase === mode && token === generation) {
        timer = setTimeout(() => { pending = tick(); }, Math.max(12, 85 - (performance.now() - start)));
      }
    };

    pending = tick();
  }

  async function resume(token) {
    if (token !== generation) return;
    const side = host && !playing ? 'user' : 'environment';
    await camera(side, token);

    if (token !== generation) return;
    phase = host && !playing ? 'lobby' : 'game';
    loop(token);
  }

  async function sampleAndResume(token) {
    phase = 'self';
    clearTimeout(timer);
    await pending;

    if (token !== generation) return false;
    let success = false;

    try {
      success = await selfSample(token);
    } catch (error) {
      if (error.name === 'NotAllowedError' || error.name === 'SecurityError') throw error;

      if (token === generation) onStatus('Could not sample shirt color from the front camera.');
    }

    await resume(token);

    return success;
  }

  function changeMode(inRound, isHost = host) {
    playing = inRound;
    host = isHost;
    const token = generation;

    return serialize(async () => {
      if (token !== generation || !inference) return;
      const targetPhase = host && !playing ? 'lobby' : 'game';

      if (phase === targetPhase && stream?.active) return;
      phase = 'switch';
      clearTimeout(timer);
      await pending;
      await resume(token);
    });
  }

  return {
    start(settings = {}) {
      const token = ++generation;
      host = !!settings.host;
      playing = false;

      return serialize(async () => {
        if (token !== generation) return false;
        onSelf = settings.onSelfSignature || (() => {});
        phase = 'opening';
        clearTimeout(timer);
        await pending;

        // Request permission from the initial action, before fetching the vision model.
        try { await camera(settings.registered && !host ? 'environment' : 'user', token); }
        catch (error) { if (!['NotFoundError','OverconstrainedError'].includes(error.name) && error.message !== 'Front camera unavailable.') throw error; }

        if (token !== generation) return false;

        if (!inference) {
          const opened = await createInference();

          if (token !== generation) {
            opened.close();

            return false;
          }

          inference = opened;
        }

        if (settings.registered) {
          await resume(token);

          return true;
        }

        return sampleAndResume(token);
      }).catch(error => { if (token === generation) releaseCamera(); throw error; });
    },
    play() { return changeMode(true); },
    lobby(isHost) { return changeMode(false, isHost); },
    retrySelf() {
      const token = generation;

      return serialize(() => token === generation && inference ? sampleAndResume(token) : false);
    },
    setRoster(players, ownId) { roster = players; myId = ownId; },
    observeJoin(id, onSignature) {
      if (host && phase === 'lobby') lobby.observe(id, onSignature, performance.now());
    },
    stop() {
      generation++;
      phase = 'off';
      releaseCamera();
      inference?.close();
      inference = null;
      match = createMatcher();
      lobby = createLobbyEnrollment();
    },
  };
}
