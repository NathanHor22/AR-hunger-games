import { makeBody, hitBody, drawPaint } from "./public/body.js";
import { ownership, clearlyInFront } from "./public/depth.js";
import { drawNameplates } from "./public/nameplate.js";
import { sprayIntervalMs } from "./public/ink.js";

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

  if (!person) return null;

  if (
    people.some(
      (other) =>
        !other.mask &&
        !clearlyInFront(person.body, other.body) &&
        hitBody(other.body, x, y),
    )
  )
    return null;

  if (!person.player)
    return person.trackId != null ? { trackId: person.trackId } : null;

  if (
    !person.player.connected ||
    person.player.spectator ||
    person.player.health <= 0
  )
    return null;

  const anchor = hitBody(
    person.body,
    x,
    y,
    Math.min(24, (person.body?.radius ?? 0) * 0.32),
  );

  return anchor ? { targetId: person.player.id, anchor } : null;
}

function drawStains(ctx, people, mask, camera, silhouette) {
  if (!mask) return;
  silhouette.width = mask.width;
  silhouette.height = mask.height;
  const stencil = silhouette.getContext("2d");
  const alpha = stencil.createImageData(mask.width, mask.height);
  const unmasked = people.filter((person) => !person.mask && person.body);

  for (const [index, person] of people.entries()) {
    if (!person.body || !person.player?.splats.length || !person.mask) continue;
    const uncertain = new Path2D();

    for (const other of unmasked) {
      if (clearlyInFront(person.body, other.body)) continue;

      for (const {
        vertices: [a, b, c],
      } of other.body.visible) {
        uncertain.moveTo(a.x, a.y);
        uncertain.lineTo(b.x, b.y);
        uncertain.lineTo(c.x, c.y);
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

// Render fresh paint on the anchored body immediately after the server acknowledges it.
// The brief local spray animation also makes contact visible during a network round trip.
function drawSpray(ctx, burst, point, age, width, height, reducedMotion) {
  const fade = Math.max(0, 1 - age / 290);
  ctx.save();
  ctx.fillStyle = burst.color;
  ctx.strokeStyle = burst.color;

  if (!reducedMotion && age < 110) {
    const progress = age / 110;

    const fromX = width * 0.6,
      fromY = height + 12;

    for (let i = 0; i < 5; i++) {
      const t = progress * 0.65 + i * 0.105;

      if (t > 1) continue;
      const x = fromX + (point.x - fromX) * t;
      const y = fromY + (point.y - fromY) * t;
      ctx.globalAlpha = 0.54 * t;
      ctx.beginPath();
      ctx.ellipse(
        x,
        y,
        2 + (1 - t) * 4,
        3 + (1 - t) * 7,
        Math.atan2(fromY - point.y, fromX - point.x) - Math.PI / 2,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }

  ctx.globalAlpha = fade * (burst.hit ? 0.92 : 0.52);
  const radius = burst.hit ? burst.radius : 6;
  const spread = reducedMotion ? 1 : 0.65 + Math.min(1, age / 100) * 0.5;

  if (burst.hit) {
    ctx.beginPath();

    for (let i = 0; i < 20; i++) {
      const angle = (i * Math.PI) / 10 + burst.phase;

      const r =
        radius *
        spread *
        (0.72 +
          0.25 * Math.sin(5 * angle + burst.phase) +
          0.14 * Math.cos(7 * angle));

      const x = point.x + Math.cos(angle) * r;
      const y = point.y + Math.sin(angle) * r * 0.8;

      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }

    ctx.closePath();
    ctx.fill();
  }

  for (let i = 0; i < 5; i++) {
    const angle = burst.phase + 2.4 * i;
    const r = radius * (spread + (reducedMotion ? 0.1 : age / 250));
    ctx.beginPath();
    ctx.arc(
      point.x + Math.cos(angle) * r,
      point.y + Math.sin(angle) * r,
      Math.max(1.3, radius * (i % 2 ? 0.11 : 0.16)),
      0,
      2 * Math.PI,
    );
    ctx.fill();
  }

  ctx.restore();
}

function anchoredPoint(scene, burst) {
  if (!burst.hit) return burst;
  const person = scene.find((p) => p.player?.id === burst.hit.targetId);
  const { triangle, u, v } = burst.hit.anchor;
  const face = person?.body?.faces[triangle];

  if (!face || face.area >= -0.1) return null;
  const [a, b, c] = face.vertices;

  return {
    x: a.x + (b.x - a.x) * u + (c.x - a.x) * v,
    y: a.y + (b.y - a.y) * u + (c.y - a.y) * v,
  };
}

export function createArena({
  video,
  canvas,
  send,
  message,
  canSpray,
  canIdentify = canSpray,
  onIdentify,
}) {
  const ctx = canvas.getContext("2d");
  const overlay = document.createElement("canvas");
  const paint = overlay.getContext("2d");
  const silhouette = document.createElement("canvas");

  const controls = [
    document.querySelector(".round-hud"),
    document.getElementById("leave"),
  ];

  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const bursts = [];

  let room,
    myId,
    people = [],
    scene = [],
    nameTags = [],
    camera,
    mask,
    reserved = [];

  let frameAt = -Infinity,
    deliveredAt = -Infinity,
    lastPose = -Infinity;

  let sceneWidth = 0,
    sceneHeight = 0,
    paintDirty = true,
    animation = 0;

  let pressing = null,
    keyboardAim,
    nextAt = 0,
    audio;

  let inkedUntil = 0,
    inkedColor = "#76ec75";

  function clearInput() {
    pressing = null;
  }

  function setState(next, id) {
    if (!room || next.code !== room.code || next.round !== room.round) {
      bursts.length = 0;
      clearInput();
      keyboardAim = null;
      nextAt = inkedUntil = 0;
    }

    room = next;
    myId = id;

    for (const person of scene) {
      person.player = room.players.find(
        (p) => p.id === person.id && p.id !== myId,
      );
    }

    paintDirty = true;

    if (next.phase !== "playing") clearInput();
  }

  function prepareScene(width, height) {
    if (lastPose === frameAt && width === sceneWidth && height === sceneHeight)
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
        trackId: person.trackId,
        id: person.id,
        player: room?.players.find((p) => p.id === person.id && p.id !== myId),
      });
    }

    lastPose = frameAt;
    sceneWidth = width;
    sceneHeight = height;
    reserved = controls.map((control) => control.getBoundingClientRect());
    mask = ownership(scene);
    paintDirty = true;
  }

  function fresh(now) {
    return (
      video.videoWidth > 0 &&
      video.videoHeight > 0 &&
      now - frameAt <= 700 &&
      now - deliveredAt <= 450
    );
  }

  function spray(point, now, initial = false) {
    const armed = canSpray();

    if ((!armed && !(initial && canIdentify())) || now < nextAt) return;
    nextAt = now + sprayIntervalMs;

    const width = canvas.clientWidth,
      height = canvas.clientHeight;

    let hit = null;

    if (width && height && fresh(now)) {
      prepareScene(width, height);

      const tag = initial && nameTags.find(({ left, right, top, bottom, trackId }) =>
        point.x >= left && point.x <= right && point.y >= top && point.y <= bottom &&
        scene.some((person) => person.trackId === trackId && !person.player));

      hit = tag ? { trackId: tag.trackId } : contactAt(scene, point.x, point.y, camera, mask);
    }

    if (hit?.trackId != null) {
      clearInput();

      if (initial) onIdentify(hit.trackId);
      else message("Tap this player to identify them.");

      return;
    }

    if (!armed) return;

    if (!hit && initial && (!fresh(now) || !scene.length))
      message("Frame the player’s upper body, then tap them.");
    let color = room.players.find((p) => p.id === myId)?.color || "#fff2d2";
    let radius = 8;

    if (hit) {
      const target = scene.find((p) => p.player?.id === hit.targetId);
      const { triangle, u, v } = hit.anchor;

      if (
        !send({
          type: "spray",
          round: room.round,
          shotId: crypto.randomUUID(),
          targetId: hit.targetId,
          anchor: { triangle, u, v },
        })
      )
        return;
      color = target.player.color;
      radius = Math.max(12, Math.min(34, target.body.radius * 0.34));
    }

    bursts.push({
      ...point,
      at: now,
      color,
      radius,
      phase: Math.random() * Math.PI * 2,
      hit,
    });
    splatSound(audio, hit ? 335 : 205, hit ? 0.037 : 0.017);
  }

  function draw(time) {
    const width = canvas.clientWidth,
      height = canvas.clientHeight;

    if (!width || !height) {
      clearInput();
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

    if (pressing && !canSpray()) clearInput();

    if (pressing) spray(pressing, time);
    const visible = fresh(time);

    if (visible) {
      prepareScene(width, height);

      if (paintDirty) {
        paintDirty = false;

        if (overlay.width !== width || overlay.height !== height) {
          overlay.width = width;
          overlay.height = height;
        }

        paint.clearRect(0, 0, width, height);

        if (scene.some((p) => p.player?.splats.length))
          drawStains(paint, scene, mask, camera, silhouette);
      }

      if (scene.length) ctx.drawImage(overlay, 0, 0);
    }

    while (bursts.length && time - bursts[0].at >= 290) bursts.shift();

    for (const burst of bursts) {
      const point = anchoredPoint(visible ? scene : [], burst);

      if (point)
        drawSpray(
          ctx,
          burst,
          point,
          Math.max(0, time - burst.at),
          width,
          height,
          motion.matches,
        );
    }

    if (time < inkedUntil) {
      // Steady wet paint on the screen edge communicates hits on one's own back-facing camera.
      ctx.save();
      ctx.globalAlpha = 0.74 * Math.min(1, (inkedUntil - time) / 350);
      ctx.fillStyle = inkedColor;
      ctx.fillRect(0, 0, 6, height);

      for (const [y, size] of [
        [0.38, 20],
        [0.42, 11],
        [0.63, 14],
      ]) {
        ctx.beginPath();
        ctx.ellipse(0, height * y, size, size * 1.55, -0.18, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }

    nameTags = visible ? drawNameplates(ctx, scene, width, height, reserved) : [];

    if (keyboardAim) {
      ctx.save();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.shadowColor = "#211731";
      ctx.shadowBlur = 3;
      ctx.beginPath();
      ctx.arc(keyboardAim.x, keyboardAim.y, 9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    animation = requestAnimationFrame(draw);
  }

  function local(e) {
    const rect = canvas.getBoundingClientRect();

    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function enableAudio() {
    if (globalThis.AudioContext) {
      audio ??= new AudioContext();

      if (audio.state === "suspended") void audio.resume().catch(() => {});
    }
  }

  canvas.addEventListener("touchstart", (e) => e.preventDefault(), {
    passive: false,
  });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("pointerdown", (e) => {
    if (!e.isPrimary || e.button !== 0 || pressing || !(canSpray() || canIdentify())) return;
    keyboardAim = null;
    enableAudio();
    canvas.setPointerCapture(e.pointerId);
    pressing = { id: e.pointerId, ...local(e) };
    spray(pressing, performance.now(), true);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (pressing?.id === e.pointerId) Object.assign(pressing, local(e));
  });

  function release(e) {
    if (pressing?.id === e.pointerId) clearInput();
  }

  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  canvas.addEventListener("lostpointercapture", release);
  canvas.addEventListener("keydown", (e) => {
    const arrows = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];

    if (![...arrows, " ", "Enter"].includes(e.key) || !(canSpray() || canIdentify())) return;
    e.preventDefault();
    keyboardAim ??= { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 };

    if (arrows.includes(e.key)) {
      const step = e.shiftKey ? 5 : 24;
      keyboardAim.x = Math.max(
        0,
        Math.min(
          canvas.clientWidth - 1,
          keyboardAim.x +
            step * ((e.key === "ArrowRight") - (e.key === "ArrowLeft")),
        ),
      );
      keyboardAim.y = Math.max(
        0,
        Math.min(
          canvas.clientHeight - 1,
          keyboardAim.y +
            step * ((e.key === "ArrowDown") - (e.key === "ArrowUp")),
        ),
      );

      if (pressing?.id === "keyboard") Object.assign(pressing, keyboardAim);
    } else if (!e.repeat && !pressing) {
      enableAudio();
      pressing = { id: "keyboard", ...keyboardAim };
      spray(pressing, performance.now(), true);
    }
  });
  canvas.addEventListener("keyup", (e) => {
    if (pressing?.id === "keyboard" && (e.key === " " || e.key === "Enter"))
      clearInput();
  });
  canvas.addEventListener("click", (e) => {
    if (e.detail === 0 && (canSpray() || canIdentify()))
      spray(
        keyboardAim || {
          x: canvas.clientWidth / 2,
          y: canvas.clientHeight / 2,
        },
        performance.now(),
        true,
      );
  });
  canvas.addEventListener("blur", () => {
    keyboardAim = null;
    clearInput();
  });
  window.addEventListener("blur", clearInput);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) clearInput();
  });

  return {
    setState,
    receivePaint(event) {
      if (room?.phase !== "playing" || room.code !== event.code ||
          room.round !== event.round || event.targetId !== myId) return;
      const me = room.players.find((p) => p.id === myId);

      if (!me) return;
      const now = performance.now();

      if (now >= inkedUntil) message("You’ve been inked!");
      inkedUntil = now + 1150;
      inkedColor = me.color;
    },
    setPeople(value, capturedAt = performance.now()) {
      people = value;
      frameAt = capturedAt;
      // Naming a player can republish the same capture with a new identity.
      lastPose = -Infinity;
      deliveredAt = performance.now();
    },
    start() {
      if (!animation) animation = requestAnimationFrame(draw);
    },
    stop() {
      cancelAnimationFrame(animation);
      animation = 0;
      clearInput();
      keyboardAim = null;
      scene = [];
      nameTags = [];
      people = [];
      mask = null;
      bursts.length = 0;
      frameAt = deliveredAt = lastPose = -Infinity;
      inkedUntil = 0;
    },
  };
}
