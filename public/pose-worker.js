import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

// Four bands of upper-chest fabric; collect neither face pixels nor an image descriptor of the room.
export function chestColors(landmarks, pixels, width, height) {
  const left = landmarks[11], right = landmarks[12];

  if (!left || !right || Math.min(left.visibility, right.visibility) < 0.65) return null;
  const dx = (right.x - left.x) * width, dy = (right.y - left.y) * height;
  const span = Math.hypot(dx, dy);

  if (span < 6 || Math.abs(dx) < span * 0.45) return null;
  const x = (left.x + right.x) * width / 2, y = (left.y + right.y) * height / 2;
  const down = Math.sign(dx);
  const colors = [];

  for (const depth of [0.14, 0.24, 0.34, 0.44]) {
    const sums = [0, 0, 0];

    for (const across of [-0.24, -0.12, 0, 0.12, 0.24]) {
      const u = Math.floor(x + dx * across - down * dy * depth);
      const v = Math.floor(y + dy * across + down * dx * depth);

      if (u < 0 || u >= width || v < 0 || v >= height) return null;
      const i = (v * width + u) * 4;

      for (let c = 0; c < 3; c++) sums[c] += pixels[i + c] / 5;
    }

    const [r, g, b] = sums;
    const scale = 2 * (Math.max(r, g, b) + 48);
    colors.push(0.5 + (r - g) / scale, 0.5 + (b - g) / scale, (r + 2 * g + b) / 1020);
  }

  return colors.map(value => Math.round(value * 255) / 255);
}

function copyMask(mask) {
  if (!mask) return null;
  const width = Math.min(mask.width, 160);
  const height = Math.max(1, Math.round(mask.height * width / mask.width));
  const source = mask.getAsFloat32Array();
  const data = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    const line = Math.floor(y * mask.height / height) * mask.width;

    for (let x = 0; x < width; x++) data[y * width + x] = source[line + Math.floor(x * mask.width / width)];
  }

  return { width, height, data };
}

export async function openDetector() {
  const vision = await FilesetResolver.forVisionTasks('/vision-wasm', !globalThis.document);

  const makeCanvas = () => typeof document !== 'undefined'
    ? document.createElement('canvas') : new OffscreenCanvas(1, 1);

  // Some mobile and desktop GPU drivers return an empty mask for a correctly detected body.
  const model = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: '/pose.task', delegate: 'CPU' },
    canvas: makeCanvas(),
    // The front and rear feeds have unrelated bodies. Carrying pose regions across frames
    // can duplicate a person after a lens switch or fast pan. Identity continuity lives in the matcher.
    runningMode: 'IMAGE', numPoses: 8, outputSegmentationMasks: true,
  });

  const probeCanvas = makeCanvas();
  probeCanvas.width = 40;
  probeCanvas.height = 32;
  const probeContext = probeCanvas.getContext('2d', { willReadFrequently: true });
  const samples = makeCanvas();
  const context = samples.getContext('2d', { willReadFrequently: true });

  return {
    close: () => model.close(),
    detect(frame, withMasks) {
      const w = frame.videoWidth || frame.width, h = frame.videoHeight || frame.height;
      const scale = 192 / Math.max(w, h);
      const width = Math.max(1, Math.round(w * scale)), height = Math.max(1, Math.round(h * scale));

      if (samples.width !== width || samples.height !== height) {
        samples.width = width;
        samples.height = height;
      }

      context.drawImage(frame, 0, 0, width, height);
      let probe = null;

      if (withMasks) {
        probeContext.drawImage(frame, 0, 0, 40, 32);
        probe = probeContext.getImageData(0, 0, 40, 32).data;
      }

      const pixels = context.getImageData(0, 0, width, height).data;
      let people;
      model.detect(frame, result => {
        people = result.landmarks.map((landmarks, i) => ({
          landmarks, worldLandmarks: result.worldLandmarks[i],
          descriptor: chestColors(landmarks, pixels, width, height),
          mask: withMasks ? copyMask(result.segmentationMasks?.[i]) : null,
        }));
      });

      return {people, probe};
    },
  };
}

if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  let detector;
  self.onmessage = async ({ data }) => {
    try {
      if (data.type === 'init') {
        detector = await openDetector();
        self.postMessage({ ready: true });
      } else {
        const result = detector.detect(data.frame, data.withMasks);
        const transfer = result.people.flatMap(p => p.mask ? [p.mask.data.buffer] : []);

        if (result.probe) transfer.push(result.probe.buffer);
        self.postMessage(result, transfer);
      }
    } catch (error) {
      self.postMessage({ error: error.message || String(error) });
    } finally {
      data.frame?.close();
    }
  };
}
