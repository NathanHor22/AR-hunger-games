import test from 'node:test';
import assert from 'node:assert/strict';
import { addInk, createInkSurface, inkColors, inkStandings, surfaceUV, totalInkCells } from '../public/ink.js';
import { bodyTriangleCount } from '../public/body.js';

test('all ten mesh parts share a canonical paint surface across seams and adjacent triangles', () => {
  const cells = createInkSurface();
  assert.equal(cells.length * 16,bodyTriangleCount);
  assert.equal(inkColors.length,5);
  const a = { triangle: 0, u:.6, v:.4 };
  const b = { triangle: 1, u:0, v:.4 };
  assert.deepEqual(surfaceUV(a),surfaceUV(b));
  assert.ok(addInk(cells,a) > 0);
  assert.equal(addInk(cells,b),0);
  const seam = createInkSurface();
  const width = addInk(seam,{triangle:0,u:0,v:.5});
  assert.ok(width > 0);
  assert.equal(addInk(seam,{triangle:15,u:.5,v:0}),0);
  assert.ok(addInk(seam,{triangle:16,u:0,v:.5}) > 0);
  assert.equal(cells.reduce((n,p) => n+p.length,0),totalInkCells);
});

test('standings credit fresh area, share exact scores and omit spectators', () => {
  const contestant = (id,score,hits,spectator=false) => ({id,score,hits,spectator});
  const result = inkStandings([contestant('a',3,50), contestant('b',4,1), contestant('c',3,2), contestant('s',6,7,true)]);
  assert.deepEqual(result.map(p => [p.id,p.rank]),[['b',1],['a',2],['c',2]]);
});
