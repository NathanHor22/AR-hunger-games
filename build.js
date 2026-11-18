import { build } from 'esbuild'
import { copyFile, mkdir } from 'node:fs/promises'

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

await Promise.all(['index.html', 'style.css'].map(file => copyFile(file, 'dist/' + file)))
