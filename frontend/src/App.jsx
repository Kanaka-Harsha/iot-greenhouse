import { useCallback, useEffect, useRef, useState } from 'react'
import { API_URL, getHealth, getHistory, getLatest, getRelayHistory, sendRelay } from './api.js'

const POLL_LATEST_MS = 5000
const POLL_HISTORY_MS = 30000
const POLL_HEALTH_MS = 10000
const STALE_AFTER_S = 120

// ------------------------------------------------------------------ helpers
const fmt = (v, d = 1) => (v === null || v === undefined ? '–' : Number(v).toFixed(d))

function ago(iso, now) {
  if (!iso) return 'no data yet'
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return new Date(iso).toLocaleString()
}

const isStale = (iso, now) => !iso || (now - new Date(iso).getTime()) / 1000 > STALE_AFTER_S

function usePolling(fn, ms, deps = []) {
  useEffect(() => {
    let alive = true
    const tick = () => alive && fn()
    tick()
    const id = setInterval(tick, ms)
    return () => { alive = false; clearInterval(id) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

// ------------------------------------------------------------------ small components
function Sparkline({ values, max }) {
  const pts = values.filter((v) => v !== null && v !== undefined)
  if (pts.length < 2) return <div className="spark empty">trend appears after a few readings</div>
  const lo = Math.min(...pts), hi = max ?? Math.max(...pts)
  const span = hi - lo || 1
  const W = 240, H = 44
  const d = pts
    .map((v, i) => `${i ? 'L' : 'M'}${((i / (pts.length - 1)) * W).toFixed(1)} ${(H - 4 - ((v - lo) / span) * (H - 8)).toFixed(1)}`)
    .join(' ')
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  )
}

function Card({ title, topic, reading, now, children }) {
  const stale = isStale(reading?.created_at, now)
  return (
    <section className="card">
      <header className="card-head">
        <h2>{title}</h2>
        <span className={`badge ${reading ? (stale ? 'warn' : 'ok') : 'off'}`}>
          {reading ? (stale ? 'stale' : 'live') : 'waiting'}
        </span>
      </header>
      {children}
      <footer className="card-foot">
        <code>{topic}</code>
        <span title={reading?.created_at ? new Date(reading.created_at).toLocaleString() : ''}>
          {ago(reading?.created_at, now)}
        </span>
      </footer>
    </section>
  )
}

function Toasts({ items, onClose }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => onClose(t.id)}>
          {t.text}
        </div>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------ app
export default function App() {
  const [latest, setLatest] = useState(null)
  const [history, setHistory] = useState({ co2: [], npk: [], soil_moisture: [] })
  const [health, setHealth] = useState(null)
  const [relayLog, setRelayLog] = useState([])
  const [error, setError] = useState('')
  const [pending, setPending] = useState(null)
  const [toasts, setToasts] = useState([])
  const [now, setNow] = useState(Date.now())
  const toastId = useRef(0)

  const toast = useCallback((text, kind = 'info') => {
    const id = ++toastId.current
    setToasts((t) => [...t, { id, text, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500)
  }, [])

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  usePolling(async () => {
    try {
      setLatest(await getLatest())
      setError('')
    } catch (e) {
      setError(e.message || String(e))
    }
  }, POLL_LATEST_MS)

  usePolling(async () => {
    try {
      const [co2, npk, soil] = await Promise.all([getHistory('co2'), getHistory('npk'), getHistory('soil_moisture')])
      setHistory({ co2: co2.reverse(), npk: npk.reverse(), soil_moisture: soil.reverse() })
    } catch { /* shown by the latest poll */ }
  }, POLL_HISTORY_MS)

  const refreshRelayLog = useCallback(async () => {
    try { setRelayLog(await getRelayHistory(5)) } catch { /* ignore */ }
  }, [])

  usePolling(async () => {
    try { setHealth(await getHealth()) } catch { setHealth(null) }
    refreshRelayLog()
  }, POLL_HEALTH_MS)

  async function relay(command) {
    setPending(command)
    try {
      const r = await sendRelay(command)
      toast(`Relay ${command.toUpperCase()} sent: ${JSON.stringify(r.payload)} → ${r.topic}`, 'ok')
    } catch (e) {
      toast(`Relay ${command.toUpperCase()} failed: ${e.message}`, 'err')
    } finally {
      setPending(null)
      refreshRelayLog()
    }
  }

  const co2 = latest?.co2, npk = latest?.npk, soil = latest?.soil_moisture
  const mqttOk = health?.mqtt === 'connected'
  const dbOk = health?.database === 'ok'
  const lastCmd = relayLog[0]

  return (
    <div className="page">
      <header className="top">
        <div>
          <h1>🌱 Greenhouse monitor</h1>
          <p className="sub">Live from AWS IoT · refreshes every {POLL_LATEST_MS / 1000} s</p>
        </div>
        <div className="status">
          <span className={`pill ${health ? 'ok' : 'err'}`}>API {health ? 'online' : 'offline'}</span>
          <span className={`pill ${mqttOk ? 'ok' : 'err'}`}>MQTT {health ? health.mqtt : '–'}</span>
          <span className={`pill ${dbOk ? 'ok' : 'err'}`}>DB {health ? health.database : '–'}</span>
        </div>
      </header>

      {error && (
        <div className="banner">
          Cannot reach the backend at <code>{API_URL}</code>: {error}
        </div>
      )}

      <main className="grid">
        <Card title="CO₂" topic="sensor/co2" reading={co2} now={now}>
          <div className="big">{fmt(co2?.co2_ppm, 0)}<span className="unit">ppm</span></div>
          <Sparkline values={history.co2.map((r) => r.co2_ppm)} />
        </Card>

        <Card title="Soil moisture" topic="sensor/soil-moisture" reading={soil} now={now}>
          <div className="big">{fmt(soil?.soil_moisture)}<span className="unit">%</span></div>
          <div className="meter" aria-label="soil moisture">
            <div style={{ width: `${Math.min(100, Math.max(0, soil?.soil_moisture ?? 0))}%` }} />
          </div>
          <Sparkline values={history.soil_moisture.map((r) => r.soil_moisture)} />
        </Card>

        <Card title="NPK" topic="sensor/npk" reading={npk} now={now}>
          <div className="npk">
            {[['N', 'Nitrogen', npk?.nitrogen], ['P', 'Phosphorus', npk?.phosphorus], ['K', 'Potassium', npk?.potassium]].map(
              ([sym, name, v]) => (
                <div key={sym} className="npk-item" title={name}>
                  <div className="npk-sym">{sym}</div>
                  <div className="npk-val">{fmt(v, 0)}</div>
                  <div className="unit">mg/kg</div>
                </div>
              ),
            )}
          </div>
          <Sparkline values={history.npk.map((r) => r.nitrogen)} />
          <div className="hint">trend: nitrogen</div>
        </Card>

        <section className="card relay">
          <header className="card-head">
            <h2>Relay</h2>
            <span className={`badge ${lastCmd?.status === 'published' ? (lastCmd.command === 'on' ? 'ok' : 'off') : 'off'}`}>
              {lastCmd ? `last: ${lastCmd.command.toUpperCase()}` : 'no command yet'}
            </span>
          </header>
          <div className="buttons">
            <button className="btn on" disabled={!!pending} onClick={() => relay('on')}>
              {pending === 'on' ? 'Sending…' : 'ON'}
            </button>
            <button className="btn off" disabled={!!pending} onClick={() => relay('off')}>
              {pending === 'off' ? 'Sending…' : 'OFF'}
            </button>
          </div>
          {!mqttOk && health && <p className="hint warn-text">Backend is not connected to AWS IoT: commands will fail.</p>}
          <ul className="log">
            {relayLog.map((r) => (
              <li key={r.id}>
                <span className={`dot ${r.status === 'published' ? 'ok' : 'err'}`} />
                <b>{r.command.toUpperCase()}</b> {r.status}
                <span className="muted"> · {ago(r.created_at, now)}</span>
                {r.error && <div className="muted small">{r.error}</div>}
              </li>
            ))}
          </ul>
          <footer className="card-foot">
            <code>action/relay</code>
            <span className="nowrap">{'{"command": "on"|"off"}'}</span>
          </footer>
        </section>
      </main>

      <footer className="page-foot">
        Backend: <code>{API_URL}</code>
        {health?.stats && <> · {health.stats.stored} messages stored this session</>}
      </footer>

      <Toasts items={toasts} onClose={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
    </div>
  )
}
