import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
// Default /. Dev site uses VITE_BASE_PATH=/artsky-dev/ in CI.
const base = process.env.VITE_BASE_PATH ?? '/'

export default defineConfig({
  base,
  define: {
    // Automatically inject build timestamp for version tracking
    'import.meta.env.VITE_BUILD_TIMESTAMP': JSON.stringify(new Date().toISOString()),
  },
  server: {
    host: '0.0.0.0', // Listen on all interfaces (IPv4 and IPv6)
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        globIgnores: [
          // iOS renders startup images from its own home-screen snapshot; the SW
          // never needs them (and they'd bloat the precache).
          '**/apple-splash-*.png',
          '**/video-*.js',
          '**/ProfilePage-*.js',
          '**/ProfilePage-*.css',
          '**/PostDetailPage-*.js',
          '**/PostDetailPage-*.css',
          '**/TagPage-*.js',
          '**/TagPage-*.css',
          '**/CollectionPage-*.js',
          '**/CollectionPage-*.css',
          '**/CollectionsIndexPage-*.js',
          '**/CollectionsIndexPage-*.css',
          '**/PostModalOverlay-*.js',
          '**/ProfileModalOverlay-*.js',
          '**/PostDetailModal-*.js',
          '**/ProfileModal-*.js',
          '**/QuotesModal-*.js',
          '**/QuotesModal-*.css',
          '**/SearchModal-*.js',
          '**/SearchModal-*.css',
          '**/EditProfileModal-*.js',
          '**/EditProfileModal-*.css',
          '**/AppModal-*.js',
          '**/AppModal-*.css',
          '**/TagModal-*.js',
          '**/CollectionsIndexModalOverlay-*.js',
          '**/CollectionBoardModalOverlay-*.js',
        ],
        maximumFileSizeToCacheInBytes: 2 * 1024 * 1024,
      },
      includeAssets: [
        'favicon.ico',
        'icon.svg',
        'icon-pwa.svg',
        'icon-app.svg',
        'apple-touch-icon.png',
        'icon-192.png',
        'icon-512.png',
        'icon-72.png',
      ],
      manifest: {
        id: '/',
        name: 'PurpleSky',
        short_name: 'PurpleSky',
        description: 'Bluesky feed for art',
        theme_color: '#0f0f1a',
        background_color: '#0f0f1a',
        display: 'standalone',
        display_override: ['standalone', 'minimal-ui'],
        orientation: 'portrait',
        scope: './',
        start_url: './',
        /* Focus the running app instead of opening a second window on link taps. */
        launch_handler: { client_mode: 'navigate-existing' },
        /* Long-press app-icon shortcuts. The ?params are consumed once at startup in Layout. */
        shortcuts: [
          {
            name: 'Compose a post',
            short_name: 'Compose',
            url: './?compose=1',
            icons: [{ src: './icon-192.png', sizes: '192x192' }],
          },
          {
            name: 'Notifications',
            short_name: 'Inbox',
            url: './?notifications=1',
            icons: [{ src: './icon-192.png', sizes: '192x192' }],
          },
          {
            name: 'Messages',
            short_name: 'Messages',
            url: './?messages=1',
            icons: [{ src: './icon-192.png', sizes: '192x192' }],
          },
        ],
        /* Accept shares from other apps; the SW stashes the POST and redirects to ?share=1,
           where Layout opens the composer prefilled (text + image files). */
        share_target: {
          action: './share-target',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            title: 'title',
            text: 'text',
            url: 'url',
            files: [{ name: 'media', accept: ['image/*', 'video/*'] }],
          },
        },
        icons: [
          { src: './icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: './icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: './icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      // NOTE: with `strategies: 'injectManifest'` the workbox.runtimeCaching option is
      // ignored — runtime caching routes live in src/sw.ts instead.
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Split vendor chunks for better caching
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          // Lazy load heavy dependencies
          'atproto-api': ['@atproto/api'],
          'atproto-oauth': ['@atproto/oauth-client-browser'],
          'video': ['hls.js'],
        },
      },
    },
    // Enable tree-shaking and minification
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true, // Remove console.log in production
        drop_debugger: true,
      },
    },
    // Optimize chunk size
    chunkSizeWarningLimit: 1000,
  },
  // Enable dependency pre-bundling optimization (CJS packages like @atproto/api must be pre-bundled so named exports work in ESM)
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom', '@atproto/api', '@atproto/oauth-client-browser'],
    exclude: ['hls.js'],
  },
})
