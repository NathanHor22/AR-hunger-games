import { createPoseTracks } from './pose-tracks.js';

async function createInference() {
  let surface, context;

  function modelInput(video) {
    const w = video.videoWidth, h = video.videoHeight;
    const scale = Math.min(1, 320 / Math.min(w,h), 640 / Math.max(w,h));

    if (scale === 1) return video;
    const width = Math.max(1, Math.round(w * scale)), height = Math.max(1, Math.round(h * scale));

    if (!surface) {
      surface = globalThis.OffscreenCanvas ? new OffscreenCanvas(width,height) : document.createElement('canvas');
      context = surface.getContext('2d', { alpha:false });
    }

    if (!context) return video;

    if (surface.width !== width) surface.width = width;

    if (surface.height !== height) surface.height = height;
    context.drawImage(video, 0,0,width,height);

    return surface;
  }

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
        async detect(video) {
          const input = modelInput(video);
          const frame = input.transferToImageBitmap ? input.transferToImageBitmap() : await createImageBitmap(input);

          try {
            if (closed) throw new Error('Tracking stopped');

            return await request({ frame }, [frame]);
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

  const detector = await openDetector();

  return { detect:video => detector.detect(modelInput(video)), close:detector.close };
}

export function createTracker(video, { onFrame = () => {}, onStatus = () => {} } = {}) {
  const tracks = createPoseTracks();
  let generation = 0, stream = null, inference = null, opening = null;
  let timer, latest;

  function stop() {
    generation++;
    clearTimeout(timer);
    opening = null;
    tracks.clear();
    latest = null;

    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = null;
    video.srcObject = null;
    inference?.close();
    inference = null;
    onFrame([]);
  }

  function tickFrames(token) {
    let previousTime = -1;

    async function tick() {
      if (token !== generation) return;
      const capturedAt = performance.now();

      try {
        if (video.readyState >= 2 && video.currentTime !== previousTime) {
          previousTime = video.currentTime;
          const width = video.videoWidth, height = video.videoHeight;
          const result = await inference.detect(video);

          if (token !== generation) return;
          const people = tracks.update(result.people, capturedAt, width, height, performance.now());
          latest = { people, capturedAt };
          onFrame(people, capturedAt);
        }
      } catch (error) {
        if (token === generation) {
          stop();
          onStatus('Tracking stopped. Reopen the camera to retry. ' + error.message);
        }

        return;
      }

      if (token === generation) timer = setTimeout(tick, Math.max(12, 85 - (performance.now() - capturedAt)));
    }

    void tick();
  }

  async function open(token) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access needs HTTPS or localhost.');

    const acquired = await navigator.mediaDevices.getUserMedia({
      audio: false, video: { facingMode:{ ideal:'environment' }, width:{ ideal:640 }, height:{ ideal:480 } },
    });

    if (token !== generation) {
      acquired.getTracks().forEach(track => track.stop());

      return false;
    }

    stream = acquired;

    for (const track of stream.getVideoTracks()) {
      track.onended = () => {
        if (token !== generation) return;
        stop();
        onStatus('Tracking stopped. Your camera disconnected. Reopen the camera to retry.');
      };
    }

    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();

    if (token !== generation) return false;
    const opened = await createInference();

    if (token !== generation) {
      opened.close();

      return false;
    }

    inference = opened;
    tickFrames(token);

    return true;
  }

  return {
    start() {
      if (inference && stream?.active) return Promise.resolve(true);

      if (opening) return opening;
      const token = ++generation;
      opening = open(token).catch(error => {
        if (token !== generation) return false;
        stop();
        throw error;
      }).finally(() => {
        if (token === generation) opening = null;
      });

      return opening;
    },
    stop,
    setRoster:tracks.setRoster,
    assign(trackId, playerId) {
      if (!latest || !tracks.assign(trackId, playerId, performance.now())) return false;
      latest.people = latest.people.map(person => {
        if (person.trackId === trackId) return { ...person, id:playerId };

        return person.id === playerId ? { ...person, id:null } : person;
      });
      onFrame(latest.people, latest.capturedAt);

      return true;
    },
    clearAssignments() {
      tracks.clear();
      latest = null;
      onFrame([]);
    },
  };
}
