import { bodyScale } from "./depth.js";
import { inkFootprint, surfaceUV } from "./ink.js";

// Each body has the same numbered triangles, even when a limb is out of view.
const sides = 8;

// Wire IDs are stable: torso first, then paired arm and leg segments, then head.
const limbs = [
  [11, 13, 0.29, 0.21],
  [12, 14, 0.29, 0.21],
  [13, 15, 0.22, 0.15],
  [14, 16, 0.22, 0.15],
  [23, 25, 0.42, 0.28],
  [24, 26, 0.42, 0.28],
  [25, 27, 0.28, 0.16],
  [26, 28, 0.28, 0.16],
];

const headPart = limbs.length + 1;
export const bodyTriangleCount = (headPart + 1) * sides * 2;
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

  // The detector can still place cropped hips below the camera at close range.
  const hipUsable = (i) =>
    visible(i) ||
    (Number.isFinite(landmarks?.[i]?.x) &&
      Number.isFinite(landmarks[i].y) &&
      landmarks[i].y >= 1 &&
      landmarks[i].y <= 2.5);

  if (
    ![11, 12].every(visible) ||
    ![23, 24].every(hipUsable) ||
    !(width > 0 && height > 0)
  )
    return null;
  const px = (i) => ({ x: landmarks[i].x * width, y: landmarks[i].y * height });
  const world = worldLandmarks;
  const depth = bodyScale(landmarks, world, width, height);

  const point = (i) => ({
    ...px(i),
    z:
      depth && Number.isFinite(world?.[i]?.z)
        ? world[i].z * depth.pixelsPerMeter
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
  const body = { faces: [], visible: [], radius, width, height, ...depth };
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

  for (const [index, [start, end, upper, lower]] of limbs.entries()) {
    if (!visible(start) || !visible(end)) continue;

    const a = point(start),
      b = point(end);

    const along = unit(subtract(b, a));

    if (!along) continue;
    const side = unit(cross(front, along));

    if (!side) continue;
    const widths = [radius * upper, radius * lower];
    addSurface(body, index + 1, a, b, side, cross(along, side), widths, widths);
  }

  if ([2, 5, 7, 8, 9, 10].every(visible)) {
    const ears = subtract(point(7), point(8));
    const middle = midpoint(point(7), point(8));

    const down = unit(
      subtract(midpoint(point(9), point(10)), midpoint(point(2), point(5))),
    );

    const faceFront = down && unit(cross(down, ears));

    if (faceFront) {
      const half = Math.min(radius * 0.66, length(ears) * 0.57);

      const level = (d) => ({
        x: middle.x + down.x * half * d,
        y: middle.y + down.y * half * d,
        z: middle.z + down.z * half * d,
      });

      addSurface(
        body,
        headPart,
        level(-1.35),
        level(1.12),
        cross(faceFront, down),
        faceFront,
        [half * 0.9, half * 0.79],
        [half, half * 0.94],
      );
    }
  }

  body.visible.sort((a, b) => b.z - a.z);

  return body;
}

export function hitBody(body, x, y, margin = 0) {
  let best = null;

  for (const face of body?.visible ?? []) {
    const [a, b, c] = face.vertices;
    const u = ((x - a.x) * (c.y - a.y) - (y - a.y) * (c.x - a.x)) / face.area;
    const v = ((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x)) / face.area;

    if (u < 0 || v < 0 || u + v > 1) continue;
    const depth = a.z + u * (b.z - a.z) + v * (c.z - a.z);

    if (!best || depth < best.depth) best = { triangle: face.id, u, v, depth };
  }

  if (best || !margin) return best;
  // A silhouette can extend beyond the pose mesh at a sleeve or hand. Snap a
  // nearby sample to the edge of its own mesh, preserving an articulated anchor.
  let bestDistance = margin * margin;

  for (const face of body?.visible ?? []) {
    for (let edge = 0; edge < 3; edge++) {
      const a = face.vertices[edge],
        b = face.vertices[(edge + 1) % 3];

      const dx = b.x - a.x,
        dy = b.y - a.y;

      const t = Math.max(
        0,
        Math.min(
          1,
          ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1),
        ),
      );

      const dist = (x - a.x - t * dx) ** 2 + (y - a.y - t * dy) ** 2;
      const depth = a.z + t * (b.z - a.z);

      if (
        dist > bestDistance ||
        (dist === bestDistance && best && depth >= best.depth)
      )
        continue;
      bestDistance = dist;
      const u = edge === 0 ? t : edge === 1 ? 1 - t : 0;
      const v = edge === 0 ? 0 : edge === 1 ? t : 1 - t;
      best = { triangle: face.id, u, v, depth };
    }
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

// Bake a mark once in body-surface coordinates. Reprojecting a moving person
// then costs one small texture sample per facet, even late in a full round.
const skins = new WeakMap();

const texWidth = 256,
  texHeight = 96;

function surfaceTexture() {
  return typeof OffscreenCanvas !== "undefined"
    ? new OffscreenCanvas(texWidth, texHeight)
    : Object.assign(document.createElement("canvas"), {
        width: texWidth,
        height: texHeight,
      });
}

function stamp(ctx, s, t, scale, part, stain) {
  const footprint = inkFootprint(part);

  const rs = footprint.s * scale,
    rt = footprint.t * scale;

  const phase = (Number(stain.seed) || 0) % 97;
  const side = Math.sin(phase) < 0 ? -1 : 1;
  ctx.setTransform(texWidth / sides, 0, 0, texHeight, 0, 0);

  for (const center of [s - sides, s, s + sides]) {
    if (center + rs * 1.5 < 0 || center - rs * 1.5 > sides) continue;
    ctx.fillStyle = stain.color;
    ctx.beginPath();

    for (let i = 0; i < 32; i++) {
      const angle = (i * Math.PI) / 16;

      const wobble =
        0.91 +
        0.15 * Math.sin(5 * angle + phase) +
        0.1 * Math.cos(7 * angle - phase);

      const x = center + Math.cos(angle) * rs * wobble,
        y = t + Math.sin(angle) * rt * wobble;

      if (!i) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }

    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(
      center + side * rs * 1.15,
      t + 0.02,
      rs * 0.16,
      rt * 0.15,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,241,.68)";
    ctx.beginPath();
    ctx.ellipse(
      center - rs * 0.26,
      t - rt * 0.33,
      rs * 0.21,
      rt * 0.12,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
}

function texturesFor(stains) {
  // Deltas append to each player's ordered list. A full snapshot or a new
  // round creates a different first mark, releasing the previous texture set.
  let skin = skins.get(stains[0]);

  if (!skin || skin.count > stains.length) {
    skin = { parts: [], legacy: [], count: 0 };
    skins.set(stains[0], skin);
  }

  for (let i = skin.count; i < stains.length; i++) {
    const stain = stains[i],
      { part, s, t } = surfaceUV(stain);

    let scale = stain.scale;

    if (scale == null) {
      const previous = (skin.legacy[part] ??= []);
      scale = stainRadiusScale(previous, s, t, part);
      previous.push({ s, t });
    }

    const texture = (skin.parts[part] ??= surfaceTexture());
    stamp(texture.getContext("2d"), s, t, scale, part, stain);
  }

  skin.count = stains.length;

  return skin.parts;
}

function paintFacet(ctx, face, texture) {
  if (!texture) return;
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

  const slice = Math.min(a.s, b.s, c.s);
  ctx.drawImage(
    texture,
    (slice * texWidth) / sides,
    0,
    texWidth / sides,
    texHeight,
    slice,
    0,
    1,
    1,
  );
}

let paintLayer;

export function drawPaint(ctx, body, stains, constrainPaint) {
  if (!body?.visible.length || !stains?.length) return;
  const textures = texturesFor(stains);

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
    paintFacet(layer, face, textures[face.part]);
    layer.restore();
  }

  constrainPaint?.(layer);
  ctx.drawImage(paintLayer, 0, 0, width, height, left, top, width, height);
}
