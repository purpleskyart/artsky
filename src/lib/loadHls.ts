/**
 * Dynamically imports hls.js only when needed for video playback.
 * This reduces the initial bundle size by lazy-loading the video library.
 */
export async function loadHls() {
  const { default: Hls } = await import('hls.js')
  return Hls
}
