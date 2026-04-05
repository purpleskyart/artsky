/**
 * Rasterize public/icon-app.svg to PNGs for iOS home screen and PWA manifests.
 * Run automatically from `npm run build`; run manually after editing the SVG.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const svgPath = join(root, 'public', 'icon-app.svg')
const svg = readFileSync(svgPath)

const out = [
  ['apple-touch-icon.png', 180],
  ['icon-192.png', 192],
  ['icon-512.png', 512],
]

for (const [name, size] of out) {
  await sharp(svg, { density: 300 })
    .resize(size, size)
    .png()
    .toFile(join(root, 'public', name))
}

console.log('Wrote public/apple-touch-icon.png, icon-192.png, icon-512.png from icon-app.svg')
