import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

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
    // Carrying pose regions across frames
    // can duplicate a person after a fast pan. Identity continuity lives in the pose tracks.
    runningMode: 'IMAGE', numPoses: 8, outputSegmentationMasks: true,
  });

  return {
    close: () => model.close(),
    detect(frame) {
      let people;
      model.detect(frame, result => {
        people = result.landmarks.map((landmarks, i) => ({
          landmarks, worldLandmarks: result.worldLandmarks[i],
          mask: copyMask(result.segmentationMasks?.[i]),
        }));
      });

      return { people };
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
        const result = detector.detect(data.frame);
        const transfer = result.people.flatMap(p => p.mask ? [p.mask.data.buffer] : []);

        self.postMessage(result, transfer);
      }
    } catch (error) {
      self.postMessage({ error: error.message || String(error) });
    } finally {
      data.frame?.close();
    }
  };
}
