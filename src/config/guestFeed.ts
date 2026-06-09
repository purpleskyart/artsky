/**
 * Guest feed accounts
 *
 * When users are not logged in, the feed shows posts from these Bluesky accounts
 * and a preview section linking to their profiles. Edit this list to change which
 * accounts appear.
 *
 * - handle: Bluesky handle (e.g. studio.blender.org)
 * - label: Short name shown in the UI (e.g. "Blender", "Godot Engine")
 */
export const GUEST_FEED_ACCOUNTS = [
  { handle: 'oseanworld.bsky.social', label: 'Osean World' },
  { handle: 'sssvvv.bsky.social', label: 'sssvvv' },
  { handle: 'poiandkeely.bsky.social', label: 'Poi and Keely' },
  { handle: 'shio-to-no.bsky.social', label: 'Shio To No' },
  { handle: 'asteroidill.bsky.social', label: 'Asteroidill' },
  { handle: 'kianamai.bsky.social', label: 'Kianamai' },
  { handle: 'catsuka.bsky.social', label: 'Catsuka' },
  { handle: 'discountvillain.bsky.social', label: 'Discount Villain' },
  { handle: 'gaya20001026.bsky.social', label: 'Ga Ya' },
  { handle: 'onepiececolor.bsky.social', label: '𝐎𝐍𝐄 𝐏𝐈𝐄𝐂𝐄' },
  { handle: 'minbitt.bsky.social', label: 'Minbitt' },
  { handle: 'pyawakit.bsky.social', label: 'Pyawakit' },
  { handle: 'goomyloid.bsky.social', label: 'Goomyloid' },
  { handle: 'saredd99.bsky.social', label: 'Saredd99' },
  { handle: 'sarenstone.com', label: 'SAREN' },
  { handle: 'certly.bsky.social', label: 'Certly' },
  { handle: 'cardbordtoaster.bsky.social', label: 'Toaster' },
  { handle: 'bemmpo.bsky.social', label: 'Bemmpo' },



] as const

export type GuestFeedAccount = (typeof GUEST_FEED_ACCOUNTS)[number]
