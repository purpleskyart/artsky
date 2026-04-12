/**
 * Rasterize SVG icons to PNGs for iOS home screen and PWA manifests.
 * Creates native-looking icons:
 * - iOS: Apple-style soft gradient with squircle shape
 * - Android: Material Design 3 style with elevation
 * Run automatically from `npm run build`; run manually after editing the SVGs.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

// iOS icons - Apple-style premium gradient
const iosSvgPath = join(root, 'public', 'icon-ios.svg')
const iosSvg = readFileSync(iosSvgPath)

const iosIcons = [
  ['icon-ios-180.png', 180],  // iPhone
  ['icon-ios-120.png', 120],  // iPad
  ['apple-touch-icon.png', 180],  // Legacy
]

for (const [name, size] of iosIcons) {
  await sharp(iosSvg, { density: 300 })
    .resize(size, size)
    .png()
    .toFile(join(root, 'public', name))
}

// Android icons - Material Design 3 style
const androidSvgPath = join(root, 'public', 'icon-android.svg')
const androidSvg = readFileSync(androidSvgPath)

const androidIcons = [
  ['icon-android-192.png', 192],
  ['icon-android-512.png', 512],
  ['icon-192.png', 192],  // Legacy
  ['icon-512.png', 512],  // Legacy
]

for (const [name, size] of androidIcons) {
  await sharp(androidSvg, { density: 300 })
    .resize(size, size)
    .png()
    .toFile(join(root, 'public', name))
}

console.log('Wrote iOS icons: icon-ios-180.png, icon-ios-120.png, apple-touch-icon.png')
console.log('Wrote Android icons: icon-android-192.png, icon-android-512.png, icon-192.png, icon-512.png')
