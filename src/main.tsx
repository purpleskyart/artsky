import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Start loading the feed route chunk in parallel with the first React render (default route is /feed).
void import('./pages/FeedPage')

// Listen for messages from service worker (e.g., navigation on notification click)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'NAVIGATE' && event.data.url) {
      // Navigate to the URL provided by the service worker
      window.location.href = event.data.url
    }
  })
}

createRoot(document.getElementById('root')!).render(<App />)
