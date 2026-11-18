import assert from 'node:assert/strict';
import test from 'node:test';
import { drawNameplates, headAnchor } from '../public/nameplate.js';

function pose(x = .5) {
  const points = [];

  for (const [id, dx, y] of [
    [0, 0, .30], [2, -.015, .28], [5, .015, .28], [7, -.035, .295], [8, .035, .295],
    [11, -.09, .41], [12, .09, .41], [23, -.055, .69], [24, .055, .69],
  ]) points[id] = { x: x + dx, y, visibility: 1 };

  return points;
}

test('nameplate follows the crown even when the head leans away from the shoulders', () => {
  const points = pose(.48);
  const centered = headAnchor(points, 400, 800);

  for (const id of [0, 2, 5, 7, 8]) points[id].x += .1;
  const leaning = headAnchor(points, 400, 800);
  assert.ok(Math.abs(leaning.x - centered.x - 40) < .001);
  assert.ok(leaning.y < points[2].y * 800 - 15);
});

test('a turned head uses the torso axis; missing lower landmarks do not hide a visible face', () => {
  const points = pose();

  for (const id of [0, 2, 5, 7, 8]) points[id].visibility = .1;
  const back = headAnchor(points, 400, 800);
  assert.ok(back.y < points[11].y * 800 - 40);
  points[23] = null;
  assert.equal(headAnchor(points, 400, 800), null);
  points[0].visibility = .98;
  assert.ok(headAnchor(points, 400, 800));
  points[0].x = 1.6;
  assert.equal(headAnchor(points, 400, 800), null);
});

test('overlapping rivals each get a name, health count and ten pips clear of the HUD', () => {
  const boxes = [], text = [], pips = [];

  const ctx = {
    save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    measureText(name) { return { width: 8 * name.length }; },
    fillText(label) { text.push(label); },
    fillRect(x, y, width, height) {
      if (this.fillStyle === '#251b35') boxes.push({ left: x, right: x + width, top: y, bottom: y + height });

      if (height === 5) pips.push(this.fillStyle);
    },
  };

  const scene = [
    { points: pose(.45), player: { connected: true, name: 'Ray', health: 7, color: 'red' } },
    { points: pose(.47), player: { connected: true, name: 'Jo', health: 0, color: 'blue' } },
    { points: pose(), player: { connected: false, name: 'Offline' } },
    { points: pose(), player: { connected: true, spectator: true, name: 'Observer' } },
    { points: pose(), player: null },
  ];

  const hud = { left: 50, right: 230, top: 62, bottom: 90 };
  drawNameplates(ctx, scene, 320, 420, [hud]);
  assert.deepEqual(text, ['Ray', '7/10', 'Jo', '0/10']);
  assert.equal(pips.length, 20);
  assert.equal(pips.filter(color => color === 'red').length, 7);
  assert.equal(pips.filter(color => color === 'blue').length, 0);
  const clears = (a, b) => a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom;
  assert.ok(clears(boxes[0], boxes[1]));
  assert.ok(boxes.every(box => clears(box, hud) && box.left >= 0 && box.right <= 320));
});
