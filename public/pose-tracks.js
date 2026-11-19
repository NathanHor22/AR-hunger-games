import { bodyScale, clearlyInFront } from './depth.js';

const maxGap = 650;
const maxSlowGap = 1250;

function torso(person, width, height) {
  const points = person.landmarks || [];

  const pair = (a, b) => {
    const left = points[a], right = points[b];

    if (![left, right].every(p => Number.isFinite(p?.x) && Number.isFinite(p.y)
      && (p.visibility ?? 1) > .4 && (p.presence ?? 1) > .4)) return null;

    return { x:(left.x + right.x)/2, y:(left.y + right.y)/2,
      span:Math.hypot((left.x - right.x) * width / height, left.y - right.y) };
  };

  const shoulders = pair(11, 12), hips = pair(23, 24), ears = pair(7, 8);

  if (!shoulders && !hips && !ears) return null;
  // All features use image-height units so a camera aspect change cannot distort a distance.
  const span = Math.max(.045, shoulders?.span || hips?.span * 1.3 || ears?.span * 2.4 || 0);
  const shoulderY = shoulders?.y ?? (hips ? hips.y - 1.3 * span : ears.y + .6 * span);
  const length = Math.max(span * .8, hips ? hips.y - shoulderY : span * 1.3);

  return {
    x: (shoulders || hips || ears).x * width / height, y: shoulderY,
    span, length, ...bodyScale(points, person.worldLandmarks, width, height),
  };
}

function matchCost(a, b) {
  const distance = Math.hypot(a.x - b.x, a.y - b.y) / Math.max(.085, (a.length + b.length) / 2);

  const scale = a.pixelsPerMeter && b.pixelsPerMeter
    ? a.pixelsPerMeter / b.pixelsPerMeter : a.length / b.length;

  const sizeChange = Math.abs(Math.log(scale));

  return distance < .75 && sizeChange < .55 ? distance + sizeChange * .8 : Infinity;
}

function uniqueBest(choices) {
  let best = Infinity, second = Infinity, winner = -1;

  for (let i = 0; i < choices.length; i++) {
    const cost = choices[i];

    if (cost < best) {
      second = best;
      best = cost;
      winner = i;
    } else second = Math.min(second, cost);
  }

  return winner >= 0 && second - best > .2 ? winner : -1;
}

function crowded(a, b) {
  return b && Math.abs(a.x - b.x) < (a.span + b.span) * .48
    && a.y < b.y + b.length && b.y < a.y + a.length
    && !clearlyInFront(a, b) && !clearlyInFront(b, a);
}

export function createPoseTracks() {
  let tracks = [], rivals = [], nextId = 1;

  function setRoster(players, ownId) {
    rivals = players.filter(p => p.id !== ownId && !p.spectator);

    for (const track of tracks) {
      if (!rivals.some(p => p.id === track.playerId && p.connected)) track.playerId = null;
    }
  }

  function update(people, now, width, height, deliveredAt = now, tap = false, repeated = false) {
    // A busy detector can occupy most of the interval between captures. Only
    // extend a continuously visible track if the next capture followed its result.
    const old = tracks.filter(t => now - t.at <= maxGap || (t.visible
      && (now - t.at <= maxSlowGap || t.firstTap) && now - t.deliveredAt <= 250));

    const boxes = people.map(p => torso(p, width, height));
    const blocked = boxes.map((box, i) => !box || boxes.some((b,j) => i !== j && crowded(box,b)));

    const costs = boxes.map(box => old.map(t => {
      const cost = box ? matchCost(box, t.box) : Infinity;

      return now - t.at > maxGap && cost > .4 ? Infinity : cost;
    }));

    const oldChoices = old.map((_, j) => uniqueBest(costs.map(row => row[j])));
    const next = [];

    const result = people.map((person, i) => {
      if (blocked[i]) return { ...person, trackId:null, candidateTrackId:null, id:null };
      const j = uniqueBest(costs[i]);
      const prior = j >= 0 && oldChoices[j] === i ? old[j] : null;
      const increment = repeated && prior ? 0 : 1;
      const seen = (prior?.seen || 0) + increment;
      const solo = people.length === 1 ? (prior?.solo || 0) + increment : 0;

      const track = { trackId:prior?.trackId ?? nextId++, playerId:prior?.playerId ?? null,
        seen, solo, at:now, deliveredAt, box:boxes[i], visible:true, firstTap:tap && seen === 1 };

      if (solo >= 2 && rivals.length === 1 && rivals[0].connected
        && !old.some(t => t.trackId !== track.trackId && t.playerId === rivals[0].id)) {
        track.playerId = rivals[0].id;
      }

      next.push(track);

      const ambiguous = !prior && costs[i].some(Number.isFinite);

      return { ...person, trackId:seen >= 2 ? track.trackId : null,
        candidateTrackId:ambiguous ? null : track.trackId, id:track.playerId };
    });

    // Bridge isolated missed detections. A merged silhouette or competing match
    // retires old bindings, so subsequent separation cannot swap rivals' names.
    if (!blocked.includes(true)) {
      for (const [j, prior] of old.entries()) {
        if (costs.every(row => !Number.isFinite(row[j]))
          && !next.some(t => t.playerId && t.playerId === prior.playerId)) {
          next.push({ ...prior, visible:false });
        }
      }
    }

    tracks = next;

    return result;
  }

  function assign(trackId, playerId, now) {
    const track = tracks.find(t => t.trackId === trackId && t.visible && t.seen >= 2
      && now - t.deliveredAt <= maxGap && now - t.at <= maxSlowGap);

    if (!track || !rivals.some(p => p.id === playerId && p.connected)) return false;

    for (const other of tracks) {
      if (other.playerId === playerId) other.playerId = null;
    }

    track.playerId = playerId;

    return true;
  }

  return { setRoster, update, assign, clear() { tracks = []; } };
}
