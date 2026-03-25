import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Start loading the feed route chunk in parallel with the first React render (default route is /feed).
void import('./pages/FeedPage')

createRoot(document.getElementById('root')!).render(<App />)
