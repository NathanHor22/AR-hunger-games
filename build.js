import { build } from 'esbuild'
import { copyFile, cp, mkdir } from 'node:fs/promises'

await mkdir('dist/assets', { recursive: true })

await build({
  entryPoints: { game: 'game.js', 'assets/pose-worker': 'public/pose-worker.js' },
  bundle: true,
  splitting: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  chunkNames: 'assets/chunk-[hash]',
  outdir: 'dist'
})

await Promise.all([
  copyFile('index.html', 'dist/index.html'),
  copyFile('style.css', 'dist/style.css'),
  copyFile('menu.css', 'dist/menu.css'),
  copyFile('lobby.css', 'dist/lobby.css'),
  copyFile('round.css', 'dist/round.css'),
  copyFile('assets/barlow-condensed-800-italic.woff2', 'dist/assets/barlow-condensed-800-italic.woff2'),
  copyFile('assets/Barlow-OFL.txt', 'dist/assets/Barlow-OFL.txt'),
  copyFile('assets/pose.task', 'dist/pose.task'),
  copyFile('assets/LICENSE-2.0.txt', 'dist/assets/LICENSE-2.0.txt'),
  cp('node_modules/@mediapipe/tasks-vision/wasm', 'dist/vision-wasm', { recursive: true })
])
