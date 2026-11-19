import assert from "node:assert/strict";
import test from "node:test";
import { createArena, project, contactAt, poseOpacity, tapWindow } from "../arena.js";
import { makeBody } from "../public/body.js";

const camera = { x: -160, y: 0, width: 640, height: 480 };

test("display fades across a slow detection or brief loss and expires even as empty frames continue", () => {
  assert.equal(poseOpacity(600, 0, 200), 1);
  assert.equal(poseOpacity(700, 0, 200), .75);
  assert.equal(poseOpacity(850, 0, 200), 0);
  assert.equal(poseOpacity(1400, 0, 700), 1);
  assert.equal(poseOpacity(1560, 0, 700), .5);
  assert.equal(poseOpacity(1800, 0, 700), 0);
  assert.equal(poseOpacity(700, 500, 560, 600), .5);
  assert.equal(poseOpacity(800, 500, 560, 600), 0);
});

test("a delayed tap uses capture time, rejects late delivery, and can wait past an older in-flight frame", () => {
  assert.equal(tapWindow(1500, 1000, 1650), "wait");
  assert.equal(tapWindow(1500, 1200, 1840), "resolve");
  assert.equal(tapWindow(1500, 1700, 2320), "resolve");
  assert.equal(tapWindow(1500, 1850, 2300), "expired");
  assert.equal(tapWindow(1500, 1600, 2450), "expired");
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
    landmarks: marks,
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

function arenaCanvas(t, ctx = {}, globals = {}) {
  const canvas = Object.assign(new EventTarget(), {
    clientWidth:320, clientHeight:480, getContext:() => ctx,
    getBoundingClientRect:() => ({left:0, top:0, right:320, bottom:480}), setPointerCapture() {},
  });

  const browser = { window:new EventTarget(), matchMedia:() => ({matches:false}),
    document:Object.assign(new EventTarget(), {
      createElement:() => canvas,
      querySelector:() => ({ getBoundingClientRect:() => ({left:4,top:4,right:110,bottom:32}) }),
      getElementById:() => ({ getBoundingClientRect:() => ({left:246,top:4,right:316,bottom:32}) }),
    }), ...globals };

  for (const [key, value] of Object.entries(browser)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, {configurable:true, value});
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; });
  }

  return canvas;
}

test("a released tap can settle once from slow inference; loss, changed identity, cancel and timeout discard it", (t) => {
  let now = 1000;
  t.mock.method(performance, "now", () => now);
  const canvas = arenaCanvas(t);
  const person = { ...contestant("rival"), id:"rival", trackId:1 };
  const sprays = [], identified = [];

  const arena = createArena({
    video:{videoWidth:640, videoHeight:480}, canvas, canSpray:() => true,
    onIdentify:trackId => identified.push(trackId), message() {},
    send(event) {
      sprays.push(event);

      return true;
    },
  });

  arena.setState({phase:"playing", code:"123456", round:1, players:[person.player]}, "self");

  const pointer = type => canvas.dispatchEvent(Object.assign(new Event(type), {
    pointerId:1, isPrimary:true, button:0, clientX:140, clientY:186,
  }));

  function tapDuringInference(release = "pointerup") {
    now += 1000;
    arena.setPeople([person], now - 650);
    now += 250;
    pointer("pointerdown");
    pointer(release);
  }

  tapDuringInference();
  assert.equal(sprays.length, 0);
  now += 190;
  arena.setPeople([person], now - 300);
  arena.setPeople([person], now - 300);
  assert.equal(sprays.length, 1);
  assert.equal(sprays[0].targetId, "rival");

  tapDuringInference();
  arena.setPeople([], now - 50);
  arena.setPeople([person], now);
  tapDuringInference();
  arena.setPeople([{ ...person, trackId:2 }], now);
  arena.setPeople([person], now);
  tapDuringInference("pointercancel");
  arena.setPeople([person], now);
  tapDuringInference();
  now += 950;
  arena.setPeople([person], now - 860);
  assert.equal(sprays.length, 1);

  now += 1000;
  arena.setPeople([{ ...person, id:null }], now - 650);
  now += 250;
  pointer("pointerdown");
  pointer("pointerup");
  assert.deepEqual(identified, [1]);
  now += 190;
  arena.setPeople([], now);
  pointer("pointerdown");
  pointer("pointerup");
  assert.deepEqual(identified, [1]);
  assert.equal(sprays.length, 1);
});

test("the impact and recipient feedback use the thrower’s color, including repeat hits", (t) => {
  let draw;
  const impact = [], edge = [];

  const ctx = {
    setTransform() {}, clearRect() {}, drawImage() {}, save() {}, restore() {}, beginPath() {},
    moveTo() {}, lineTo() {}, closePath() {}, stroke() {}, arc() {}, ellipse() {}, fillText() {},
    measureText: () => ({width:50}),
    fill() { impact.push(this.fillStyle); },
    fillRect(x,y,w) { if (x === 0 && y === 0 && w === 6) edge.push(this.fillStyle); },
  };

  const canvas = arenaCanvas(t,ctx,{
    devicePixelRatio:1,
    requestAnimationFrame(fn) {
      draw = fn;

      return 1;
    },
  });

  t.mock.method(performance, "now", () => 1000);
  const target = { ...contestant("rival"), id:"rival", trackId:1 };
  const self = {id:"self",name:"Blue",color:"#319cff",splats:[]};
  Object.assign(target.player,{name:"Green",color:"#49e066",splats:[]});
  const room = {phase:"playing", code:"123456", round:1, players:[self,target.player]};
  const arena = createArena({video:{videoWidth:640,videoHeight:480},canvas,send:() => true,canSpray:() => true,message() {}});
  arena.setState(room,self.id);
  arena.setPeople([target],1000);
  arena.start();
  canvas.dispatchEvent(Object.assign(new Event("pointerdown"),{pointerId:1,isPrimary:true,button:0,clientX:140,clientY:186}));
  canvas.dispatchEvent(Object.assign(new Event("pointerup"),{pointerId:1}));
  draw(1150);
  assert.ok(impact.includes(self.color));
  assert.ok(!impact.includes(target.player.color));

  arena.setState(room,target.id);
  const hit = {code:room.code,round:1,targetId:target.id,shooterId:self.id,color:self.color};
  arena.receivePaint({...hit,splat:{color:self.color}});
  draw(1160);
  arena.receivePaint(hit);
  draw(1170);
  assert.deepEqual(edge,[self.color,self.color]);
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
