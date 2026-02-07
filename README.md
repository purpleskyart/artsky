# artsky

A **PWA** (Progressive Web App) that works as an app-style view for [Bluesky](https://bsky.app) (AT Protocol). Use it on your phone or desktop: masonry feed of images and videos, artboards to save posts, and comment on posts with your Bluesky account.

## Features

- **Feed**: Home timeline and custom Bluesky feeds in a masonry grid of images and videos.
- **Artboards**: Create boards and add posts from the feed; view and remove them later.
- **Comments**: Open any post, write a comment, and post it as a reply from your Bluesky account.
- **PWA**: Install on your phone or desktop; works offline for the UI (feed loads when online).

## Login

Use your **Bluesky handle** (or email) and an **App Password**.

1. In Bluesky go to **Settings → App passwords**.
2. Create a new app password and copy it.
3. In artsky, sign in with your handle and that app password (not your main account password).

## Deploy to GitHub Pages

1. Push this repo to GitHub (e.g. `https://github.com/YOUR_USERNAME/artsky`).

2. **Use GitHub Actions for Pages (required)**  
   In the repo go to **Settings → Pages → Build and deployment → Source** and set it to **GitHub Actions**.  
   If you use “Deploy from a branch”, the site will serve the repo’s raw files and the app will not load (you’ll see “Loading failed for the module with source …/src/main.tsx”).

3. Push to `main` (or re-run the “Deploy to GitHub Pages” workflow). The workflow builds the app and deploys the built files from `dist/`.

4. The app will be at: **`https://YOUR_USERNAME.github.io/artsky/`**  
   Open this exact URL (including the `/artsky/` path). Do not open the repo root or a raw file.

5. On your phone, open that URL in Safari/Chrome and use “Add to Home Screen” to install the PWA.

### “Loading failed for the module” or “Disallowed MIME type (text/html)”

The **built** app is not being served; the server is sending the repo’s raw `index.html`, which points at `src/main.tsx` (source, not a built bundle).

- **Fix:** In the repo go to **Settings → Pages → Build and deployment → Source** and set it to **GitHub Actions**. Then trigger a deploy (push to `main` or re-run the workflow). The workflow deploys the contents of `dist/` (the built app).

- **URL:** Open **`https://YOUR_USERNAME.github.io/artsky/`** (with the trailing slash). The app’s `base` is `./`, so use the full path; it will not work at `https://YOUR_USERNAME.github.io/` alone.

## Local development

```bash
npm install
npm run dev
```

Open **http://localhost:5173/** (dev uses base `/`). For production-like base path locally, run `npm run build && npm run preview` and open the URL shown (e.g. with base `/artsky/`).

## Tech

- **Vite** + **React** + **TypeScript**
- **@atproto/api** for Bluesky (timeline, feeds, post, reply)
- **react-router-dom** (HashRouter for GitHub Pages)
- **vite-plugin-pwa** for manifest and service worker
- Artboards and session stored in **localStorage** (no backend)

## Guest feed (logged-out users)

When users are not signed in, the feed shows posts from a fixed list of Bluesky accounts and a preview section with links to their profiles. To change which accounts appear:

- **Edit** `src/config/guestFeed.ts`  
  Each entry has a `handle` (e.g. `studio.blender.org`) and a `label` (e.g. `Blender`) used in the UI. Add, remove, or reorder entries there; the feed and the preview section update automatically.

## Repo structure

- `src/config/guestFeed.ts` – **Guest feed accounts** (edit this to change what logged-out users see)
- `src/lib/bsky.ts` – Bluesky agent, session persistence, feed/reply helpers
- `src/lib/artboards.ts` – Artboard CRUD in localStorage
- `src/pages/` – Login, Feed, Artboards, Artboard detail, Post detail
- `src/components/` – Layout, FeedSelector, PostCard, etc.

## License

AGPL-3.0-or-later. See [LICENSE](LICENSE).
