/**
 * standard.site lexicon is used only for blog posts:
 * - Blog postcards on the home screen (from blogs you follow)
 * - Profile "Blog" tab (site.standard.document records)
 *
 * Optional: publication URLs to discover blog documents (e.g. for a blog discovery view).
 * The app fetches /.well-known/site.standard.publication from each URL to get the AT-URI.
 * Forum posts use the AT Protocol forum lexicon; see config/forumLexicon.ts.
 */
export const STANDARD_SITE_DISCOVERY_URLS = [
  'https://pckt.blog',
  'https://leaflet.pub',
  'https://offprint.app',
]
