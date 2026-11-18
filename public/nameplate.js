// Points have already been mapped through the camera's object-fit: cover crop.
export function headAnchor(points, width, height) {
  function point(index) {
    const p = points?.[index];

    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)
      || (p.visibility ?? 1) < 0.55 || (p.presence ?? 1) < 0.55) return null;

    return { x: p.x * width, y: p.y * height };
  }

  const pair = (a, b) => a && b && { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const span = (a, b) => a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  const leftEye = point(2), rightEye = point(5), leftEar = point(7), rightEar = point(8);
  const leftShoulder = point(11), rightShoulder = point(12);
  const shoulders = pair(leftShoulder, rightShoulder);
  let face = pair(leftEye, rightEye) || point(0) || pair(leftEar, rightEar) || leftEye || rightEye;

  let crown = Math.max(5, span(leftEye, rightEye) * 1.35, span(leftEar, rightEar) * .62,
    span(leftShoulder, rightShoulder) * .22, span(face, shoulders) * .43);

  // A turned head can lose all facial landmarks while the back and shoulders stay tracked.
  if (!face) {
    const hips = pair(point(23), point(24));

    if (!hips || !shoulders || span(shoulders, hips) < 8) return null;
    face = {
      x: shoulders.x + .34 * (shoulders.x - hips.x),
      y: shoulders.y + .34 * (shoulders.y - hips.y),
    };
    crown = Math.max(crown, .19 * span(shoulders, hips));
  }

  // Cropped-out heads must not pile up along the edge of a portrait viewport.
  if (face.x < 0 || face.x > width || face.y < 0 || face.y > height) return null;

  return {
    x: face.x, y: Math.max(0, face.y - crown),
    head: { left: face.x - crown, right: face.x + crown, top: face.y - crown, bottom: face.y + crown },
  };
}

const plateHeight = 32;
const edge = 4;
const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

function position(anchor, plateWidth, width, height, occupied) {
  const x = anchor.x - plateWidth / 2;
  const y = anchor.y - plateHeight - 8;
  const rows = [y], columns = [x, x - plateWidth / 2 - 9, x + plateWidth / 2 + 9];

  for (const box of occupied) {
    rows.push(box.top - plateHeight - edge, box.bottom + edge);
    columns.push(box.left - plateWidth - edge, box.right + edge);
  }

  rows.sort((a, b) => Math.abs(a - y) - Math.abs(b - y));
  columns.sort((a, b) => Math.abs(a - x) - Math.abs(b - x));
  let best, leastOverlap = Infinity;

  // Prefer a centered label above the head. At the top edge or in a crowd, move
  // sideways or stack and retain the link to this specific person's crown.
  for (const row of rows) {
    for (const col of columns) {
      const left = clamp(col, edge, width - plateWidth - edge);
      const top = clamp(row, edge, height - plateHeight - edge);
      const right = left + plateWidth, bottom = top + plateHeight;
      let overlap = 0;

      for (const box of occupied) {
        overlap += Math.max(0, Math.min(right, box.right + edge) - Math.max(left, box.left - edge)) *
          Math.max(0, Math.min(bottom, box.bottom + edge) - Math.max(top, box.top - edge));
      }

      if (overlap < leastOverlap) {
        best = { left, right, top, bottom };
        leastOverlap = overlap;
      }

      if (!overlap) return best;
    }
  }

  return best;
}

export function drawNameplates(ctx, scene, width, height, reserved = []) {
  if (width < 80 || height < plateHeight + 2 * edge) return;
  const occupied = [...reserved];
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = 'bold 14px Consolas, monospace';

  for (const { points, player } of scene) {
    if (!player?.connected || player.spectator) continue;
    const crown = headAnchor(points, width, height);

    if (!crown) continue;
    const plateWidth = Math.min(width - 2 * edge, clamp(ctx.measureText(player.name).width + 59, 96, 184));
    occupied.push(crown.head);
    const box = position(crown, plateWidth, width, height, occupied);
    occupied.push(box);
    const { left, top, right, bottom } = box;
    const health = clamp(player.health, 0, 10);

    ctx.beginPath();
    ctx.moveTo(clamp(crown.x, left + 2, right - 2), clamp(crown.y, top, bottom));
    ctx.lineTo(crown.x, crown.y);
    ctx.strokeStyle = '#251b35';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = '#fff2d2';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = '#251b35';
    ctx.fillRect(left, top, plateWidth, plateHeight);
    ctx.fillStyle = player.color;
    ctx.fillRect(left, top, 3, plateHeight);
    ctx.fillStyle = '#fff2d2';
    ctx.fillText(player.name, left + 8, top + 16, plateWidth - 54);
    ctx.font = 'bold 11px Consolas, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(health + '/10', right - 5, top + 16);
    ctx.textAlign = 'left';
    ctx.font = 'bold 14px Consolas, monospace';

    const cell = (plateWidth - 13) / 10;

    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = i < health ? player.color : '#675775';
      ctx.fillRect(left + 8 + i * cell, bottom - 9, cell - 1.5, 5);
    }
  }

  ctx.restore();
}
