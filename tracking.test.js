import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatcher, createLobbyEnrollment } from './public/tracking.js';
import { chestColors } from './public/pose-worker.js';

const signature = n => Array(12).fill(n);
const roster = [{ id: 'a', descriptor: signature(0.15) }, { id: 'b', descriptor: signature(0.8) }];

function person(x, color) {
  const landmarks = [];
  landmarks[11] = { x: x - 0.07, y: 0.25, visibility: 0.95 };
  landmarks[12] = { x: x + 0.07, y: 0.25, visibility: 0.95 };
  landmarks[23] = landmarks[24] = { x, y: 0.6 };

  return { landmarks, descriptor: signature(color) };
}

test('requires stable observations, releases crossing players, then reacquires either ordering', () => {
  const match = createMatcher();
  const step = (poses, now) => match(poses, roster, 'me', now).map(p => p.id);
  const a = person(0.25, 0.15), b = person(0.65, 0.8);
  assert.deepEqual(step([a, b], 0), [null, null]);
  step([a, b], 80);
  assert.deepEqual(step([a, b], 160), ['a', 'b']);
  assert.deepEqual(step([person(0.5, 0.15), person(0.55, 0.8)], 240), [null, null]);
  assert.deepEqual(step([b, a], 320), [null, null]);
  step([b, a], 400);
  assert.deepEqual(step([b, a], 480), ['b', 'a']);
  assert.deepEqual(step([b, a], 4000), [null, null]);
});

test('rejects lookalike people, ambiguous roster entries, mismatched clothes and the local player', () => {
  const match = createMatcher();

  for (let i = 0; i < 5; i++) {
    const ambiguous = [...roster, {id:'c', descriptor:signature(0.81)}];
    const poses = [person(0.2, 0.8), person(0.5, 0.15), person(0.8, 0.5)];
    assert.deepEqual(match(poses, ambiguous, 'a', i * 80).map(p => p.id), [null,null,null]);
    assert.deepEqual(match([person(0.2, 0.15), person(0.7, 0.15)], roster, 'me', i * 80).map(p => p.id), [null,null]);
  }
});

test('host enrolls an unknown person once while previously seen players move', () => {
  const enrollment = createLobbyEnrollment(), sent = [];
  enrollment.update([person(0.2, 0.15)], [], 0);
  enrollment.observe('first', d => sent.push(d), 100);

  for (let i = 0; i < 4; i++) enrollment.update([person(0.2 + i * 0.05, 0.15), person(0.7, 0.8)], [], 200 + i * 100);
  assert.equal(sent.length, 1);
  assert.ok(Math.abs(sent[0][0] - 0.8) < 0.00001);
  enrollment.observe('second', d => sent.push(d), 700);

  for (let i = 0; i < 4; i++) enrollment.update([person(0.6, 0.15), person(0.25, 0.8), person(0.8, 0.5)], [], 800 + i * 80);
  assert.equal(sent.length, 2);
  assert.equal(sent[1][5], 0.5);
});

test('simultaneous joins or duplicate candidates cannot enroll the wrong person', () => {
  const enrollment = createLobbyEnrollment(), sent = [];
  enrollment.observe('first', d => sent.push(d), 100);
  enrollment.observe('second', d => sent.push(d), 150);

  for (let i = 0; i < 4; i++) enrollment.update([person(0.5, 0.8)], [], 200 + i * 100);
  enrollment.observe('third', d => sent.push(d), 5000);

  for (let i = 0; i < 4; i++) enrollment.update([person(0.2, 0.15), person(0.7, 0.5)], [], 5100 + i * 100);
  assert.deepEqual(sent, []);
});

test('only confident visible upper-chest fabric influences the color signature', () => {
  const pose = person(0.5, 0.4).landmarks;
  const frame = new Uint8ClampedArray(200 * 200 * 4);

  for (let y = 50; y < 65; y++) {
    for (let x = 85; x < 115; x++) frame[4 * (200 * y + x)] = 220;
  }

  const first = chestColors(pose, frame, 200, 200);
  assert.equal(first.length, 12);
  assert.ok(first[0] > 0.8);
  frame.fill(250, 0, 50 * 200 * 4);
  assert.deepEqual(chestColors(pose, frame, 200, 200), first);
  pose[11].visibility = 0.2;
  assert.equal(chestColors(pose, frame, 200, 200), null);
});
