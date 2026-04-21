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
  { handle: 'certly.bsky.social', label: 'Certly' },
  { handle: 'discountvillain.bsky.social', label: 'Discount Villain' },
  { handle: 'xenonb.bsky.social', label: 'Xenonb' },
  { handle: 'asteroidill.bsky.social', label: 'Asteroidill' },
  { handle: 'poiandkeely.bsky.social', label: 'Poi and Keely' },
  { handle: 'gaya20001026.bsky.social', label: 'Ga Ya' },
  { handle: 'bemmpo.bsky.social', label: 'Bemmpo' },
  { handle: 'onepiececolor.bsky.social', label: '𝐎𝐍𝐄 𝐏𝐈𝐄𝐂𝐄' },
  { handle: 'minbitt.bsky.social', label: 'Minbitt' },
  { handle: 'pyawakit.bsky.social', label: 'Pyawakit' },
  { handle: 'shio-to-no.bsky.social', label: 'Shio To No' },
  { handle: 'goomyloid.bsky.social', label: 'Goomyloid' },
  { handle: 'saredd99.bsky.social', label: 'Saredd99' },
  { handle: 'kianamai.bsky.social', label: 'Kianamai' },
  { handle: 'anatofinnstark.bsky.social', label: 'Anatofinnstark' },

] as const

export type GuestFeedAccount = (typeof GUEST_FEED_ACCOUNTS)[number]
