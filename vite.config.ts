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
      includeAssets: ['favicon.ico', 'icon.svg', 'icon-pwa.svg'],
      manifest: {
        name: 'ArtSky',
        short_name: 'ArtSky',
        description: 'Bluesky feed & artboards',
        theme_color: '#1a1a2e',
        background_color: '#0f0f1a',
        display: 'standalone',
        orientation: 'portrait',
        scope: './',
        start_url: './',
        icons: [
          { src: './icon-pwa.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        navigateFallback: './index.html',
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024, // 3 MiB (main chunk exceeds 2 MiB default)
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
