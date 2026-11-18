import { drawTomatoProjectile } from "./menu-art.js";
import { makeBody, hitBody, drawPaint } from "./public/body.js";
import { ownership, clearlyInFront } from "./public/depth.js";
import { drawNameplates } from "./public/nameplate.js";

const flightMs = 280;

export function flightProfile(startRadius, pixelsPerMeter) {
  // Project a palm-sized fruit onto the same local scale as the tracked body.
  const endRadius = Math.min(startRadius * .68, Math.max(4, pixelsPerMeter > 0
    ? pixelsPerMeter * .04 : startRadius * .10));

  const duration = Math.round(390 - 240 * endRadius / startRadius);

  return { startRadius, endRadius, duration };
}

// undefined keeps the throw open. null closes it as a miss.
export function resolveShot(shot, capturedAt, receivedAt, contact) {
  const age = receivedAt - shot.at;

  if (age > 1050) return null;

  // Allow the whole evidence window for a delayed post-impact dodge. After
  // that, one animation tick can dispatch a stored hit before server expiry.
  if (age > 1000) return shot.beforeImpact?.hit ?? null;

  if (capturedAt == null || capturedAt > receivedAt) return undefined;
  const offset = capturedAt - shot.at - (shot.duration ?? flightMs);

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

function surfaceAt(people, x, y, camera, mask) {
  if (!mask) return null;
  const col = Math.floor(((x - camera.x) * mask.width) / camera.width);
  const row = Math.floor(((y - camera.y) * mask.height) / camera.height);

  if (col < 0 || col >= mask.width || row < 0 || row >= mask.height)
    return null;

  return people[mask.owners[row * mask.width + col] - 1];
}

export function contactAt(people, x, y, camera, mask = ownership(people)) {
  const person = surfaceAt(people, x, y, camera, mask);

  if (
    !person?.player?.connected ||
    person.player.spectator ||
    person.player.health <= 0
  )
    return null;

  if (people.some((other) => !other.mask && !clearlyInFront(person.body, other.body) && hitBody(other.body, x, y)))
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
  const unmasked = people.filter(person => !person.mask && person.body);

  for (const [index, person] of people.entries()) {
    if (!person.body || !person.player?.splats.length || !person.mask) continue;
    const uncertain = new Path2D();

    for (const other of unmasked) {
      if (clearlyInFront(person.body, other.body)) continue;

      for (const {vertices: [a,b,c]} of other.body.visible) {
        uncertain.moveTo(a.x,a.y);
        uncertain.lineTo(b.x,b.y);
        uncertain.lineTo(c.x,c.y);
        uncertain.closePath();
      }
    }

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
  const held = launch.querySelector("canvas");
  drawTomatoProjectile(held.getContext("2d"), held.width / 2, held.height / 2, held.width / 2);
  const controls = [document.querySelector(".round-hud"), document.getElementById("leave")];
  let reserved = [];

  let room,
    myId,
    people = [],
    scene = [],
    frameAt = -Infinity,
    animation = 0;

  let shot,
    grip,
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
      grip = null;
      delete launch.dataset.empty;
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
    reserved = controls.map(control => control.getBoundingClientRect());
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

    if (visible) drawNameplates(ctx, scene, width, height, reserved);

    if (grip && !canThrow()) grip = null;

    if (shot && time - shot.at >= shot.duration) shot = null;

    if (grip) {
      drawTomatoProjectile(ctx, grip.center.x, grip.center.y, grip.radius);
    } else if (shot) {
      const t = Math.max(0, (time - shot.at) / shot.duration);

      if (camera && frameAt > shot.at && shot.poseAt !== frameAt) {
        shot.poseAt = frameAt;
        shot.shift = cameraShift(shot.pixels, frameProbe, camera);
      }

      // Interpolate inverse depth so the fruit recedes quickly on leaving the hand.
      const radius = 1 / ((1 - t) / shot.startRadius + t / shot.endRadius);
      const x = shot.from.x + t * (shot.to.x - shot.from.x + (shot.shift?.x ?? 0));

      const y = shot.from.y + t * (shot.to.y - shot.from.y + (shot.shift?.y ?? 0))
        - Math.sin(t * Math.PI) * height * .045;

      drawTomatoProjectile(ctx, x, y, radius);
    } else if (launch.dataset.empty && time >= nextThrow) {
      delete launch.dataset.empty;
    }

    if (time < flashUntil) {
      ctx.fillStyle = "#ff412429";
      ctx.fillRect(0, 0, width, height);
    }

    animation = requestAnimationFrame(draw);
  }

  function fire(from, to, radius) {
    const now = performance.now();

    if (!canThrow() || now < nextThrow) return;
    const id = crypto.randomUUID();

    if (!send({ type: "throw", round: room.round, shotId: id })) return;
    const width = canvas.clientWidth, height = canvas.clientHeight;
    let scale;

    if (now - frameAt <= 380) {
      prepareScene(width, height);
      scale = surfaceAt(scene, to.x, to.y, camera, mask)?.body?.pixelsPerMeter;
    }

    nextThrow = now + 410;
    launch.dataset.empty = "true";
    shot = {
      id, round: room.round, from, to, at: now, width, height,
      ...flightProfile(radius, scale),
      pixels: pixels(),
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
    };
    pendingShots.add(shot);
    splatSound(audio, 190, 0.04);
  }

  function handPosition() {
    const fruit = held.getBoundingClientRect();
    const view = canvas.getBoundingClientRect();

    return { x: fruit.left - view.left + fruit.width / 2, y: fruit.top - view.top + fruit.height / 2,
      radius: fruit.width / 2 };
  }

  function moveFruit(e) {
    grip.center.x = grip.home.x + e.clientX - grip.touchX;
    grip.center.y = grip.home.y + e.clientY - grip.touchY;
  }

  // The fruit owns touch gestures. Keep the browser from interpreting a fast
  // throw as a fling and consuming the first tap on the following screen.
  launch.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
  launch.addEventListener("pointerdown", (e) => {
    if (!e.isPrimary || e.button !== 0 || grip || !canThrow() || performance.now() < nextThrow) return;

    if (globalThis.AudioContext) {
      audio ??= new AudioContext();
      audio.resume().catch(() => {});
    }

    const home = handPosition();
    grip = { id: e.pointerId, home, center: { x: home.x, y: home.y }, radius: home.radius,
      touchX: e.clientX, touchY: e.clientY };
    launch.setPointerCapture(e.pointerId);
    launch.dataset.empty = "true";
  });
  launch.addEventListener("pointermove", (e) => {
    if (grip?.id === e.pointerId) moveFruit(e);
  });
  launch.addEventListener("pointerup", (e) => {
    if (grip?.id !== e.pointerId) return;
    moveFruit(e);
    const { home, center, radius } = grip;
    grip = null;

    if (home.y - center.y > 12) {
      fire(center, endpoint(home, center, canvas.clientWidth, canvas.clientHeight), radius);
    }
  });

  function cancelGrip(e) {
    if (grip?.id === e.pointerId) grip = null;
  }

  launch.addEventListener("pointercancel", cancelGrip);
  launch.addEventListener("lostpointercapture", cancelGrip);
  launch.addEventListener("click", (e) => {
    if (e.detail !== 0 || !canThrow()) return;
    const home = handPosition();
    fire(home, { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 }, home.radius);
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
      grip = null;
      delete launch.dataset.empty;
      lastPoseTime = -1;
    },
  };
}
