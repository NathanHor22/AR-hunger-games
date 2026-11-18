import assert from "node:assert/strict";
import test from "node:test";
import { project, contactAt } from "../arena.js";
import { makeBody } from "../public/body.js";

const camera = { x: -160, y: 0, width: 640, height: 480 };

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

test("a direct tap opens identification for an unbound visible track without awarding paint", () => {
  const person = { ...contestant(""), player: null, trackId: 7 };
  assert.deepEqual(contactAt([person], 140, 186, camera), { trackId: 7 });
  assert.equal(
    contactAt([{ ...person, trackId: null }], 140, 186, camera),
    null,
  );
  assert.equal(contactAt([{ ...person, mask: null }], 140, 186, camera), null);
});
