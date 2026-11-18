import assert from "node:assert/strict";
import test from "node:test";
import { hitBody, makeBody, stainRadiusScale } from "../public/body.js";

test("successive nearby impacts cover a progressively larger local body surface", () => {
  const previous = [];
  let area = 0;

  for (let i = 0; i < 8; i++) {
    const radius = stainRadiusScale(previous, 0.1, 0.5, 0);
    assert.ok(radius * radius > area);
    area = radius * radius;
    previous.push({ s: 7.95, t: 0.5 });
  }

  assert.ok(area > 4);
  assert.equal(stainRadiusScale(previous, 4, 0.5, 0), 1);
  assert.equal(stainRadiusScale(previous, 0.1, 0.96, 0), 1);
  assert.ok(stainRadiusScale([...previous, ...previous], 0.1, 0.5, 0) <= 2.45);
});

function pose(direction = 1, offset = 0) {
  const landmarks = Array(33).fill(null);

  for (const [index, x, y] of [
    [11, 0.12, 0.2],
    [12, -0.12, 0.2],
    [23, 0.1, 0.55],
    [24, -0.1, 0.55],
    [13, 0.2, 0.4],
    [14, -0.2, 0.4],
  ]) {
    landmarks[index] = {
      x: 0.5 + x * direction + offset,
      y,
      z: 0,
      visibility: 1,
    };
  }

  return landmarks;
}

test("a hit stays on the same body surface as the player moves", () => {
  const body = makeBody(pose(), null, 800, 600);
  const moved = makeBody(pose(1, 0.125), null, 800, 600);
  const first = hitBody(body, 415, 205);
  const second = hitBody(moved, 515, 205);
  assert.ok(first && second);
  assert.equal(first.triangle, second.triangle);
  assert.ok(Math.abs(first.u - second.u) < 1e-8);
  assert.ok(Math.abs(first.v - second.v) < 1e-8);
  assert.ok(first.depth < 0);
  assert.equal(hitBody(body, 0, 0), null);
});

test("turning away hides the original chest triangle", () => {
  const body = makeBody(pose(), null, 800, 600);
  const back = makeBody(pose(-1), null, 800, 600);
  const first = hitBody(body, 415, 205);
  assert.ok(first);
  assert.ok(hitBody(back, 415, 205));
  assert.ok(!back.visible.some((face) => face.id === first.triangle));
});

test("head, forearm and shin paint retain their own surface coordinates as a person moves", () => {
  const marks = pose();

  for (const [id, x, y] of [
    [2, 0.52, 0.09],
    [5, 0.48, 0.09],
    [7, 0.55, 0.1],
    [8, 0.45, 0.1],
    [9, 0.52, 0.13],
    [10, 0.48, 0.13],
    [15, 0.78, 0.46],
    [25, 0.61, 0.74],
    [27, 0.63, 0.95],
  ]) {
    marks[id] = { x, y, z: 0, visibility: 1 };
  }

  const body = makeBody(marks, null, 800, 600);

  const moved = makeBody(
    marks.map((p) => p && { ...p, x: p.x + 0.05 }),
    null,
    800,
    600,
  );

  for (const [part, x, y] of [
    [9, 400, 62],
    [3, 593, 258],
    [7, 496, 507],
  ]) {
    const first = hitBody(body, x, y);
    assert.equal(Math.floor(first?.triangle / 16), part);
    const next = hitBody(moved, x + 40, y);
    assert.equal(next?.triangle, first.triangle);
    assert.ok(Math.abs(next.u - first.u) + Math.abs(next.v - first.v) < 1e-8);
  }
});

test("a missing elbow drops only that arm; a missing torso drops the body", () => {
  const landmarks = pose();
  const arm = hitBody(makeBody(landmarks, null, 800, 600), 527, 195);
  assert.ok(arm && arm.triangle >= 16 && arm.triangle < 32);
  landmarks[13].visibility = 0.1;
  const body = makeBody(landmarks, null, 800, 600);
  assert.ok(hitBody(body, 415, 205));
  assert.equal(hitBody(body, 527, 195), null);
  landmarks[23].visibility = 0.1;
  assert.equal(makeBody(landmarks, null, 800, 600), null);
});

test("cropped hips below the camera still let a close-up upper body receive paint", () => {
  const marks = pose();

  for (const i of [23, 24]) {
    marks[i] = { ...marks[i], visibility: 0.1, y: 1.26 };
  }

  assert.ok(hitBody(makeBody(marks, null, 800, 600), 399, 346));
});

test("a silhouette-edge spray can attach to the adjacent articulated mesh", () => {
  const body = {
    visible: [
      {
        id: 6,
        area: -100,
        vertices: [
          { x: 0, y: 0, z: 0 },
          { x: 0, y: 10, z: 0 },
          { x: 10, y: 0, z: 0 },
        ],
      },
    ],
  };

  assert.equal(hitBody(body, -2, 4), null);
  assert.deepEqual(hitBody(body, -2, 4, 3), {
    triangle: 6,
    u: 0.4,
    v: 0,
    depth: 0,
  });
  assert.equal(hitBody(body, -12, 4, 3), null);
});
