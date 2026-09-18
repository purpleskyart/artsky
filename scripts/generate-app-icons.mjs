/**
 * Rasterize SVG icons to PNGs for iOS home screen and PWA manifests.
 * Creates native-looking icons:
 * - iOS: Apple-style soft gradient with squircle shape
 * - Android: Material Design 3 style with elevation
 * Run automatically from `npm run build`; run manually after editing the SVGs.
 */
import { mkdirSync, readFileSync } from 'node:fs'
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

await sharp(iosSvg, { density: 300 })
  .resize(32, 32)
  .png()
  .toFile(join(root, 'public', 'favicon.ico'))

// Android icons - Material Design 3 style
const androidSvgPath = join(root, 'public', 'icon-android.svg')
const androidSvg = readFileSync(androidSvgPath)

const androidIcons = [
  ['icon-android-192.png', 192],
  ['icon-android-512.png', 512],
  ['icon-192.png', 192],  // Legacy
  ['icon-512.png', 512],  // Legacy
  ['icon-72.png', 72],  // Notification badge (sw.ts)
]

for (const [name, size] of androidIcons) {
  await sharp(androidSvg, { density: 300 })
    .resize(size, size)
    .png()
    .toFile(join(root, 'public', name))
}

console.log('Wrote iOS icons: icon-ios-180.png, icon-ios-120.png, apple-touch-icon.png, favicon.ico')
console.log('Wrote Android icons: icon-android-192.png, icon-android-512.png, icon-192.png, icon-512.png, icon-72.png')

// ============================================================================
// iOS launch splash screens
// ============================================================================
// iOS PWAs show a blank white flash on launch unless `apple-touch-startup-image`
// links exist for each device class. We generate one image per device
// (portrait + landscape, dark + light theme) from the iOS icon on a solid
// background matching each theme's --bg. Excluded from the SW precache (see
// vite.config.ts globIgnores): iOS renders these from its own home-screen
// snapshot cache, so serving them from the service worker is pointless.

mkdirSync(join(root, 'public', 'splash'), { recursive: true })

/** Devices: CSS px width/height in portrait + device pixel ratio. */
const SPLASH_DEVICES = [
  [375, 667, 2],   // iPhone SE 2/3, 6/7/8
  [375, 812, 3],   // iPhone X/XS/11 Pro, 12/13 mini
  [390, 844, 3],   // iPhone 12/13/14
  [393, 852, 3],   // iPhone 14 Pro, 15, 15 Pro, 16
  [402, 874, 3],   // iPhone 16 Pro
  [414, 736, 3],   // iPhone 6/7/8 Plus
  [414, 896, 2],   // iPhone XR, 11
  [414, 896, 3],   // iPhone XS Max, 11 Pro Max
  [428, 926, 3],   // iPhone 12/13 Pro Max, 14 Plus
  [430, 932, 3],   // iPhone 14/15 Pro Max, 16 Plus
  [440, 956, 3],   // iPhone 16 Pro Max
  [768, 1024, 2],  // iPad mini / legacy
  [810, 1080, 2],  // iPad 7/8/9
  [820, 1180, 2],  // iPad Air 4/5, iPad 10
  [834, 1112, 2],  // iPad Air 3, Pro 10.5
  [834, 1194, 2],  // iPad Pro 11
  [1024, 1366, 2], // iPad Pro 12.9
]

const SPLASH_THEMES = [
  { suffix: 'dark', background: '#0f0f1a' },
  { suffix: 'light', background: '#fdf6f9' },
]

const iosSplashIcon = await sharp(iosSvg, { density: 300 }).png().toBuffer()

for (const [cssW, cssH, dpr] of SPLASH_DEVICES) {
  for (const orientation of ['portrait', 'landscape']) {
    const [css, other] = orientation === 'portrait' ? [cssW, cssH] : [cssH, cssW]
    const pxW = css * dpr
    const pxH = other * dpr
    const iconSize = Math.max(80, Math.round(Math.min(pxW, pxH) * 0.16))
    const icon = await sharp(iosSplashIcon)
      .resize(iconSize, iconSize)
      .png()
      .toBuffer()
    for (const { suffix, background } of SPLASH_THEMES) {
      await sharp({
        create: { width: pxW, height: pxH, channels: 4, background },
      })
        .composite([
          {
            input: icon,
            top: Math.round((pxH - iconSize) / 2),
            left: Math.round((pxW - iconSize) / 2),
          },
        ])
        .png({ compressionLevel: 9 })
        .toFile(join(root, 'public', 'splash', `apple-splash-${pxW}x${pxH}-${suffix}.png`))
    }
  }
}

console.log(`Wrote ${SPLASH_DEVICES.length * 4} iOS splash screens to public/splash/`)
