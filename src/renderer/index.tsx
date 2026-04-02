import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

const root = createRoot(document.getElementById('root')!)
// Note: StrictMode disabled — it double-invokes effects in dev,
// causing duplicate WebSocket connections and audio capture conflicts.
root.render(<App />)
