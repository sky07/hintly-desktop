// Single source of truth for backend connection URLs.
//
// Flip USE_LOCAL_BACKEND to `true` to point the desktop app at a local
// backend (uvicorn on :8000). Leave `false` to use the Railway production
// backend.
//
// Env vars (REACT_APP_API_URL / REACT_APP_WS_URL) still win if set, so CI
// builds and per-machine overrides keep working.

const USE_LOCAL_BACKEND = false

const LOCAL_API_URL = 'http://localhost:8000'
const LOCAL_WS_URL = 'ws://localhost:8000/ws'

const PROD_API_URL = 'https://hintly-backend-production.up.railway.app'
const PROD_WS_URL = 'wss://hintly-backend-production.up.railway.app/ws'

const envApiUrl =
  typeof process !== 'undefined' ? process.env?.REACT_APP_API_URL : undefined
const envWsUrl =
  typeof process !== 'undefined' ? process.env?.REACT_APP_WS_URL : undefined

export const API_BASE =
  envApiUrl || (USE_LOCAL_BACKEND ? LOCAL_API_URL : PROD_API_URL)

export const WS_URL =
  envWsUrl || (USE_LOCAL_BACKEND ? LOCAL_WS_URL : PROD_WS_URL)
