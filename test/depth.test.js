import assert from "node:assert/strict";
import test from "node:test";
import { contactAt } from "../arena.js";
import { bodyScale, clearlyInFront, ownership } from "../public/depth.js";
import { makeBody } from "../public/body.js";

function skeleton(pixelsPerMeter, visibility = 1) {
  const landmarks = [], world = [];

  for (const [id, x, y] of [[11, .19, -.5], [12, -.19, -.5], [23, .19, 0], [24, -.19, 0]]) {
    world[id] = { x, y, z: 0 };
    landmarks[id] = { x: .5 + x * pixelsPerMeter / 800, y: .65 + y * pixelsPerMeter / 600, z: 0, visibility };
  }

  return { landmarks, world };
}

function body(scale, visibility = 1) {
  const { landmarks, world } = skeleton(scale, visibility);

  return makeBody(landmarks, world, 800, 600);
}

function layer(body, ...values) {
  return { body, mask: { width: values.length, height: 1, data: Float32Array.from(values) } };
}

test("relative scale follows apparent size and estimates projection without world data", () => {
  const near = body(420), far = body(200);
  assert.ok(Math.abs(near.pixelsPerMeter / far.pixelsPerMeter - 2.1) < 1e-8);
  assert.ok(clearlyInFront(near, far));
  const { landmarks, world } = skeleton(200);

  // A hip-relative z shift of the whole estimated skeleton cannot place a
  // person farther from the camera.
  for (const p of world.filter(Boolean)) p.z += 2;
  assert.ok(Math.abs(bodyScale(landmarks, world, 800, 600).pixelsPerMeter - 200) < 1e-8);
  const estimated = bodyScale(landmarks, null, 800, 600);
  assert.ok(Math.abs(estimated.pixelsPerMeter - 200) < 1e-8);
  assert.ok(estimated.depthTolerance > far.depthTolerance);
  assert.equal(clearlyInFront(body(240), estimated), false);
  assert.ok(clearlyInFront(near, estimated));
});

test("mask stencil resolves distinct depths regardless of detector order", () => {
  const near = layer(body(400), 1, 0, .45, 1);
  const far = layer(body(200), 1, 1, 1, .45);

  assert.deepEqual([...ownership([near, far]).owners], [1, 2, 255, 1]);
  assert.deepEqual([...ownership([far, near]).owners], [2, 1, 255, 2]);
});

test("overlapping players of uncertain depth, low visibility or unknown geometry block hits and paint", () => {
  const first = layer(body(250), .95);

  for (const ambiguous of [body(240), body(125, .5), null]) {
    const other = layer(ambiguous, .95);
    assert.equal(ownership([first, other]).owners[0], 255);
    assert.equal(ownership([other, first]).owners[0], 255);
  }

  assert.equal(ownership([first, layer(body(125), .95), layer(null, .55)]).owners[0], 255);
  assert.equal(ownership([{ body: first.body }]), null);
});

test("contacts land on the foreground body surface and respect unidentified and unmasked occluders", () => {
  const camera = { x: 0, y: 0, width: 800, height: 600 };
  const near = { ...layer(body(400), 1), player: { id: "near", connected: true, health: 10 } };
  const far = { ...layer(body(200), 1), player: { id: "far", connected: true, health: 10 } };
  const contact = (people) => contactAt(people, 400, 330, camera);

  assert.equal(contact([far, near])?.targetId, "near");
  assert.equal(contact([near, far])?.targetId, "near");
  assert.equal(contact([near, { ...far, mask: null }])?.targetId, "near");
  assert.equal(contact([far, { ...near, mask: null }]), null);
  assert.equal(contact([far, { ...near, player: null }]), null);
  const hit = contact([far, near]);
  assert.ok(hit.anchor.triangle >= 0 && hit.anchor.u + hit.anchor.v <= 1);
});
