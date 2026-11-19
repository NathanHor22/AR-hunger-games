# Tomato Riot

A local AR ink fight for 2–8 people on their phones. Share a room QR, pick an ink color, and tap a rival to spray. Paint fresh areas of other players to earn points over a 90-second round.

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

1. Create a room, then have friends scan the QR and join. Each seat gets one of eight colors. Choose any available color in the lobby. Your tomatoes and the splats they leave on other players use your color.
2. Start with two or more connected players. Allow the rear camera when the round opens. In a duel, frame your rival alone. In a group, tap an unnamed person and pick their name. Tag again if the game loses track of who is who.
3. Tap a rival to throw a tomato, or hold and drag to spray continuously. The latest splat leaves its thrower’s color on the body. Only fresh areas earn points, so aim for unpainted spots on the head, torso, arms and legs.
4. The percentage above a rival shows how much of them is painted. Your phone shows your score and how much ink is on you. A dropped connection has a 25-second grace period.
5. At the end, the leaderboard ranks players by fresh coverage points. The host can open a rematch in the same room.

## How the prototype works

Each device processes its camera frames locally. In a two-player round, the sole visible person is assumed to be the rival. Group names are assigned on each phone and followed through position and pose continuity. A prolonged loss of view or an ambiguous crossing can require naming someone again.

The renderer fits articulated surfaces to pose landmarks. Each spray that changes the paint stores its triangle, two barycentric coordinates, ink color and shape seed. Observers use that anchor to draw the splat on the moving body from their own camera angle. Depth comes from the pose and apparent body size in each camera view.

The shooter's browser estimates contact. The server enforces the firing interval and tracks painted cells on each player's body. Peers receive confirmed paint updates, scores and rankings. All rooms are in memory and expire after abandonment. Restarting the server ends active rooms.

## Checks

```sh
npm run lint
npm test
npm run build
```

Google's Pose Landmarker Lite model is bundled at `assets/pose.task` so players can load the model and runtime from the game host. The model SHA-256 is `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a`. [Model download](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task) · [Model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf) · [Apache license](assets/LICENSE-2.0.txt)
