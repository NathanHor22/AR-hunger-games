export const inkColors = [
  { name: 'Blue', hex: '#319cff' },
  { name: 'Purple', hex: '#a369ff' },
  { name: 'Green', hex: '#49e066' },
  { name: 'Pink', hex: '#ff59a3' },
  { name: 'Orange', hex: '#ff902f' },
  { name: 'Red', hex: '#ef3440' },
  { name: 'Yellow', hex: '#ffdb38' },
  { name: 'Cyan', hex: '#20d8db' },
];

export const sprayIntervalMs = 180;

// Each articulated part has eight sides, with two stable triangles per side.
// The larger grids give the torso and thighs a larger share of the total area.
const grids = [[32,12], [10,10], [10,10], [8,8], [8,8], [14,12], [14,12], [10,11], [10,11], [14,10]];
export const totalInkCells = grids.reduce((n, [w,h]) => n + w*h, 0);

export function surfaceUV({ triangle, u, v }) {
  const side = Math.floor(triangle % 16 / 2);
  const part = Math.floor(triangle / 16);

  return triangle % 2 ? { part, s:side + 1 - v, t:u + v } : { part, s:side + u, t:v };
}

export function inkFootprint(part) {
  return part === 0 ? { s: .74, t: .16 } : { s: 1.28, t: .22 };
}

export function createInkSurface() {
  return grids.map(([w,h]) => new Uint8Array(w*h));
}

// Rasterize onto a persistent body surface. Cells at the UV seam are neighbors.
export function addInk(cells, anchor, colorId) {
  const { part, s, t } = surfaceUV(anchor);
  const [w,h] = grids[part];
  const radius = inkFootprint(part);
  const sx = s*w/8, sy = t*h, rx = radius.s*w/8, ry = radius.t*h;
  const patch = cells[part];
  let fresh = 0, changed = false;

  for (let y = Math.max(0, Math.floor(sy-ry)); y < Math.min(h, Math.ceil(sy+ry)); y++) {
    for (let x = Math.floor(sx-rx); x < Math.ceil(sx+rx); x++) {
      if (((x+.5-sx)/rx)**2 + ((y+.5-sy)/ry)**2 > 1) continue;
      const cell = y*w + (x+w)%w;

      if (patch[cell] === colorId) continue;

      if (patch[cell] === 0) fresh++;
      patch[cell] = colorId;
      changed = true;
    }
  }

  return { fresh, changed };
}

export function inkStandings(players) {
  const sorted = players.filter(p => !p.spectator).sort((a,b) => b.score-a.score);
  let rank = 1;

  return sorted.map(({ id, name, color, score, hits, coverage }, i) => {
    if (i && score !== sorted[i-1].score) rank = i+1;

    return { id, name, color, rank, score, hits, coverage };
  });
}
