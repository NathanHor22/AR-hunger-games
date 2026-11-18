// Sprite plates share a fixed pixel grid, from the palm-sized fruit to the shooting HUD.
const ink = '#261932', violet = '#593756', plum = '#8b3550';
const red = '#ee3743', cherry = '#bd2545', orange = '#ff6643', peach = '#ffa259';
const cream = '#ffefb1', gold = '#ffc856', ochre = '#e49455', sand = '#b96956';
const pine = '#1f5148', leaf = '#4e9b48', lime = '#a4df58', glint = '#e1f785';


function plate(width, height, paint) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  const fill = (color, contour) => {
    ctx.fillStyle = color;
    ctx.fill(new Path2D(contour));
  };

  paint(fill);
  // Make the baked outlines opaque at pixel boundaries, including when scaled for a phone.
  const tile = ctx.getImageData(0, 0, width, height);

  for (let i = 3; i < tile.data.length; i += 4) {
    tile.data[i] = tile.data[i] < 128 ? 0 : 255;
  }

  ctx.putImageData(tile, 0, 0);

  return canvas;
}

function drawHead(fill, blink) {
  // Broad fruit lobes and four stepped bands of skin pigment.
  const fruit = 'M47 61q1-15 13-23l11-5 10 1q12-7 24-3l8 4q13-2 20 10 8 11 6 25-1 15-14 25-12 10-27 9-13 7-28-1-13-1-20-13-9-9-8-20z';
  fill(ink, fruit);
  fill(plum, 'M48 62q1-15 14-23l11-4 9 2q11-7 22-4l8 5q13-1 19 9 8 10 6 23-1 14-14 23-14 10-26 8-13 7-26-1-13-1-19-12-8-10-7-18z');
  fill(cherry, 'M48 62q1-15 14-23l11-4 9 2q11-7 22-4l8 5q11-2 18 8 8 11 5 23-1 12-15 21-12 8-25 7-11 6-23 0-12-2-19-14-8-11-5-21z');
  fill(red, 'M50 58q4-14 17-19l7-3 9 2q11-7 22-3l7 4q10-2 16 7 7 10 3 22-4 12-16 19-11 6-22 4-12 5-22-2-13-4-18-15-4-8-3-16z');
  fill(orange, 'M52 61q2-11 10-17l9-5 11 1 8-3 10-1-8 6-12 3-9 8-5 11-7 6-4-3z M106 35l7 4 8 1 5 5-8-3-8 1z');
  fill(peach, 'M53 61l3-10 7-7 7-3 5-1-1 3-7 3-6 6-4 9z M52 65l3-2 1 3-3 3z');
  fill(cream, 'M57 52l5-6 5-2-2 3-5 4-3 4z M54 58l2-3 1 2-2 4z');
  fill(cherry, 'M55 76l4 4 2 6-4-4z M60 83l5 4 4 2 1 2-6-2z M75 93l8 3 9-1-5 4-8-2z');
  fill(peach, 'M63 73l2-2 4 1 1 2-4 1z M67 77h3v2h-3z M72 73h2v2h-2z');
  fill(plum, 'M124 73l5-6-1 5-4 4z M111 94l7-2-4 4-5 1z');

  // Overlapping crown blades curl away from the direction of travel.
  fill(ink, 'M88 37q-9-10-22-14l-15-3 12-3 15 3-10-11 8 1q12 3 20 12l2-12 6-7 7-1 5 4-8 5-3 14 10-8 13-2-8 8-3 5 16-2 11 4-12 4-14 6 13 3 4 6-12-2-18 2-6 10-4-10-1-6-14 9 2-8-13 1-15-3 13-4z');
  fill(pine, 'M91 37q-9-10-23-14l-9-3 13 1 14 5-12-13q11 2 22 14l4-3 3-11 6-8 4 1-7 6-3 19 14-11 6-2-10 12-2 3 20-5 6 2-13 4-14 7 13 3 5 3-14-2-12 4-3 6-3-12-11 7 3-7-14 2-11-2 14-3z');
  fill(leaf, 'M65 21l14 3 14 7-7-6-9-10q13 4 21 17l4-6 4-14 5-5-6 18-1 8 13-10-9 12 19-5-15 8-10 4-5 9-2-11-13 7 6-8-17 3 8-3 11-3-10-8z');
  fill(lime, 'M77 14l8 4 9 9 3 6-5-4-8-9z M105 12l4-6h3l-5 6-3 13-2 4z M108 36l10-4 10-2-9 4-9 4z M82 40l9-4 5 1-8 3-8 2z');
  fill(glint, 'M78 15l6 3 3 4-5-3z M107 9l2-3h3l-3 2-2 4z M118 33l6-2-2 2z');

  // The brow cuts across both eyes. Two glints read at the smallest presentation size.
  if (blink) {
    fill(plum, 'M77 60l9 5 12-1-7 6-8-1z M110 62l9-5 8-7-3 9-8 6z');
    fill(ink, 'M77 59l10 5 13-1-6 4-8 1-7-4z M109 61l10-5 8-7-1 5-7 8-7 2z');
  } else {
    fill(ink, 'M75 55q4-5 10-5l9 4 10 7-4 9-5 5-8 1-6-3-5-8z M106 58l9-10 9-3 5 2 1 8-4 9-6 5-9-2-5-3z');
    fill(sand, 'M78 56l6-2 9 4 8 5-5 8-5 3-7-2-5-8z M109 58l8-8 8-3 2 3-1 8-5 8-7 1-4-2z');
    fill(cream, 'M79 56l5-2 9 4 8 5-5 6-6 3-6-2-4-7z M109 58l8-7 7-3 3 1-2 8-5 7-6 1-4-2z');
    fill(ink, 'M92 58l6 3 2 4-2 5-5 1-3-4z M121 50l5-2-1 8-4 6-4-1 1-6z');
    fill('#fffbe1', 'M93 58h3v3h-3z M122 50h3v3h-3z');
  }

  fill(ink, 'M72 50l9-2 10 3 13 8-1 4-8-3-10-6-10-1-4 2z M106 57l8-10 10-6 6 2-8 4-11 12z');
  fill(plum, 'M72 49l10-2 12 5 4 4-13-6-11 2z M115 46l9-6 4 1-8 4z');
  fill(orange, 'M100 69l2-4 5-2 4 2 1 4-3 3-5 1z');
  fill(peach, 'M103 66l4-2 2 1-1 2-5 1z');
  fill(cherry, 'M102 71l4 1 5-3-1 3-5 2z');
  fill(ink, 'M78 78q15 6 30 0 9-3 15-10l-1 9-6 8-12 7-11 2-9-4-5-7z');
  fill(cream, 'M82 80q17 4 30-3l8-5-3 6-8 5-4-1-1 3-9 2-8-2z');
  fill(red, 'M94 90l7-4 8-1 3 1-9 5-7 1z');
  fill(peach, 'M99 89l7-3 3 1-8 3z');
  fill(cherry, 'M75 80l1-4 5-1-3 2z M122 66l3-1 3 2-3-1z');
}

let tomatoSprite;

function tomato() {
  tomatoSprite ??= plate(34, 32, fill => {
    fill(ink, 'M4 12l4-4 5-1 4 1 3-2 7 1 5 5 1 7-3 7-7 5-6 1-4-2-5-1-6-6-1-6z');
    fill(plum, 'M5 13l4-3 5-1 4 1 4-2 5 2 4 4-1 8-6 6-7 2-6-2-5-4-3-5z');
    fill(cherry, 'M5 13l6-4 6 2 7-2 5 4 1 5-5 7-6 2-7-1-7-5-1-4z');
    fill(red, 'M5 14l5-4 7 2 6-2 5 2 1 5-4 5-8 3-7-2-5-4z');
    fill(orange, 'M6 15l4-4 6 1-2 2-4 1-3 4z M23 11l5 2 1 3-3-2-4-1z');
    fill(cream, 'M7 15l3-3 3 1-3 2-1 2H7z M6 18h2v2H6z');
    fill(peach, 'M10 20h2v2h-2z');
    fill(ink, 'M12 10L7 7l6-1-1-5 6 5 2-5 5-1-3 7 7-1-4 5-6 1-3 4-1-4-6 1z');
    fill(pine, 'M12 8l4 1-2-5 4 4 4-6-2 7 6-2-4 4-4-1-2 4-1-3-4 1z');
    fill(leaf, 'M10 7l6 1 1 2-4-1z M19 8l2-6 2-1-2 6z M18 10l7-3-4 3z');
    fill(lime, 'M15 4l2 2v2z M20 6l2-5h1l-2 5z');
  });

  return tomatoSprite;
}

export function drawTomatoProjectile(ctx, x, y, radius) {
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tomato(), x - radius, y - radius, radius * 2, radius * 2);
  ctx.restore();
}

function makeRig() {
  const head = plate(146, 108, fill => drawHead(fill, false));
  const blink = plate(146, 108, fill => drawHead(fill, true));

  const boot = plate(49, 30, fill => {
    fill(ink, 'M6 8l5-7 10-1 6 8 11-1 8 5 3 9-2 6-8 3-32-2-6-4-1-8z');
    fill(violet, 'M4 16l7-8 7 2 3 4 14-2 9 2 3 9-8 5-31-2-5-4z');
    fill(ochre, 'M4 14l9-10 7-2 5 9 13-2 7 5 2 5-11 5-22-2-11-3z');
    fill(gold, 'M6 14l7-8 7-2 4 10 9-3 8 1 4 5-13 4-16-1-10-3z');
    fill(cream, 'M3 20l8 3 25 2 11-5-2 5-8 3-26-2-7-3z M8 12l5-6 5-2-3 4-4 4z M31 13l6-2 4 2-7 2z');
    fill(ink, 'M18 10l3-2 4 3-2 2z M22 13l3-2 5 3-4 2z');
    fill(peach, 'M11 15l3-2 2 2-3 2z');
  });

  const palm = plate(41, 35, fill => {
    // Cup the palm around the lower edge of the fruit; the long thumb points inward.
    fill(ink, 'M3 4l4-2 6 5 4 2 7-1 6-7 5 1 2 5-4 9 6 1 2 4-3 6-8 3-5 5-9-1-5-7-7-3-3-6 2-4-2-4z');
    fill(sand, 'M4 6l3-2 6 6 6 2 7-2 6-7 3 2-1 5-4 7 8 1 1 3-3 4-9 4-4 4-7-1-5-7-6-2-2-6 3-3-3-4z');
    fill(ochre, 'M5 6l2-1 6 6 8 2 6-2 5-6 2 1-1 5-6 8 10 1-2 4-10 4-6-2-6-8-5-2z');
    fill(cream, 'M5 6l3-1 6 8 6 1 2 3-8-1-5-3z M27 12l6-7 1 2-2 6-7 7-3-1z M16 21l6 1 5-1 5-2 5 2-6 4-8 2-4-1z');
    fill(gold, 'M11 24l7 4 5 3-1 2-6-2-4-3z');
    fill('#fffbe1', 'M6 6h3l4 5-3-1z M32 6h2l-2 4-2 1z M29 21l5-2 2 2-6 2z');
    fill(plum, 'M13 18l6 2 5-1-4 3-5-1z M5 17l2-2 3 2-2 2z');
  });

  const fist = plate(36, 32, fill => {
    fill(ink, 'M0 16l3-5 3-1 1-6 5-2 5 3 4-4 5 2 2 4 5 1 3 4-1 8-5 7-10 5-8-2-5-6-6-1z');
    fill(sand, 'M2 16l4-4 3 1 0-7 4-2 5 5 3-6 4 1 2 6 5 0 2 4-2 6-5 6-8 4-6-2-4-6-6-2z');
    fill(ochre, 'M3 15l3-2 5 3-1-9 3-2 5 7 3-7 4 1 2 6 4-1 2 2-3 7-5 5-8 2-5-3-3-6-6-1z');
    fill(cream, 'M3 15l3-2 5 3 1 5-4-2-4-1z M11 7l3-2 4 6-1 5-4-2z M20 8l3-3 3 5-1 5-4 2-2-4z M27 13l4-2 2 2-3 6-4 1z M18 19l6-3 4 2-6 5-5 1-3-2z');
    fill('#fffbe1', 'M12 7l2-1 2 3-2 1z M22 7l2-1 2 3-2 1z');
  });

  const splat = plate(128, 94, fill => {
    const silhouette = 'M49 28l-9-14 3-4 8 4 8 13 6-4 6-18 4-3 3 3-4 21 9-3 12-12 6-2 1 5-13 15 12-2 17-9 7-1-1 5-16 9-11 5 5 4 18 4 4 4-3 3-23-4-7 2-4 4 11 10 13 8 2 5-5 1-16-9-10-8-4 1-1 8 4 14-2 4-4-1-4-10-4-14-8-3-5 3-9 15-5 3-3-3 12-22-9 1-14 7-7-1-1-3 18-9 7-6-9-4-17-1-9-4-1-4 5-1 23 5 11 1-14-13-6-8 2-4 5 2 13 13z';
    fill(plum, silhouette);
    fill(cherry, 'M49 31l-7-17 4 2 12 15 8-5 8-20-4 24 13-4 16-13-16 20 17-3 22-11-16 12-15 7 9 6 18 4-22-3-8 4-2 5 13 12-17-10-6-2-3 6 3 19-9-22-10-3-6 4-13 17 10-23-11 1-18 8 14-10 9-6-11-5-20-3 24 2 12 2-20-22z');
    fill(red, 'M43 30l13 4 9-3 7-10-2 12 13-4-6 8 17-6-7 8 5 5-10 4-3 7-5-1-3 4-10-5-10 3 2-7-14 0 8-7-13-7 16 2z');
    fill(orange, 'M39 37l14 1 10-5 6 0-7 6-15 3z M54 45l5-4 8-1 2 3-6 5-7 1z M72 47l6-4 4 1-3 4-6 1z');
    fill(peach, 'M44 38h7l2 2-5 2z M60 43l4-2 3 1-3 3-3 1z');
    fill(gold, 'M48 44l4-2 3 1-3 2z M73 40l4-3 3 1-3 3z M64 49l4-2 2 1-2 2z');
  });

  return {head, blink, boot, palm, fist, splat};
}


// Key poses of the pitch, measured in logical pixels from the top-left of the stage.
// Hand travels back first, then snaps forward while the planted boots hold their ground.
const poses = [
  // ms,  body x, y, tilt, palm x, y, wrist angle, palm scale
  [0,     125, 83,  0,     50, 85, -.10, 1],
  [180,   128, 88,  .06,   52, 92, -.16, 1],
  [420,   114, 85, -.14,   34, 67, -.56, .94],
  [500,   113, 84, -.16,   31, 64, -.62, .92],
  [610,   136, 82,  .13,  103, 81,  .16, 1.28],
  [745,   139, 85,  .15,  110, 90,  .27, 1.22],
  [980,   131, 90,  .06,   83, 103, .13, 1.02],
  [1250,  124, 87, -.02,   57, 105, .05, .96],
  [1590,  125, 82,  0,     49, 83, -.13, 1],
  [1740,  125, 83,  0,     50, 85, -.10, 1]
];

const releaseAt = 610, impactAt = 955, finishAt = 1740;

function pitchAt(ms) {
  let index = 1;

  while (index < poses.length - 1 && ms > poses[index][0]) index++;
  const from = poses[index - 1], to = poses[index];
  const p = (ms - from[0]) / (to[0] - from[0]);
  const ease = p * p * (3 - 2 * p);

  return from.slice(1).map((n, i) => n + (to[i + 1] - n) * ease);
}

function limb(ctx, fromX, fromY, bendX, bendY, toX, toY, width) {
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.quadraticCurveTo(bendX, bendY, toX, toY);
  ctx.lineCap = 'round';
  ctx.lineWidth = width;
  ctx.strokeStyle = ink;
  ctx.stroke();
  ctx.lineWidth = Math.max(2, width - 6);
  ctx.strokeStyle = violet;
  ctx.stroke();
}

function paintPitch(ctx, rig, elapsed, pitch) {
  const active = pitch >= 0;
  const bob = Math.round(Math.sin(elapsed / 235) * 1.7);
  const idle = [125, 83 + bob, bob * .006, 50, 85 + bob * 1.5, -.10 + bob * .018, 1];
  const [x, y, lean, handX, handY, wrist, scale] = active ? pitchAt(pitch) : idle;

  ctx.clearRect(0, 0, 240, 160);
  ctx.imageSmoothingEnabled = false;
  // Flattened stepped shadow under both stationary shoes.
  ctx.fillStyle = '#281b3e88';
  ctx.fillRect(58, 151, 132, 5);
  ctx.fillRect(68, 156, 102, 2);
  ctx.fillStyle = '#392643bb';
  ctx.fillRect(71, 150, 108, 4);

  limb(ctx, x - 16, y + 23, x - 25, y + 43, 90, 137, 15);
  limb(ctx, x + 20, y + 21, x + 18, y + 45, 155, 135, 17);

  ctx.save();
  ctx.translate(97, 126);
  ctx.scale(-.9, .9);
  ctx.drawImage(rig.boot, 0, 0);
  ctx.restore();
  ctx.drawImage(rig.boot, 143, 125);

  const guardX = x + 60 - lean * 16, guardY = y + 8 - lean * 19;
  limb(ctx, x + 33, y + 9, x + 61, y + 37, guardX, guardY, 13);
  limb(ctx, x - 34, y + 13, x - 54, y + 39, handX + 2, handY + 12, 14);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(lean);
  ctx.scale(1.2, 1.2);
  const eyesClosed = !active && elapsed % 3080 > 2830 && elapsed % 3080 < 2990;
  ctx.drawImage(eyesClosed ? rig.blink : rig.head, -95, -69);
  ctx.restore();

  ctx.save();
  ctx.translate(guardX, guardY);
  ctx.rotate(.25 + lean * .7);
  ctx.drawImage(rig.fist, -13, -24);
  ctx.restore();

  ctx.save();
  ctx.translate(handX, handY);
  ctx.rotate(wrist);
  ctx.scale(scale, scale);

  if (!active || pitch < releaseAt) {
    drawTomatoProjectile(ctx, -1, -14, 18);
  } else if (pitch > 1310) {
    const reload = Math.min(1, (pitch - 1310) / 250);
    drawTomatoProjectile(ctx, -1, 2 - 16 * reload, 18 * reload);
  }

  ctx.drawImage(rig.palm, -20, -9);
  ctx.restore();

  if (pitch >= releaseAt && pitch < impactAt) {
    const flight = (pitch - releaseAt) / (impactAt - releaseAt);
    const near = flight * flight;
    ctx.save();
    ctx.translate(105 + 28 * flight, 64 - 16 * Math.sin(Math.PI * flight) + 12 * flight);
    ctx.rotate(.2 + flight * 1.8);
    drawTomatoProjectile(ctx, 0, 0, 23 + near * 45);
    ctx.restore();
  }

  if (pitch >= impactAt && pitch < 1525) {
    const t = pitch - impactAt;
    const spread = Math.min(1, t / 115);
    const vanish = Math.max(0, (t - 260) / 310);
    const size = 1.46 + .33 * Math.sin(spread * Math.PI / 2);
    ctx.save();
    ctx.globalAlpha = 1 - vanish;
    ctx.translate(127, 73 + vanish * 11);
    ctx.drawImage(rig.splat, -64 * size, -47 * size, 128 * size, 94 * size);
    // Detached pips fan away from the pulp on impact.
    ctx.fillStyle = gold;

    for (let i = 0; i < 7; i++) {
      const angle = i * .9 + .3;
      const distance = 42 + spread * 36 + vanish * 18;
      const seedX = Math.round(Math.cos(angle) * distance * 1.18);
      const seedY = Math.round(Math.sin(angle) * distance * .78);
      ctx.fillRect(seedX, seedY, 5, 2);
      ctx.fillRect(seedX + 2, seedY - 1, 3, 1);
    }

    ctx.restore();
  }
}

export function mountMascots() {
  const stages = document.querySelectorAll('.mascot-stage canvas');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let rig;

  for (const canvas of stages) {
    canvas.width = 240;
    canvas.height = 160;
    const ctx = canvas.getContext('2d');

    if (!ctx) continue;
    const stage = canvas.closest('.mascot-stage');
    const trigger = stage.closest('.mascot-trigger') || stage.querySelector('.mascot-trigger');
    let visible = false, timer, since, started, nextPitch;

    function draw() {
      if (document.hidden || !visible) return;
      const now = performance.now();
      const elapsed = now - since;

      if (!reduced.matches && now >= nextPitch) {
        started = now;
        nextPitch = now + 8100;
      }

      const pitch = now - started;
      const active = !reduced.matches && pitch <= finishAt;
      rig ??= makeRig();
      paintPitch(ctx, rig, reduced.matches ? 0 : elapsed, active ? pitch : -1);

      if (!reduced.matches) timer = setTimeout(draw, active ? 40 : 90);
    }

    function refresh() {
      clearTimeout(timer);
      since = performance.now();
      started = -Infinity;
      nextPitch = since + 3400;

      if (trigger) trigger.disabled = reduced.matches;
      draw();
    }

    trigger?.addEventListener('click', () => {
      const now = performance.now();

      if (reduced.matches || !visible || now - started < finishAt) return;
      clearTimeout(timer);
      started = now;
      nextPitch = now + 8100;
      draw();
    });

    // Paint the first screen during mount. IntersectionObserver reports after the first layout.
    const bounds = canvas.getBoundingClientRect();
    visible = bounds.width > 0 && bounds.height > 0 && bounds.bottom > 0 && bounds.right > 0
      && bounds.top < innerHeight && bounds.left < innerWidth;
    refresh();

    const observer = new IntersectionObserver(([entry]) => {
      const inView = entry.isIntersecting && entry.intersectionRatio >= .01;

      if (inView !== visible) {
        visible = inView;
        refresh();
      }
    }, { threshold: .01 });

    observer.observe(canvas);
    document.addEventListener('visibilitychange', refresh);
    reduced.addEventListener('change', refresh);
  }
}
