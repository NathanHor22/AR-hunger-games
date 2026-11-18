// A pose's world coordinates are centered on its own hips. Compare apparent
// pixels per meter, never one person's landmark z against another person's z.
const torsoSpans = [[11, 12, 0.38], [11, 23, 0.50], [12, 24, 0.50]];

function median(values) {
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);

  return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
}

export function bodyScale(landmarks, world, width, height) {
  const measured = [], fallback = [];
  let visibility = 1;

  for (const [a, b, typicalLength] of torsoSpans) {
    const p = landmarks[a], q = landmarks[b];

    if (!p || !q) return null;
    visibility = Math.min(visibility, p.visibility ?? 1, q.visibility ?? 1, p.presence ?? 1, q.presence ?? 1);
    const imageSpan = Math.hypot((p.x - q.x) * width, (p.y - q.y) * height);

    if (!Number.isFinite(imageSpan) || imageSpan <= 0) continue;
    const localZ = ((p.z ?? 0) - (q.z ?? 0)) * width;
    fallback.push(Math.hypot(imageSpan, Number.isFinite(localZ) ? localZ : 0) / typicalLength);
    const wa = world?.[a], wb = world?.[b];

    if (!wa || !wb) continue;
    // Use the projected world span. A turned shoulder appears shorter in both
    // projections; a nearly end-on span is too noisy to serve as a ruler.
    const worldSpan = Math.hypot(wa.x - wb.x, wa.y - wb.y);

    if (worldSpan > 0.12 && worldSpan < 0.85) measured.push(imageSpan / worldSpan);
  }

  if (fallback.length < 2) return null;
  const useWorld = measured.length >= 2;
  const ratios = useWorld ? measured : fallback;
  const pixelsPerMeter = median(ratios);
  const scatter = median(ratios.map(ratio => Math.abs(ratio / pixelsPerMeter - 1)));
  const depthTolerance = visibility >= 0.65 ? Math.max(useWorld ? 0.13 : 0.23, scatter) : 1;

  return { pixelsPerMeter, depthTolerance };
}

export function clearlyInFront(front, back) {
  return !!front && !!back && front.depthTolerance < 1 && back.depthTolerance < 1
    && front.pixelsPerMeter * (1 - front.depthTolerance) > back.pixelsPerMeter * (1 + back.depthTolerance);
}

// Both collision and compositing read this stencil. 0 means background;
// 255 means the edge or front/back order is uncertain.
export function ownership(people) {
  const first = people.find(person => person.mask)?.mask;

  if (!first) return null;
  const { width, height } = first;
  const owners = new Uint8Array(width * height);

  const layers = people.map(({ mask, body }, index) => ({ mask, body, id: index + 1 }))
    .filter(({ mask }) => mask?.width === width && mask.height === height)
    .sort((a, b) => (b.body?.pixelsPerMeter ?? 0) - (a.body?.pixelsPerMeter ?? 0));

  for (const { mask, body, id } of layers) {
    const inFront = people.map(person => clearlyInFront(person.body, body));

    for (let i = 0; i < owners.length; i++) {
      const confidence = mask.data[i];

      if (!(confidence > 0.3)) continue;
      const owner = owners[i];

      if (owner === 0) owners[i] = confidence >= 0.6 ? id : 255;
      else if (owner !== 255 && !inFront[owner - 1]) owners[i] = 255;
    }
  }

  return { width, height, owners };
}
