# Fix: "Loading failed for the module …/src/main.tsx"

That error means GitHub Pages is serving the **repo’s raw files** (including `index.html` that points at `src/main.tsx`) instead of the **built** app. Do these three steps:

## 1. Use GitHub Actions as the Pages source

1. Open your repo on GitHub: **https://github.com/slrgt/artsky**
2. Go to **Settings** → **Pages**
3. Under **Build and deployment**, set **Source** to **GitHub Actions** (not "Deploy from a branch")
4. Save

## 2. Run a deploy from the main branch

1. Go to **Actions** → **Deploy to GitHub Pages**
2. Click **Run workflow**
3. Choose branch **main**
4. Click **Run workflow**
5. Wait for the workflow to finish (green checkmark)

## 3. Open the correct URL and refresh

- Open **https://slrgt.github.io/artsky/** (include the trailing slash)
- If you still see the error, do a hard refresh: **Ctrl+Shift+R** (Windows/Linux) or **Cmd+Shift+R** (Mac)

After this, the live site will be the built app. Future pushes to `main` will deploy automatically.

---

## Fix: "429 - This endpoint is temporarily being throttled" (Jekyll build)

That error means GitHub is running the **default Jekyll** Pages workflow instead of this repo’s **Vite** workflow. Jekyll then hits the GitHub API rate limit when fetching repo metadata.

**Fix:** Use the Actions-based workflow only, so Jekyll never runs:

1. Open **https://github.com/slrgt/artsky** → **Settings** → **Pages**
2. Under **Build and deployment**, set **Source** to **GitHub Actions** (not "Deploy from a branch")
3. Save

After that, only the **Deploy to GitHub Pages** workflow runs (Node + Vite build). The built-in Jekyll workflow will no longer run, so the 429 error goes away. Then run the workflow from the Actions tab (branch **main**) to deploy.
