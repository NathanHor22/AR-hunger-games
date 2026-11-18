import assert from "node:assert/strict";
import test from "node:test";
import {
  project,
  endpoint,
  contactAt,
  cameraShift,
  resolveShot,
  flightProfile,
} from "../arena.js";
import { makeBody } from "../public/body.js";

const camera = { x: -160, y: 0, width: 640, height: 480 };

test("larger projected bodies meet the fruit sooner and at a larger size", () => {
  const near = flightProfile(72, 1100);
  const far = flightProfile(72, 190);
  assert.equal(near.startRadius, 72);
  assert.ok(near.endRadius > far.endRadius && near.duration < far.duration);
  const hit = { targetId: "red" };
  const shot = { at:1000, ...far };
  assert.equal(resolveShot(shot, 1260, 1300, () => hit), undefined);
  assert.equal(resolveShot(shot, 1000 + far.duration, 1450, () => hit), hit);
});

test("a frame captured at impact still scores after delayed inference", () => {
  const shot = { at: 1000 };
  const hit = { targetId: "red" };
  assert.equal(resolveShot(shot, null, 1451), undefined);
  assert.equal(
    resolveShot(shot, 1290, 1710, () => hit),
    hit,
  );
});

test("an eligible early frame survives slow inference and a late animation callback", () => {
  const shot = { at: 1000 };
  const hit = { targetId: "blue" };
  assert.equal(
    resolveShot(shot, 1220, 1790, () => hit),
    undefined,
  );
  assert.equal(resolveShot(shot, null, 1910), undefined);
  assert.equal(resolveShot(shot, null, 1931), undefined);
  assert.equal(resolveShot(shot, null, 2007), hit);
});

test("a late post-impact miss cancels the stored earlier hit", () => {
  const shot = { at: 1000 };
  assert.equal(
    resolveShot(shot, 1220, 1750, () => ({ targetId: "red" })),
    undefined,
  );
  assert.equal(resolveShot(shot, null, 1925), undefined);
  assert.equal(
    resolveShot(shot, 1310, 1930, () => null),
    null,
  );
});

test("capture outside the impact window or delivered outside the deadline cannot score", () => {
  const shot = { at: 1000 };
  const unexpected = () => assert.fail("ineligible frame was scored");
  assert.equal(resolveShot(shot, 1110, 1500, unexpected), undefined);
  assert.equal(resolveShot(shot, 1440, 1650, unexpected), undefined);
  assert.equal(resolveShot(shot, 1300, 2010, unexpected), null);
  assert.equal(resolveShot(shot, 1300, 1200, unexpected), undefined);
  assert.equal(
    resolveShot(
      { at: 1000, beforeImpact: { offset: -25, hit: { targetId: "blue" } } },
      null,
      2200,
    ),
    null,
  );
});

test("crossings or dodges bracketing impact close the throw as a miss", () => {
  const shot = { at: 1000 };
  assert.equal(
    resolveShot(shot, 1250, 1400, () => ({ targetId: "red" })),
    undefined,
  );
  assert.equal(
    resolveShot(shot, 1300, 1530, () => ({ targetId: "blue" })),
    null,
  );
  assert.equal(
    resolveShot(shot, 1300, 1530, () => null),
    null,
  );
});

function contestant(id, confidence = 1) {
  const marks = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 1,
  }));

  for (const [i, x, y] of [
    [11, 0.64, 0.25],
    [12, 0.36, 0.25],
    [23, 0.59, 0.7],
    [24, 0.41, 0.7],
  ]) {
    marks[i].x = x;
    marks[i].y = y;
  }

  const body = makeBody(project(marks, 640, 480, 320, 480), null, 320, 480);

  const mask = {
    width: 4,
    height: 4,
    data: new Float32Array(16).fill(confidence),
  };

  return {
    body,
    mask,
    player: { id, connected: true, spectator: false, health: 10 },
  };
}

test("camera cover crops each axis around the center without distorting the body", () => {
  const marks = [
    { x: 0.25, y: 0.25, z: 0.1 },
    { x: 0.75, y: 0.75, z: 0 },
  ];

  const portrait = project(marks, 640, 480, 320, 480);
  assert.deepEqual(portrait[0], { x: 0, y: 0.25, z: 0.2 });
  assert.deepEqual(portrait[1], { x: 1, y: 0.75, z: 0 });
  const landscape = project(marks, 640, 480, 640, 240);
  assert.deepEqual(landscape[0], { x: 0.25, y: 0, z: 0.1 });
});

test("upward swipes retain direction and have bounded vertical travel", () => {
  const start = { x: 100, y: 450 };
  const straight = endpoint(start, { x: 100, y: 350 }, 320, 480);
  const angled = endpoint(start, { x: 150, y: 350 }, 320, 480);
  assert.deepEqual(straight, { x: 100, y: 210 });
  assert.deepEqual(angled, { x: 220, y: 210 });
  assert.ok(endpoint(start, { x: 100, y: -900 }, 320, 480).y > 0);
});

test("contact needs a visible triangle and matching silhouette in uncropped camera space", () => {
  const player = contestant("red", 0);
  // CSS x=140 maps back to source x=300, in mask column 1.
  player.mask.data[1 * 4 + 1] = 1;
  assert.equal(contactAt([player], 140, 186, camera)?.targetId, "red");
  assert.equal(contactAt([player], 175, 186, camera), null);
  assert.equal(contactAt([player], 140, 14, camera), null);
  assert.equal(contactAt([{ ...player, mask: null }], 140, 186, camera), null);
  assert.equal(
    contactAt([{ ...player, player: null }], 140, 186, camera),
    null,
  );
  player.player.health = 0;
  assert.equal(contactAt([player], 140, 186, camera), null);
});

test("a second silhouette blocks paint even if its pose or identity is missing", () => {
  const first = contestant("red"),
    other = contestant("blue", 0.45);

  assert.equal(contactAt([first, other], 140, 186, camera), null);
  assert.equal(
    contactAt(
      [first, { ...other, body: null, player: null }],
      140,
      186,
      camera,
    ),
    null,
  );
  assert.equal(
    contactAt([first, { ...other, mask: null }], 140, 186, camera),
    null,
  );
  other.mask.data.fill(0);
  assert.equal(contactAt([first, other], 140, 186, camera)?.targetId, "red");
});

function background(dx, dy) {
  const probe = new Uint8ClampedArray(40 * 32 * 4);

  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 40; x++) {
      const col = x - dx,
        row = y - dy;

      probe[(y * 40 + x) * 4 + 1] = Math.abs(
        (col * 13 + row * 51 + col * row * 7) % 255,
      );
    }

  return probe;
}

test("camera pan carries a throw in the same direction as stationary background features", () => {
  const start = background(0, 0);
  assert.deepEqual(cameraShift(start, start, camera), { x: 0, y: 0 });
  assert.deepEqual(cameraShift(start, background(2, -1), camera), {
    x: 32,
    y: -15,
  });
  assert.equal(cameraShift(start, background(4, 0), camera), null);
  assert.equal(
    cameraShift(
      new Uint8ClampedArray(5120),
      new Uint8ClampedArray(5120),
      camera,
    ),
    null,
  );
});
