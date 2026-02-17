/**
 * Forum uses the AT Protocol forum lexicon (app.artsky.forum.post, app.artsky.forum.reply).
 * This config is for discovering forum posts in the Forums UI (Discover tab).
 *
 * Standard.site lexicon is separate: used only for blog postcards on the home screen
 * (from blogs you follow) and the profile Blog tab. See forumDiscovery.ts and bsky.ts.
 */
export const FORUM_LEXICON_NSID_POST = 'app.artsky.forum.post'
export const FORUM_LEXICON_NSID_REPLY = 'app.artsky.forum.reply'

/** DIDs to list forum posts from for the Discover "all" tab (in addition to you + people you follow). */
export const FORUM_DISCOVERY_DIDS: string[] = []
