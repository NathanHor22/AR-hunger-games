import { drawTomatoProjectile } from "./menu-art.js";
import { makeBody, hitBody, drawPaint } from "./public/body.js";

const flightMs = 280;

// undefined keeps the throw open. null closes it as a miss.
export function resolveShot(shot, capturedAt, receivedAt, contact) {
  const age = receivedAt - shot.at;

  if (age > 1050) return null;

  // Allow the whole evidence window for a delayed post-impact dodge. After
  // that, one animation tick can dispatch a stored hit before server expiry.
  if (age > 1000) return shot.beforeImpact?.hit ?? null;

  if (capturedAt == null || capturedAt > receivedAt) return undefined;
  const offset = capturedAt - shot.at - flightMs;

  if (offset < -100 || offset > 145) return undefined;
  const hit = contact();

  if (offset < 0) {
    if (!shot.beforeImpact || offset > shot.beforeImpact.offset)
      shot.beforeImpact = { offset, hit };

    return undefined;
  }

  // Disagreement across impact can mean a dodge or a crossing. Only accept a
  // bracketed contact when both observations name the same player.
  if (
    !hit ||
    (shot.beforeImpact && shot.beforeImpact.hit?.targetId !== hit.targetId)
  )
    return null;

  return shot.beforeImpact && -shot.beforeImpact.offset < offset
    ? shot.beforeImpact.hit
    : hit;
}

function cover(vw, vh, width, height) {
  const scale = Math.max(width / vw, height / vh);

  return {
    width: vw * scale,
    height: vh * scale,
    x: (width - vw * scale) / 2,
    y: (height - vh * scale) / 2,
  };
}

// Match the centered object-fit: cover camera preview exactly, including portrait crops.
export function project(points, vw, vh, width, height) {
  const camera = cover(vw, vh, width, height);

  return points.map((p) => ({
    ...p,
    x: (p.x * camera.width + camera.x) / width,
    y: (p.y * camera.height + camera.y) / height,
    z: (p.z * camera.width) / width,
  }));
}

export function endpoint(start, finger, width, height) {
  const rise = Math.max(1, start.y - finger.y);
  const travel = Math.min(height * 0.89, Math.max(height * 0.23, rise * 2.4));

  return {
    x: start.x + ((finger.x - start.x) * travel) / rise,
    y: start.y - travel,
  };
}

// All masks from one detector result share a resolution. Reserve 0 for
// background and 255 for edges or overlapping silhouettes of uncertain depth.
function ownership(people) {
  const first = people.find((p) => p.mask)?.mask;

  if (!first) return null;
  const owners = new Uint8Array(first.width * first.height);

  for (const [index, person] of people.entries()) {
    const mask = person.mask;

    if (!mask || mask.width !== first.width || mask.height !== first.height)
      continue;

    for (let i = 0; i < owners.length; i++) {
      const confidence = mask.data[i];

      if (confidence > 0.3)
        owners[i] = owners[i] || confidence < 0.6 ? 255 : index + 1;
    }
  }

  return { owners, width: first.width, height: first.height };
}

export function contactAt(people, x, y, camera, mask = ownership(people)) {
  if (!mask) return null;
  const col = Math.floor(((x - camera.x) * mask.width) / camera.width);
  const row = Math.floor(((y - camera.y) * mask.height) / camera.height);

  if (col < 0 || col >= mask.width || row < 0 || row >= mask.height)
    return null;
  const person = people[mask.owners[row * mask.width + col] - 1];

  if (
    !person?.player?.connected ||
    person.player.spectator ||
    person.player.health <= 0
  )
    return null;

  if (people.some((other) => !other.mask && hitBody(other.body, x, y)))
    return null;
  const anchor = hitBody(person.body, x, y);

  return anchor ? { targetId: person.player.id, anchor } : null;
}

function drawStains(ctx, people, mask, camera, silhouette) {
  if (!mask) return;
  silhouette.width = mask.width;
  silhouette.height = mask.height;
  const stencil = silhouette.getContext("2d");
  const alpha = stencil.createImageData(mask.width, mask.height);
  const uncertain = new Path2D();

  for (const person of people) {
    if (person.mask || !person.body) continue;

    for (const face of person.body.visible) {
      const [a, b, c] = face.vertices;
      uncertain.moveTo(a.x, a.y);
      uncertain.lineTo(b.x, b.y);
      uncertain.lineTo(c.x, c.y);
      uncertain.closePath();
    }
  }

  for (const [index, person] of people.entries()) {
    if (!person.body || !person.player?.splats.length || !person.mask) continue;

    for (let i = 0; i < mask.owners.length; i++)
      alpha.data[4 * i + 3] = mask.owners[i] === index + 1 ? 255 : 0;
    stencil.putImageData(alpha, 0, 0);
    drawPaint(ctx, person.body, person.player.splats, (layer) => {
      layer.save();
      layer.globalCompositeOperation = "destination-in";
      layer.drawImage(
        silhouette,
        camera.x,
        camera.y,
        camera.width,
        camera.height,
      );
      layer.globalCompositeOperation = "destination-out";
      layer.fill(uncertain);
      layer.restore();
    });
  }
}

function splatSound(audio, frequency, gain) {
  if (!audio || audio.state !== "running") return;
  const oscillator = audio.createOscillator();
  const volume = audio.createGain();
  oscillator.frequency.setValueAtTime(frequency, audio.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(
    65,
    audio.currentTime + 0.1,
  );
  volume.gain.setValueAtTime(gain, audio.currentTime);
  volume.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.1);
  oscillator.connect(volume).connect(audio.destination);
  oscillator.start();
  oscillator.stop(audio.currentTime + 0.11);
}

// Match peripheral patches instead of following the targeted player's motion.
export function cameraShift(initial, current, camera) {
  if (!initial || !current) return null;

  let lowest = Infinity,
    runnerUp = Infinity,
    dx = 0,
    dy = 0;

  for (let sy = -4; sy <= 4; sy++) {
    for (let sx = -4; sx <= 4; sx++) {
      let diff = 0;

      for (let y = 5; y < 27; y += 2) {
        for (const x of [5, 8, 11, 28, 31, 34]) {
          const a = 4 * (y * 40 + x);
          const b = 4 * ((y + sy) * 40 + x + sx);
          diff += Math.abs(initial[a + 1] - current[b + 1]);
        }
      }

      if (diff < lowest) {
        runnerUp = lowest;
        lowest = diff;
        dx = sx;
        dy = sy;
      } else runnerUp = Math.min(runnerUp, diff);
    }
  }

  if (
    Math.abs(dx) === 4 ||
    Math.abs(dy) === 4 ||
    lowest > 1450 ||
    runnerUp < lowest * 1.12 + 25
  )
    return null;

  return { x: (dx * camera.width) / 40, y: (dy * camera.height) / 32 };
}

export function createArena({
  video,
  canvas,
  launch,
  send,
  message,
  canThrow,
}) {
  const ctx = canvas.getContext("2d");

  let room,
    myId,
    people = [],
    scene = [],
    frameAt = -Infinity,
    animation = 0;

  let shot,
    finger,
    origin,
    nextThrow = 0,
    audio,
    lastHits,
    lastHealth,
    flashUntil = 0;

  let sceneWidth = 0,
    sceneHeight = 0,
    lastPoseTime = -1,
    mask,
    camera,
    frameProbe;

  const pendingShots = new Set();
  let paintDirty = true;

  const overlay = document.createElement("canvas");
  const paint = overlay.getContext("2d");
  const silhouette = document.createElement("canvas");
  const sample = document.createElement("canvas");
  sample.width = 40;
  sample.height = 32;
  const probe = sample.getContext("2d", { willReadFrequently: true });

  function pixels() {
    if (!video.videoWidth || video.readyState < 2) return null;
    probe.drawImage(video, 0, 0, 40, 32);

    return probe.getImageData(0, 0, 40, 32).data;
  }

  function setState(next, id) {
    const me = next.players.find((p) => p.id === id);

    if (!room || next.round !== room.round || next.code !== room.code) {
      shot = null;
      pendingShots.clear();
      nextThrow = 0;
      lastHits = me?.hits;
      lastHealth = me?.health;
    }

    if (me?.hits > lastHits) {
      splatSound(audio, 360, 0.07);
      message("Hit!");
    }

    if (me?.health < lastHealth) {
      flashUntil = performance.now() + 260;
      message("You took a hit");
    }

    lastHits = me?.hits;
    lastHealth = me?.health;
    room = next;
    myId = id;
    lastPoseTime = -1;
  }

  function prepareScene(width, height) {
    if (!width || !height || !video.videoWidth) {
      scene = [];
      mask = null;

      return;
    }

    if (
      lastPoseTime === frameAt &&
      sceneWidth === width &&
      sceneHeight === height
    )
      return;
    scene = [];
    camera = cover(video.videoWidth, video.videoHeight, width, height);

    for (const person of people) {
      const points = project(
        person.landmarks,
        video.videoWidth,
        video.videoHeight,
        width,
        height,
      );

      const body = makeBody(points, person.worldLandmarks, width, height);
      scene.push({
        body,
        points,
        mask: person.mask,
        player: room?.players.find((p) => p.id === person.id && p.id !== myId),
      });
    }

    lastPoseTime = frameAt;
    sceneWidth = width;
    sceneHeight = height;
    mask = ownership(scene);
    paintDirty = true;
  }

  function settleShots(capturedAt, receivedAt) {
    for (const pending of pendingShots) {
      const hit = resolveShot(pending, capturedAt, receivedAt, () => {
        const width = canvas.clientWidth,
          height = canvas.clientHeight;

        if (
          pending.width !== width ||
          pending.height !== height ||
          pending.videoWidth !== video.videoWidth ||
          pending.videoHeight !== video.videoHeight ||
          !people.length
        )
          return null;
        prepareScene(width, height);
        const shift = cameraShift(pending.pixels, frameProbe, camera);

        return (
          shift &&
          contactAt(
            scene,
            pending.to.x + shift.x,
            pending.to.y + shift.y,
            camera,
            mask,
          )
        );
      });

      if (hit === undefined) continue;
      pendingShots.delete(pending);

      if (hit)
        send({
          type: "impact",
          round: pending.round,
          shotId: pending.id,
          ...hit,
        });
    }
  }

  function draw(time) {
    settleShots(null, performance.now());

    const width = canvas.clientWidth,
      height = canvas.clientHeight;

    if (!width || !height) {
      animation = requestAnimationFrame(draw);

      return;
    }

    const ratio = Math.min(devicePixelRatio || 1, 1.75);

    if (
      canvas.width !== Math.round(width * ratio) ||
      canvas.height !== Math.round(height * ratio)
    ) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const visible = time - frameAt <= 380 && video.videoWidth;

    if (visible) prepareScene(width, height);

    if (visible && paintDirty) {
      paintDirty = false;

      if (overlay.width !== width || overlay.height !== height) {
        overlay.width = width;
        overlay.height = height;
      }

      paint.clearRect(0, 0, width, height);

      if (scene.some((p) => p.player?.splats.length))
        drawStains(paint, scene, mask, camera, silhouette);
    }

    if (visible && scene.length) ctx.drawImage(overlay, 0, 0);

    for (const item of visible ? scene : []) {
      const { player, body, points } = item;

      if (!player || !body) continue;

      const x = Math.max(
        46,
        Math.min(width - 46, (points[11].x + points[12].x) * width * 0.5),
      );

      const y = Math.max(
        24,
        Math.min(
          height - 24,
          Math.min(points[11].y, points[12].y) * height - 12,
        ),
      );

      ctx.fillStyle = "#251b35";
      ctx.font = "bold 14px Consolas, monospace";
      ctx.textAlign = "center";

      const box = Math.max(
        76,
        Math.min(170, ctx.measureText(player.name).width + 16),
      );

      ctx.fillRect(x - box / 2, y - 21, box, 29);
      ctx.fillStyle = "#fff2d2";
      ctx.fillText(player.name, x, y - 6, box - 8);
      ctx.fillStyle = player.color;

      for (let i = 0; i < player.health; i++)
        ctx.fillRect(
          x - box / 2 + 4 + (i * (box - 8)) / 10,
          y,
          Math.max(1, (box - 8) / 10 - 1),
          4,
        );
    }

    if (origin && finger) {
      const to = endpoint(origin, finger, width, height);
      ctx.strokeStyle = "#fff3bf";
      ctx.setLineDash([3, 7]);
      ctx.beginPath();
      ctx.moveTo(origin.x, origin.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (shot && time - shot.at >= flightMs) shot = null;

    if (shot) {
      const t = Math.min(1, (time - shot.at) / flightMs);

      if (camera && frameAt > shot.at && shot.poseAt !== frameAt) {
        shot.poseAt = frameAt;
        shot.shift = cameraShift(shot.pixels, frameProbe, camera);
      }

      const x =
        shot.from.x + t * (shot.to.x - shot.from.x + (shot.shift?.x ?? 0));

      const y =
        shot.from.y +
        t * (shot.to.y - shot.from.y + (shot.shift?.y ?? 0)) -
        Math.sin(t * Math.PI) * height * 0.05;

      drawTomatoProjectile(ctx, x, y, 20 - 12 * t);
    }

    if (time < flashUntil) {
      ctx.fillStyle = "#ff412429";
      ctx.fillRect(0, 0, width, height);
    }

    animation = requestAnimationFrame(draw);
  }

  function fire(from, to) {
    const now = performance.now();

    if (!canThrow() || now < nextThrow) return;
    const id = crypto.randomUUID();

    if (!send({ type: "throw", round: room.round, shotId: id })) return;
    nextThrow = now + 410;
    shot = {
      id,
      round: room.round,
      from,
      to,
      at: now,
      pixels: pixels(),
      width: canvas.clientWidth,
      height: canvas.clientHeight,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
    };
    pendingShots.add(shot);
    splatSound(audio, 190, 0.04);
  }

  function local(e) {
    const box = canvas.getBoundingClientRect();

    return { x: e.clientX - box.left, y: e.clientY - box.top };
  }

  launch.addEventListener("pointerdown", (e) => {
    if (!e.isPrimary || e.button !== 0 || !canThrow()) return;

    if (globalThis.AudioContext) {
      audio ??= new AudioContext();
      audio.resume().catch(() => {});
    }

    launch.setPointerCapture(e.pointerId);
    origin = local(e);
    finger = origin;
  });
  launch.addEventListener("pointermove", (e) => {
    if (origin && e.isPrimary) finger = local(e);
  });
  launch.addEventListener("pointerup", (e) => {
    if (!origin || !e.isPrimary) return;
    const end = local(e);

    if (origin.y - end.y > 12)
      fire(
        origin,
        endpoint(origin, end, canvas.clientWidth, canvas.clientHeight),
      );
    else message("Flick the tomato upward to throw");
    origin = finger = null;
  });
  launch.addEventListener("lostpointercapture", () => {
    origin = finger = null;
  });
  launch.addEventListener("click", (e) => {
    if (e.detail === 0)
      fire(
        { x: canvas.clientWidth / 2, y: canvas.clientHeight * 0.88 },
        { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 },
      );
  });

  return {
    setState,
    setPeople(value, capturedAt = performance.now(), capturedProbe) {
      people = value;
      frameAt = capturedAt;
      frameProbe = capturedProbe ?? null;
      settleShots(capturedAt, performance.now());
    },
    start() {
      if (!animation) animation = requestAnimationFrame(draw);
    },
    stop() {
      cancelAnimationFrame(animation);
      animation = 0;
      scene = [];
      people = [];
      shot = null;
      pendingShots.clear();
      origin = finger = null;
      lastPoseTime = -1;
    },
  };
}
