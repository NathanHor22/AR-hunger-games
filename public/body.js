// Each body has the same numbered triangles, even when a limb is out of view.
const sides = 8;
const subtract = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const length = (v) => Math.hypot(v.x, v.y, v.z);

const unit = (v) => {
  const n = length(v);

  return n > 0.001 ? { x: v.x / n, y: v.y / n, z: v.z / n } : null;
};

const cross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

const midpoint = (a, b) => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
  z: (a.z + b.z) / 2,
});

function addSurface(
  body,
  part,
  top,
  bottom,
  lateral,
  front,
  widths,
  thicknesses,
) {
  const rings = [top, bottom].map((center, row) =>
    Array.from({ length: sides + 1 }, (_, i) => {
      const angle = (i * Math.PI * 2) / sides;
      const a = Math.cos(angle) * widths[row];
      const b = Math.sin(angle) * thicknesses[row];

      return {
        x: center.x + a * lateral.x + b * front.x,
        y: center.y + a * lateral.y + b * front.y,
        z: center.z + a * lateral.z + b * front.z,
        s: i,
        t: row,
      };
    }),
  );

  for (let i = 0; i < sides; i++) {
    const [a, b, c, d] = [
      rings[0][i],
      rings[0][i + 1],
      rings[1][i],
      rings[1][i + 1],
    ];

    for (const [half, vertices] of [
      [0, [a, b, c]],
      [1, [b, d, c]],
    ]) {
      const [p, q, r] = vertices;
      const area = (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
      const id = part * sides * 2 + 2 * i + half;
      body.faces[id] = { vertices, area, id, part, z: (p.z + q.z + r.z) / 3 };

      if (area < -0.1) body.visible.push(body.faces[id]);
    }
  }
}

export function makeBody(landmarks, worldLandmarks, width, height) {
  const visible = (i) => {
    const p = landmarks?.[i];

    return (
      p &&
      Number.isFinite(p.x) &&
      Number.isFinite(p.y) &&
      (p.visibility ?? 1) >= 0.45
    );
  };

  if (![11, 12, 23, 24].every(visible) || !(width > 0 && height > 0))
    return null;
  const px = (i) => ({ x: landmarks[i].x * width, y: landmarks[i].y * height });
  const span = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const world = worldLandmarks;

  const measuredWorld = [11, 12, 23, 24].every(
    (i) =>
      world?.[i] && [world[i].x, world[i].y, world[i].z].every(Number.isFinite),
  );

  const worldSpan = measuredWorld
    ? span(world[11], world[23]) + span(world[12], world[24])
    : 0;

  const scale =
    worldSpan > 0.05
      ? (span(px(11), px(23)) + span(px(12), px(24))) / worldSpan
      : 0;

  const point = (i) => ({
    ...px(i),
    z:
      scale && Number.isFinite(world[i]?.z)
        ? world[i].z * scale
        : (landmarks[i].z ?? 0) * width,
  });

  const [ls, rs, lh, rh] = [11, 12, 23, 24].map(point);

  const top = midpoint(ls, rs),
    bottom = midpoint(lh, rh);

  const axis = unit(subtract(bottom, top)),
    shoulders = subtract(ls, rs);

  if (!axis || length(shoulders) < 4) return null;
  const front = unit(cross(axis, shoulders));

  if (!front) return null;
  const lateral = unit(cross(front, axis));
  const radius = length(shoulders) / 2;
  const body = { faces: [], visible: [], radius, width, height };
  addSurface(
    body,
    0,
    top,
    bottom,
    lateral,
    front,
    [radius, length(subtract(lh, rh)) * 0.55],
    [radius * 0.56, radius * 0.53],
  );

  for (const [part, shoulder, end] of [
    [1, ls, 13],
    [2, rs, 14],
  ]) {
    if (!visible(end)) continue;

    const elbow = point(end),
      armAxis = unit(subtract(elbow, shoulder));

    if (!armAxis) continue;
    const armSide = unit(cross(front, armAxis));

    if (!armSide) continue;
    addSurface(
      body,
      part,
      shoulder,
      elbow,
      armSide,
      cross(armAxis, armSide),
      [radius * 0.29, radius * 0.21],
      [radius * 0.29, radius * 0.21],
    );
  }

  body.visible.sort((a, b) => b.z - a.z);

  return body;
}

export function hitBody(body, x, y) {
  let best = null;

  for (const face of body?.visible ?? []) {
    const [a, b, c] = face.vertices;
    const u = ((x - a.x) * (c.y - a.y) - (y - a.y) * (c.x - a.x)) / face.area;
    const v = ((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x)) / face.area;

    if (u < 0 || v < 0 || u + v > 1) continue;
    const depth = a.z + u * (b.z - a.z) + v * (c.z - a.z);

    if (!best || depth < best.depth) best = { triangle: face.id, u, v, depth };
  }

  return best;
}

// Density on one continuous body surface, including its wrapped UV seam.
export function stainRadiusScale(previous, s, t, part) {
  let density = 0;

  for (const stain of previous) {
    const gap = Math.abs(s - stain.s);
    const ds = Math.min(gap, sides - gap) / (part === 0 ? 0.9 : 1.4);
    const dt = (t - stain.t) / (part === 0 ? 0.21 : 0.29);
    density += Math.max(0, 1 - ds * ds - dt * dt);
  }

  return Math.min(2.45, Math.sqrt(1 + 0.62 * density));
}

// Draw in the unfolded surface's coordinates. Adjacent facets clip the same
// splat independently so it can wrap across the seam and follow articulation.
function paintFacet(ctx, face, stains) {
  const [a, b, c] = face.vertices;

  const ds1 = b.s - a.s,
    ds2 = c.s - a.s,
    dt1 = b.t - a.t,
    dt2 = c.t - a.t;

  const det = ds1 * dt2 - ds2 * dt1;

  const xx = ((b.x - a.x) * dt2 - (c.x - a.x) * dt1) / det,
    yx = ((b.y - a.y) * dt2 - (c.y - a.y) * dt1) / det;

  const xy = (ds1 * (c.x - a.x) - ds2 * (b.x - a.x)) / det,
    yy = (ds1 * (c.y - a.y) - ds2 * (b.y - a.y)) / det;

  ctx.transform(
    xx,
    yx,
    xy,
    yy,
    a.x - a.s * xx - a.t * xy,
    a.y - a.s * yx - a.t * yy,
  );

  for (const stain of stains) {
    const facetCenter = (a.s + b.s + c.s) / 3;

    const center =
      stain.s + sides * Math.round((facetCenter - stain.s) / sides);

    const radiusS = (face.part === 0 ? 0.74 : 1.28) * stain.scale;
    const radiusT = (face.part === 0 ? 0.16 : 0.22) * stain.scale;

    if (Math.abs(center - facetCenter) > 1 + radiusS * 1.26) continue;
    ctx.fillStyle = stain.color;
    ctx.globalAlpha = 0.87;
    ctx.beginPath();

    for (let i = 0; i < 24; i++) {
      const angle = (i * 2 * Math.PI) / 24;

      const wobble =
        0.84 +
        0.18 * Math.sin(angle * 5 + stain.phase) +
        0.13 * Math.cos(angle * 7 - stain.phase);

      const x = center + Math.cos(angle) * radiusS * wobble;
      const y = stain.t + Math.sin(angle) * radiusT * wobble;

      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }

    ctx.closePath();
    ctx.fill();
    // Keep the wet highlight and stray droplets on the same curved surface.
    const side = Math.sin(stain.phase) < 0 ? -1 : 1;
    ctx.beginPath();
    ctx.ellipse(
      center + side * radiusS * 1.13,
      stain.t + 0.025,
      radiusS * 0.12,
      0.018,
      0,
      0,
      2 * Math.PI,
    );
    ctx.fill();
    ctx.fillStyle = "rgba(255,246,216,0.52)";
    ctx.beginPath();
    ctx.ellipse(
      center - radiusS * 0.28,
      stain.t - 0.049,
      radiusS * 0.19,
      0.012,
      0,
      0,
      2 * Math.PI,
    );
    ctx.fill();
  }
}

let paintLayer;

export function drawPaint(ctx, body, stains, constrainPaint) {
  if (!body?.visible.length || !stains?.length) return;
  const byPart = [[], [], []];

  for (const stain of stains) {
    const face = body.faces[stain.triangle];

    if (!face) continue;
    const [a, b, c] = face.vertices;
    const s = a.s + stain.u * (b.s - a.s) + stain.v * (c.s - a.s);
    const t = a.t + stain.u * (b.t - a.t) + stain.v * (c.t - a.t);
    byPart[face.part].push({
      s,
      t,
      scale: stainRadiusScale(byPart[face.part], s, t, face.part),
      color: stain.color,
      phase: (Number(stain.seed) || 0) % 97,
    });
  }

  if (!paintLayer)
    paintLayer =
      typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(1, 1)
        : document.createElement("canvas");
  const points = body.visible.flatMap((face) => face.vertices);
  const left = Math.max(0, Math.floor(Math.min(...points.map((p) => p.x))) - 1);
  const top = Math.max(0, Math.floor(Math.min(...points.map((p) => p.y))) - 1);

  const width =
    Math.min(body.width, Math.ceil(Math.max(...points.map((p) => p.x))) + 1) -
    left;

  const height =
    Math.min(body.height, Math.ceil(Math.max(...points.map((p) => p.y))) + 1) -
    top;

  if (width <= 0 || height <= 0) return;

  if (paintLayer.width < width) paintLayer.width = width;

  if (paintLayer.height < height) paintLayer.height = height;
  const layer = paintLayer.getContext("2d");
  layer.setTransform(1, 0, 0, 1, 0, 0);
  layer.clearRect(0, 0, width, height);
  layer.translate(-left, -top);

  for (const face of body.visible) {
    const [a, b, c] = face.vertices;
    layer.save();
    layer.beginPath();
    layer.moveTo(a.x, a.y);
    layer.lineTo(b.x, b.y);
    layer.lineTo(c.x, c.y);
    layer.closePath();
    layer.clip();
    // A nearer unpainted sleeve can hide a mark on the chest.
    layer.clearRect(left, top, width, height);
    paintFacet(layer, face, byPart[face.part]);
    layer.restore();
  }

  constrainPaint?.(layer);
  ctx.drawImage(paintLayer, 0, 0, width, height, left, top, width, height);
}
