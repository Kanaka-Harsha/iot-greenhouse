// Backend API client. VITE_API_URL = the ngrok https URL (Vercel) or http://localhost:8000 (local).
export const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/+$/, '')
const RELAY_KEY = import.meta.env.VITE_RELAY_API_KEY || ''

// Free ngrok URLs show an HTML "browser warning" page instead of the API response
// unless this header is sent. Any value works.
const BASE_HEADERS = { 'ngrok-skip-browser-warning': 'true' }

async function request(path, options = {}) {
  const res = await fetch(API_URL + path, {
    ...options,
    headers: { ...BASE_HEADERS, ...(options.headers || {}) },
  })
  const type = res.headers.get('content-type') || ''
  if (!type.includes('application/json')) {
    throw new Error(`Backend did not return JSON (HTTP ${res.status}). Is VITE_API_URL the current ngrok URL?`)
  }
  const body = await res.json()
  if (!res.ok) {
    const detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
    throw new Error(detail || `HTTP ${res.status}`)
  }
  return body
}

export const getHealth = () => request('/api/health')
export const getLatest = () => request('/api/sensors/latest')
export const getHistory = (sensor, limit = 40) =>
  request(`/api/sensors/history?sensor=${encodeURIComponent(sensor)}&limit=${limit}`)
export const getRelayHistory = (limit = 5) => request(`/api/relay/history?limit=${limit}`)

export const sendRelay = (command) =>
  request('/api/relay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(RELAY_KEY ? { 'X-API-Key': RELAY_KEY } : {}) },
    body: JSON.stringify({ command }),
  })
