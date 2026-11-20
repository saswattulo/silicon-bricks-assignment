import { createRoot } from 'react-dom/client'
import { setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import App from './App.tsx'

setWorkerUrl(workerUrl)

createRoot(document.getElementById('root')!).render(<App />)
