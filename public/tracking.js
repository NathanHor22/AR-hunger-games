import { createPoseTracks } from './pose-tracks.js';

function modelInput(video, surface, freeze = false) {
  const w = video.videoWidth, h = video.videoHeight;
  const scale = Math.min(1, 320 / Math.min(w,h), 640 / Math.max(w,h));

  if (scale === 1 && !freeze) return video;
  const width = Math.max(1, Math.round(w * scale)), height = Math.max(1, Math.round(h * scale));
  surface ??= globalThis.OffscreenCanvas ? new OffscreenCanvas(width,height) : document.createElement('canvas');
  const context = surface.getContext('2d', { alpha:false });

  if (!context) return freeze ? null : video;

  if (surface.width !== width) surface.width = width;

  if (surface.height !== height) surface.height = height;
  context.drawImage(video, 0,0,width,height);

  return surface;
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
        async detect(input) {
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

  return openDetector();
}

export function createTracker(video, { onFrame = () => {}, onStatus = () => {} } = {}) {
  const tracks = createPoseTracks();
  let generation = 0, stream = null, inference = null, opening = null;
  let timer, latest, pendingTap, assignments = 0;

  function stop() {
    generation++;
    clearTimeout(timer);
    opening = null;
    tracks.clear();
    latest = null;
    pendingTap = null;

    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = null;
    video.srcObject = null;
    inference?.close();
    inference = null;
    onFrame([]);
  }

  function tickFrames(token) {
    let previousTime = -1, surface;

    async function tick() {
      if (token !== generation) return;
      const tap = pendingTap;
      pendingTap = null;
      const capturedAt = tap?.at ?? performance.now();
      const mediaTime = tap?.mediaTime ?? video.currentTime;
      const revision = assignments;

      try {
        if (tap || (video.readyState >= 2 && mediaTime !== previousTime)) {
          const repeated = previousTime === mediaTime;
          previousTime = mediaTime;
          const width = tap?.width ?? video.videoWidth, height = tap?.height ?? video.videoHeight;
          const input = tap?.image ?? modelInput(video,surface);

          if (!tap && input !== video) surface = input;
          const result = await inference.detect(input);

          if (token !== generation) return;

          if (revision === assignments) {
            const people = tracks.update(result.people, capturedAt, width, height, performance.now(), !!tap, repeated);
            latest = { people, capturedAt };
            onFrame(people, capturedAt, tap?.token);
          }
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
    captureTap() {
      if (!stream?.active || video.srcObject !== stream || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return null;
      const at = performance.now(), mediaTime = video.currentTime;

      try {
        const image = modelInput(video,pendingTap?.image,true);

        if (!image) return null;
        pendingTap = { image, at, mediaTime, width:video.videoWidth, height:video.videoHeight, token:{} };

        return pendingTap.token;
      } catch {
        // A camera can end between checking readyState and sampling its pixels.
        return null;
      }
    },
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
      pendingTap = null;
      assignments++;
      onFrame([]);
    },
  };
}
