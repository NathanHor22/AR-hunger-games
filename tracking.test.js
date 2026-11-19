import test from 'node:test';
import assert from 'node:assert/strict';
import { createPoseTracks } from './public/pose-tracks.js';
import { createTracker } from './public/tracking.js';

const roster = (...ids) => ids.map(id => ({ id, connected:true, color:'#38d877' }));

function person(x, size = 1) {
  const landmarks = [];

  for (const [i, dx, dy] of [[11,-.075,0], [12,.075,0], [23,-.055,.3], [24,.055,.3]]) {
    landmarks[i] = { x:x + dx * size, y:.22 + dy * size, z:0, visibility:.95 };
  }

  return { landmarks };
}

test('a solo rival auto-binds with no enrollment and ignores chosen ink and shirt appearance', () => {
  const tracks = createPoseTracks();
  tracks.setRoster(roster('a','b'), 'a');
  const [first] = tracks.update([person(.45)], 0, 640,480);
  assert.equal(first.id, null);
  assert.equal(first.trackId, null);
  const [rival] = tracks.update([person(.46)], 85, 640,480);
  assert.equal(rival.id, 'b');
  assert.equal(rival.trackId, first.candidateTrackId);
  assert.ok(rival.trackId);
  tracks.setRoster([...roster('a'), {id:'b', connected:false}], 'a');
  assert.equal(tracks.update([person(.47)], 170, 640,480)[0].id, null);
});

test('multiple visible people never auto-bind a sole rival by camera order', () => {
  const tracks = createPoseTracks();
  tracks.setRoster(roster('me','a'), 'me');
  tracks.update([person(.2),person(.75)], 0, 640,480);
  const frame = tracks.update([person(.73),person(.21)], 90, 640,480);
  assert.deepEqual(frame.map(p => p.id), [null,null]);
  assert.ok(frame.every(p => Number.isInteger(p.trackId)));
  assert.equal(tracks.assign(frame[0].trackId,'a',95), true);
  assert.deepEqual(tracks.update([person(.23),person(.72)], 180, 640,480).map(p=>p.id), [null,'a']);
});

test('groups map names manually, survive short dropouts and discard binding at a crossing or long loss', () => {
  const tracks = createPoseTracks();
  tracks.setRoster(roster('me','a','b'), 'me');
  const step = (time, ...xs) => tracks.update(xs.map(x => person(x)), time, 640,480);
  step(0, .25,.72);
  const [left,right] = step(90,.26,.71);
  assert.deepEqual([left.id,right.id], [null,null]);
  assert.equal(tracks.assign(left.trackId,'me',95), false);
  assert.equal(tracks.assign(left.trackId,'a',95), true);
  assert.equal(tracks.assign(right.trackId,'b',95), true);
  assert.deepEqual(step(180,.68,.29).map(p=>p.id), ['b','a']);
  step(260,.66);
  assert.equal(tracks.assign(left.trackId,'a',270), false);
  assert.deepEqual(step(360,.32,.64).map(p=>p.id), ['a','b']);
  const overlap = step(450,.48,.51);
  assert.deepEqual(overlap.map(p=>p.trackId), [null,null]);
  assert.deepEqual(overlap.map(p=>p.candidateTrackId), [null,null]);
  assert.equal(tracks.assign(left.trackId,'a',460), false);
  step(550,.68,.3);
  const apart = step(640,.70,.28);
  assert.deepEqual(apart.map(p=>p.id), [null,null]);
  assert.equal(tracks.assign(apart[0].trackId,'a',650), true);
  assert.equal(tracks.assign(apart[0].trackId,'b',1700), false);
  assert.equal(step(1800,.70)[0].id, null);
  assert.equal(step(1890,.70)[0].id, null);
});

test('clearly different depths retain spatial identity through overlap', () => {
  const tracks = createPoseTracks();
  tracks.setRoster(roster('me','a','b'), 'me');

  const step = (t, nearX, farX, flip = false) => {
    const poses = [person(nearX,1.65),person(farX,.65)];

    return tracks.update(flip ? poses.reverse() : poses,t,640,480);
  };

  step(0,.32,.64);
  const [near,far] = step(90,.34,.62);
  tracks.assign(near.trackId,'a',95);
  tracks.assign(far.trackId,'b',95);
  step(180,.4,.56,true);
  step(270,.45,.52);
  assert.deepEqual(step(360,.49,.49,true).map(p=>p.id), ['b','a']);
});

test('slow continuous inference preserves a stable name, while a pause, loss or large jump clears it', () => {
  const tracks = createPoseTracks();
  tracks.setRoster(roster('me','a','b'), 'me');
  const frame = (capture, delivery, ...xs) => tracks.update(xs.map(x => person(x)),capture,640,480,delivery);
  frame(0,700,.25,.75);
  const [a,b] = frame(715,1415,.26,.74);
  assert.ok(a.trackId && b.trackId);
  assert.equal(tracks.assign(a.trackId,'a',1440),true);
  assert.equal(tracks.assign(b.trackId,'b',1440),true);
  assert.deepEqual(frame(1430,2130,.73,.27).map(p => p.id),['b','a']);
  // A large move may be a different person. A missing slow frame also breaks continuity.
  assert.deepEqual(frame(2150,2850,.60).map(p => p.id),[null]);
  assert.deepEqual(frame(2865,3565,.73,.27).map(p => p.id),[null,null]);
  const confirmed = frame(3580,4280,.73,.27);
  assert.equal(tracks.assign(confirmed[0].trackId,'b',4300),true);
  // Capturing after an idle pause discards even a body in the same place.
  assert.deepEqual(frame(4820,5000,.73,.27).map(p => p.id),[null,null]);
  const fresh = frame(5015,6450,.73,.27);
  assert.equal(tracks.assign(fresh[0].trackId,'b',6460),false);
  assert.deepEqual(frame(6470,6700,.73,.27).map(p => p.trackId),[null,null]);
});

test('reset and removal invalidate IDs immediately; duplicate colors and spectators cannot claim a rival', () => {
  const tracks = createPoseTracks();
  tracks.setRoster([...roster('me','a','b'), {id:'s',connected:true,spectator:true}], 'me');
  tracks.update([person(.3),person(.7)],0,640,480);
  const [a,b] = tracks.update([person(.31),person(.7)],100,640,480);
  assert.equal(tracks.assign(a.trackId,'s',110), false);
  tracks.assign(a.trackId,'a',110);
  tracks.assign(b.trackId,'a',110);
  assert.deepEqual(tracks.update([person(.31),person(.7)],190,640,480).map(p=>p.id),[null,'a']);
  tracks.clear();
  assert.equal(tracks.assign(b.trackId,'a',200), false);
  tracks.update([person(.31),person(.7)],300,640,480);
  const fresh = tracks.update([person(.31),person(.7)],400,640,480);
  assert.ok(fresh.every(p=>p.trackId > b.trackId && p.id === null));
  assert.equal(tracks.update([{landmarks:[]}],460,640,480)[0].trackId,null);
});

test('lobby and roster changes never request a camera, and stopping safely handles late permission', async (t) => {
  let requests = 0, release, stopped = 0;
  const granted = new Promise(resolve => { release = resolve; });
  const previous = Object.getOwnPropertyDescriptor(navigator,'mediaDevices');
  Object.defineProperty(navigator,'mediaDevices',{ configurable:true, value:{
    getUserMedia(options) {
      requests++;
      assert.equal(options.video.facingMode.ideal,'environment');

      return granted;
    }
  }});
  t.after(() => {
    if (previous) Object.defineProperty(navigator,'mediaDevices',previous);
    else delete navigator.mediaDevices;
  });
  const tracker = createTracker({});
  tracker.setRoster(roster('me','a'),'me');
  tracker.clearAssignments();
  assert.equal(requests,0);
  const first = tracker.start();
  assert.equal(tracker.start(),first);
  assert.equal(requests,1);
  tracker.stop();
  release({getTracks:()=>[{stop:()=>{stopped++}}]});
  assert.equal(await first,false);
  assert.equal(stopped,1);
});

test('a tap freezes preview pixels through model startup and waits its turn behind in-flight inference', {timeout:5000}, async t => {
  const initialization = Promise.withResolvers();
  let nextInput = Promise.withResolvers();
  let now = 100;
  t.mock.method(performance,'now',() => now);

  class Canvas {
    constructor(width,height) { Object.assign(this,{width,height}); }
    getContext() { return {drawImage:video => { this.pixel = video.pixel; }}; }
    transferToImageBitmap() {
      return {pixel:this.pixel,width:this.width,height:this.height,close() {}};
    }
  }

  class Worker {
    postMessage({frame}) {
      if (!frame) initialization.resolve(() => this.onmessage({data:{ready:true}}));
      else nextInput.resolve({frame,finish:() => this.onmessage({data:{people:[person(.5)]}})});
    }
    terminate() {}
  }

  for (const [owner,key,val] of [
    [globalThis,'OffscreenCanvas',Canvas], [globalThis,'Worker',Worker], [globalThis,'createImageBitmap',() => {}],
    [navigator,'mediaDevices',{getUserMedia:async () => ({active:true,getTracks:()=>[],getVideoTracks:()=>[]})}],
  ]) {
    const descriptor = Object.getOwnPropertyDescriptor(owner,key);
    Object.defineProperty(owner,key,{configurable:true,value:val});
    t.after(() => { if (descriptor) Object.defineProperty(owner,key,descriptor); else delete owner[key]; });
  }

  async function takeInput() {
    const request = await nextInput.promise;
    nextInput = Promise.withResolvers();

    return request;
  }

  const video = {readyState:2, videoWidth:640, videoHeight:480, currentTime:1, pixel:10, play:async () => {}};
  const frames = [];
  const tracker = createTracker(video,{onFrame:(people,at,token) => frames.push({people,at,token})});
  t.after(() => tracker.stop());
  assert.equal(tracker.captureTap(),null);
  tracker.setRoster(roster('me','rival'),'me');
  const started = tracker.start();
  const ready = await initialization.promise;
  const superseded = tracker.captureTap();
  Object.assign(video,{pixel:20,currentTime:2});
  const shot = tracker.captureTap();
  assert.ok(shot && superseded && shot !== superseded);
  Object.assign(video,{pixel:30,currentTime:3});
  now = 5000;
  ready();
  assert.equal(await started,true);

  const saved = await takeInput();
  assert.deepEqual([saved.frame.pixel,saved.frame.width,saved.frame.height],[20,427,320]);
  saved.finish();
  const live = await takeInput();
  assert.equal(live.frame.pixel,30);
  assert.equal(frames[0].token,shot);
  assert.equal(frames[0].at,100);
  assert.equal(frames[0].people[0].id,null);
  const candidate = frames[0].people[0].candidateTrackId;

  Object.assign(video,{pixel:40,currentTime:4});
  tracker.captureTap();
  Object.assign(video,{pixel:50,currentTime:5});
  const newest = tracker.captureTap();
  Object.assign(video,{pixel:60,currentTime:6});
  live.finish();
  const queued = await takeInput();
  assert.equal(queued.frame.pixel,50);
  assert.equal(frames[1].people[0].trackId,candidate);
  assert.equal(frames[1].people[0].id,'rival');
  queued.finish();
  const last = await takeInput();
  assert.equal(frames[2].token,newest);
  assert.equal(last.frame.pixel,60);

  Object.assign(video,{pixel:70,currentTime:7});
  const cleared = tracker.captureTap();
  tracker.clearAssignments();
  Object.assign(video,{pixel:80,currentTime:8});
  last.finish();
  const afterReset = await takeInput();
  assert.equal(afterReset.frame.pixel,80);
  assert.ok(!frames.some(f => f.token === cleared));
  tracker.stop();
  assert.equal(tracker.captureTap(),null);
  assert.deepEqual(frames.at(-1).people,[]);
});
