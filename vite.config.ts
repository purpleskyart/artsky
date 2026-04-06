import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
// GitHub project pages: main → /artsky/, dev → /artsky-dev/ (set VITE_BASE_PATH in CI)
const isProd = process.env.NODE_ENV === 'production'
const base = process.env.VITE_BASE_PATH ?? (isProd ? '/artsky/' : '/')
export default defineConfig({
  base,
  server: {
    host: '0.0.0.0', // Listen on all interfaces (IPv4 and IPv6)
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: [
        'favicon.ico',
        'icon.svg',
        'icon-pwa.svg',
        'icon-app.svg',
        'apple-touch-icon.png',
        'icon-192.png',
        'icon-512.png',
      ],
      manifest: {
        name: 'PurpleSky',
        short_name: 'PurpleSky',
        description: 'Bluesky feed for art',
        theme_color: '#5b21b6',
        background_color: '#4c1d95',
        display: 'standalone',
        orientation: 'portrait',
        scope: './',
        start_url: './',
        icons: [
          { src: './icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: './icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: './icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        globIgnores: [
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
        navigateFallback: './index.html',
        maximumFileSizeToCacheInBytes: 2 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/(cdn\.bsky\.app|wsrv\.nl)\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'artsky-images',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 7, // 7 days
              },
            },
          },
          {
            urlPattern: ({ request, url }) =>
              request.mode === 'navigate' ? false : /\/assets\/[^/]+\.(?:js|css)$/.test(url.pathname),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'artsky-assets-runtime',
              expiration: {
                maxEntries: 120,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
            },
          },
        ],
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Split vendor chunks for better caching
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          // Lazy load heavy dependencies
          'atproto': ['@atproto/api', '@atproto/oauth-client-browser'],
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
    chunkSizeWarningLimit: 500,
  },
  // Enable dependency pre-bundling optimization (CJS packages like @atproto/api must be pre-bundled so named exports work in ESM)
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom', '@atproto/api', '@atproto/oauth-client-browser'],
    exclude: ['hls.js'],
  },
})
