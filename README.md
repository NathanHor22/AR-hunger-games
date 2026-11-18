# Tomato Riot

A phone-browser tomato battle for 2–8 people in the same room. Create a room, share its QR, and swipe upward from the tomato to throw. Each player starts with ten health. The last survivor wins, or the leaderboard settles the round after 90 seconds.

## Hosted game

[Play Tomato Riot](https://ar-hunger-games.vercel.app/). The Vercel deployment serves the camera model and browser runtime from the same HTTPS origin. The Singapore function accepts room connections at `/ws`.

Rooms live in function memory. A cold restart ends a room, and a join or reconnect routed to another instance can report an expired room. For a larger event, use the single-server deployment below or add shared room storage and event delivery. [Vercel WebSocket guide](https://vercel.com/docs/functions/websockets)

## Run

Use Node.js 22.19 or newer and npm.

```sh
npm ci
npm start
```

Open http://localhost:3000 to try the app on the server computer. For phones, open the game through a **shared HTTPS address trusted by every device** before creating the room. The QR encodes the address in the host's browser. A localhost QR points each phone back to itself. A plain HTTP LAN address cannot request a mobile browser camera.

The Node server serves the site, model, WASM and WebSocket endpoint at `/ws`. Run a single instance behind an HTTPS proxy with WebSocket upgrades enabled, or set `TLS_CERT` and `TLS_KEY` to a trusted certificate chain and matching private key for the hostname. `HOST` defaults to `0.0.0.0` and `PORT` defaults to `3000`. For a deployment install with development dependencies, run `npm run build`, then start `node server.js` with the production dependencies and the assets directory present.

## Playtest

1. Open the same HTTPS site on the host phone, create a room and allow the camera. Other players scan the room QR, tap Join and allow their cameras. The app checks shirt colors briefly with the front camera. The host can also register a single new shirt as a player joins.
2. If a player shows **Color pending**, tap **Refresh color** on that phone, keeping their face and upper chest in the front camera view. Distinct shirt colors work best for this prototype. Similar shirts, partial bodies or overlapping players can temporarily prevent target selection.
3. Start the round after every connected player is ready. Point the rear camera at another registered player and flick upward from the tomato. Swipe length and angle set the landing point. Body-attached paint is supported on the torso and upper arms.
4. Check a shoulder hit from two viewpoints, then turn, cross in front of another player and step back. A reacquired player should still carry the same paint. A temporarily disconnected player has 25 seconds to rejoin their seat. The host role passes to another connected player when necessary.
5. At the end, compare hits and knockouts across phones. The host can open a rematch in the same room.

## How the prototype works

Each device processes camera frames locally. A compact shirt-color descriptor is shared within the room. Similar colors and crossings suppress uncertain matches. This is experimental identification for casually dressed groups. A bystander in matching clothing can still be confused with a participant.

The renderer fits projected, articulated mesh surfaces to pose landmarks. Each impact stores its triangle, two barycentric coordinates, paint color and shape seed. Each observer reconstructs the mark on their own estimate of the same moving body. Dynamic clothing folds, room-scale calibrated depth and full-body photogrammetry are outside the prototype's geometry.

The shooter's browser estimates collision. The server owns health, cooldowns, eliminations, time, rankings and room-scoped resume credentials. All rooms are in memory and expire after abandonment. Restarting the server ends active rooms.

## Checks

```sh
npm run lint
npm test
npm run build
```

Google's Pose Landmarker Lite model is bundled at `assets/pose.task` so players can load the model and runtime from the game host. The model SHA-256 is `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a`. [Model download](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task) · [Model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf) · [Apache license](assets/LICENSE-2.0.txt)
