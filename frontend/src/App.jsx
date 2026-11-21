import { useCallback, useEffect, useRef, useState } from 'react'
import { API_URL, getHealth, getHistory, getLatest, getRelayHistory, sendRelay } from './api.js'

const POLL_LATEST_MS = 5000
const POLL_HISTORY_MS = 30000
const POLL_HEALTH_MS = 10000
const STALE_AFTER_S = 120

// ------------------------------------------------------------------ Inline SVG Botanical Icons (Zero Emojis)
function GreenhouseLogo() {
  return (
    <svg className="icon logo-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2L2 9v13h20V9L12 2z" />
      <path d="M12 2v20" />
      <path d="M2 13h20" />
      <path d="M7 9l5 4 5-4" />
      <path d="M12 18c-2-2-2-4 0-6 2 2 2 4 0 6z" fill="currentColor" fillOpacity="0.25" />
    </svg>
  )
}

function Co2Icon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 12a4 4 0 1 0 8 0 4 4 0 1 0-8 0" />
      <path d="M3 10h2" />
      <path d="M19 10h2" />
      <path d="M4 16h4" />
      <path d="M16 16h4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
    </svg>
  )
}

function MoistureIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />
      <path d="M12 9v5" />
      <circle cx="12" cy="17" r="1" fill="currentColor" />
    </svg>
  )
}

function NutrientIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 2v7.31M14 2v7.31" />
      <path d="M8.5 2h7" />
      <path d="M14 9.3l5.8 8.7a2 2 0 0 1-1.7 3H5.9a2 2 0 0 1-1.7-3L10 9.3" />
      <circle cx="9" cy="16" r="1" fill="currentColor" />
      <circle cx="14" cy="15" r="1" fill="currentColor" />
      <circle cx="12" cy="18" r="1" fill="currentColor" />
    </svg>
  )
}

function ValveIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="8" width="20" height="8" rx="2" />
      <path d="M12 4v4" />
      <circle cx="12" cy="4" r="2" />
      <path d="M6 12h.01" />
      <path d="M18 12h.01" />
    </svg>
  )
}

function DownloadIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

function RefreshIcon({ spinning }) {
  return (
    <svg className={`icon ${spinning ? 'spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
    </svg>
  )
}

// ------------------------------------------------------------------ helpers
const fmt = (v, d = 1) => (v === null || v === undefined ? '–' : Number(v).toFixed(d))

function ago(iso, now) {
  if (!iso) return 'Sensor Pending'
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
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

function Sparkline({ values, max, color = 'var(--accent)' }) {
  const pts = values.filter((v) => v !== null && v !== undefined)
  if (pts.length < 2) {
    return (
      <div className="spark empty">
        <span className="dot-pulse" />
        <span>Synthesizing baseline telemetry</span>
      </div>
    )
  }
  const lo = Math.min(...pts)
  const hi = max ?? Math.max(...pts)
  const span = hi - lo || 1
  const W = 280
  const H = 48
  const d = pts
    .map((v, i) => `${i ? 'L' : 'M'}${((i / (pts.length - 1)) * W).toFixed(1)} ${(H - 6 - ((v - lo) / span) * (H - 12)).toFixed(1)}`)
    .join(' ')
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function Card({ icon: Icon, title, zone, subtitle, topic, reading, now, children, statusText }) {
  const stale = isStale(reading?.created_at, now)
  const hasData = reading !== null && reading !== undefined

  return (
    <section className="card">
      <header className="card-head">
        <div className="card-title-group">
          <div className="card-icon-wrap">
            <Icon />
          </div>
          <div>
            <div className="card-zone-tag">{zone}</div>
            <h2>{title}</h2>
            {subtitle && <p className="card-subtitle">{subtitle}</p>}
          </div>
        </div>
        <div className="card-badges">
          <span className={`badge ${hasData ? (stale ? 'warn' : 'ok') : 'off'}`}>
            <span className="badge-pip" />
            {hasData ? (stale ? 'Stale Signal' : 'Live Feed') : 'Awaiting Link'}
          </span>
        </div>
      </header>

      <div className="card-body">
        {children}
      </div>

      <footer className="card-foot">
        <div className="foot-left">
          <span className="channel-topic">{topic}</span>
          {statusText && <span className="foot-status-text">{statusText}</span>}
        </div>
        <div className="foot-timestamp" title={reading?.created_at ? new Date(reading.created_at).toLocaleString() : ''}>
          {ago(reading?.created_at, now)}
        </div>
      </footer>
    </section>
  )
}

function Toasts({ items, onClose }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => onClose(t.id)}>
          <div className="toast-icon">
            {t.kind === 'ok' ? <CheckIcon /> : <CloseIcon />}
          </div>
          <div className="toast-content">{t.text}</div>
        </div>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------ Main Application
export default function App() {
  const [latest, setLatest] = useState(null)
  const [history, setHistory] = useState({ co2: [], npk: [], soil_moisture: [] })
  const [health, setHealth] = useState(null)
  const [relayLog, setRelayLog] = useState([])
  const [error, setError] = useState('')
  const [pending, setPending] = useState(null)
  const [toasts, setToasts] = useState([])
  const [now, setNow] = useState(Date.now())
  const [manualRefreshing, setManualRefreshing] = useState(false)

  // PWA Installation handling
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [isInstalled, setIsInstalled] = useState(false)
  const [showIosPrompt, setShowIosPrompt] = useState(false)

  const toastId = useRef(0)

  const toast = useCallback((text, kind = 'info') => {
    const id = ++toastId.current
    setToasts((t) => [...t, { id, text, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500)
  }, [])

  // Check if running as installed standalone PWA
  useEffect(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
    if (isStandalone) {
      setIsInstalled(true)
    }

    const onBeforeInstall = (e) => {
      e.preventDefault()
      setDeferredPrompt(e)
    }

    const onAppInstalled = () => {
      setIsInstalled(true)
      setDeferredPrompt(null)
      toast('BioSphere CEA Station installed to home screen', 'ok')
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onAppInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onAppInstalled)
    }
  }, [toast])

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt()
      const { outcome } = await deferredPrompt.userChoice
      if (outcome === 'accepted') {
        setIsInstalled(true)
        toast('Installing BioSphere CEA application', 'ok')
      }
      setDeferredPrompt(null)
    } else {
      const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream
      if (isIos) {
        setShowIosPrompt(true)
      } else {
        toast('PWA already installed or available via browser menu: Add to Home Screen', 'info')
      }
    }
  }

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const fetchLatestData = useCallback(async () => {
    try {
      setLatest(await getLatest())
      setError('')
    } catch (e) {
      setError(e.message || String(e))
    }
  }, [])

  const fetchHistoryData = useCallback(async () => {
    try {
      const [co2, npk, soil] = await Promise.all([getHistory('co2'), getHistory('npk'), getHistory('soil_moisture')])
      setHistory({ co2: co2.reverse(), npk: npk.reverse(), soil_moisture: soil.reverse() })
    } catch {
      /* handled in latest */
    }
  }, [])

  const refreshRelayLog = useCallback(async () => {
    try {
      setRelayLog(await getRelayHistory(5))
    } catch {
      /* ignore */
    }
  }, [])

  const fetchHealthData = useCallback(async () => {
    try {
      setHealth(await getHealth())
    } catch {
      setHealth(null)
    }
    refreshRelayLog()
  }, [refreshRelayLog])

  usePolling(fetchLatestData, POLL_LATEST_MS)
  usePolling(fetchHistoryData, POLL_HISTORY_MS)
  usePolling(fetchHealthData, POLL_HEALTH_MS)

  const handleManualRefresh = async () => {
    setManualRefreshing(true)
    await Promise.all([fetchLatestData(), fetchHistoryData(), fetchHealthData()])
    setTimeout(() => setManualRefreshing(false), 600)
    toast('Greenhouse telemetry refreshed', 'info')
  }

  async function relay(command) {
    setPending(command)
    try {
      const r = await sendRelay(command)
      const actionName = command === 'on' ? 'VALVE OPEN (DISCHARGING)' : 'VALVE CLOSED (ISOLATED)'
      toast(`Actuator Command Executed: ${actionName}`, 'ok')
    } catch (e) {
      toast(`Actuation Dispatch Failed: ${e.message}`, 'err')
    } finally {
      setPending(null)
      refreshRelayLog()
    }
  }

  const co2 = latest?.co2
  const npk = latest?.npk
  const soil = latest?.soil_moisture

  const mqttOk = health?.mqtt === 'connected'
  const dbOk = health?.database === 'ok'
  const lastCmd = relayLog[0]
  const isValveOpen = lastCmd?.status === 'published' && lastCmd?.command === 'on'

  // Agronomic calculations
  const co2Ppm = co2?.co2_ppm ?? null
  const soilMoisturePct = soil?.soil_moisture ?? null

  // CO2 agronomic band analysis
  let co2AgronomicNotice = 'Awaiting atmospheric telemetry'
  let co2BandClass = 'band-neutral'
  if (co2Ppm !== null) {
    if (co2Ppm < 450) {
      co2AgronomicNotice = 'Ambient Baseline (Depleted Canopy Assimilation)'
      co2BandClass = 'band-warn'
    } else if (co2Ppm <= 1200) {
      co2AgronomicNotice = 'Optimal Photosynthetic Enrichment Band'
      co2BandClass = 'band-optimal'
    } else {
      co2AgronomicNotice = 'High Concentration Canopy Condition'
      co2BandClass = 'band-high'
    }
  }

  // Soil moisture agronomic threshold analysis
  let soilAgronomicNotice = 'Awaiting substrate probe response'
  let soilBandClass = 'band-neutral'
  if (soilMoisturePct !== null) {
    if (soilMoisturePct < 25) {
      soilAgronomicNotice = 'Moisture Deficit (Root Turgor Stress Risk)'
      soilBandClass = 'band-err'
    } else if (soilMoisturePct <= 45) {
      soilAgronomicNotice = 'Field Capacity (Optimal Root Oxygenation)'
      soilBandClass = 'band-optimal'
    } else {
      soilAgronomicNotice = 'Substrate Saturation (Aeration Vigilance)'
      soilBandClass = 'band-warn'
    }
  }

  return (
    <div className="mobile-shell">
      {/* Top Application Bar */}
      <header className="app-bar">
        <div className="bar-main">
          <div className="brand">
            <GreenhouseLogo />
            <div>
              <h1 className="brand-title">BIOSPHERE CEA</h1>
              <p className="brand-subtitle">Greenhouse Telemetry · Station Alpha</p>
            </div>
          </div>

          <div className="bar-actions">
            <button
              className="icon-btn"
              onClick={handleManualRefresh}
              aria-label="Refresh telemetry feeds"
              title="Refresh Feeds"
            >
              <RefreshIcon spinning={manualRefreshing} />
            </button>

            {!isInstalled && (
              <button
                className="install-pill-btn"
                onClick={handleInstallClick}
                aria-label="Install Greenhouse App"
              >
                <DownloadIcon />
                <span>Install App</span>
              </button>
            )}
          </div>
        </div>

        {/* Telemetry Status Strip */}
        <div className="telemetry-strip" role="region" aria-label="System diagnostic links">
          <div className={`status-node ${health ? 'up' : 'down'}`}>
            <span className="node-led" />
            <span className="node-label">REST API</span>
            <span className="node-state">{health ? 'ONLINE' : 'OFFLINE'}</span>
          </div>
          <div className={`status-node ${mqttOk ? 'up' : 'down'}`}>
            <span className="node-led" />
            <span className="node-label">AWS IOT CORE</span>
            <span className="node-state">{health ? (mqttOk ? 'LINKED' : 'DISCONNECTED') : '–'}</span>
          </div>
          <div className={`status-node ${dbOk ? 'up' : 'down'}`}>
            <span className="node-led" />
            <span className="node-label">SUPABASE DB</span>
            <span className="node-state">{health ? (dbOk ? 'SYNCED' : 'FAULT') : '–'}</span>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="content-container">
        {error && (
          <div className="fault-banner" role="alert">
            <div className="fault-head">
              <strong>Telemetry Link Interruption</strong>
            </div>
            <div className="fault-body">
              Target endpoint unreachable: <code>{API_URL}</code> ({error})
            </div>
          </div>
        )}

        {/* PWA Install Promotion Banner (if prompt ready and not in standalone) */}
        {!isInstalled && deferredPrompt && (
          <section className="pwa-install-banner">
            <div className="pwa-banner-text">
              <strong>Install BioSphere Mobile Console</strong>
              <p>Add to your device home screen for fullscreen telemetry and instant valve control.</p>
            </div>
            <button className="pwa-banner-action" onClick={handleInstallClick}>
              Install Now
            </button>
          </section>
        )}

        {/* Primary Telemetry Grid */}
        <div className="telemetry-grid">
          {/* Card 1: Atmospheric CO2 */}
          <Card
            icon={Co2Icon}
            title="Atmospheric Carbon Dioxide"
            zone="Zone 1 · Canopy microclimate"
            subtitle="Infrared gas absorption sensor"
            topic="sensor/co2"
            reading={co2}
            now={now}
            statusText={co2AgronomicNotice}
          >
            <div className="metric-row">
              <div className="primary-metric">
                <span className="metric-value">{fmt(co2?.co2_ppm, 0)}</span>
                <span className="metric-unit">ppm</span>
              </div>
              <div className={`agronomic-badge ${co2BandClass}`}>
                {co2AgronomicNotice}
              </div>
            </div>

            <div className="gauge-track">
              <div
                className="gauge-fill co2-fill"
                style={{ width: `${Math.min(100, Math.max(0, ((co2Ppm ?? 400) / 1600) * 100))}%` }}
              />
            </div>
            <div className="gauge-scale">
              <span>400 ppm (Ambient)</span>
              <span>800-1200 ppm (Optimal)</span>
              <span>1600 ppm</span>
            </div>

            <div className="chart-box">
              <div className="chart-title">Canopy Assimilation Trend</div>
              <Sparkline values={history.co2.map((r) => r.co2_ppm)} />
            </div>
          </Card>

          {/* Card 2: Substrate Soil Moisture */}
          <Card
            icon={MoistureIcon}
            title="Substrate Volumetric Water Content"
            zone="Zone 1 · Root-zone substrate"
            subtitle="Capacitive dielectric permittivity probe"
            topic="sensor/soil-moisture"
            reading={soil}
            now={now}
            statusText={soilAgronomicNotice}
          >
            <div className="metric-row">
              <div className="primary-metric">
                <span className="metric-value">{fmt(soil?.soil_moisture)}</span>
                <span className="metric-unit">% VWC</span>
              </div>
              <div className={`agronomic-badge ${soilBandClass}`}>
                {soilAgronomicNotice}
              </div>
            </div>

            <div className="gauge-track">
              <div
                className="gauge-fill moisture-fill"
                style={{ width: `${Math.min(100, Math.max(0, soilMoisturePct ?? 0))}%` }}
              />
            </div>
            <div className="gauge-scale">
              <span>0% (Wilting)</span>
              <span>25-45% (Field Capacity)</span>
              <span>100% (Saturated)</span>
            </div>

            <div className="chart-box">
              <div className="chart-title">Substrate Moisture Trend</div>
              <Sparkline values={history.soil_moisture.map((r) => r.soil_moisture)} color="var(--accent-teal)" />
            </div>
          </Card>

          {/* Card 3: NPK Macronutrients */}
          <Card
            icon={NutrientIcon}
            title="Macronutrient Solute Ion Profile"
            zone="Zone 1 · Hydroponic fertigation bed"
            subtitle="Optical colorimetric ion balance sensor"
            topic="sensor/npk"
            reading={npk}
            now={now}
            statusText="Soil solution ionic availability"
          >
            <div className="npk-trio">
              <div className="npk-pod">
                <div className="npk-elem">N</div>
                <div className="npk-pod-name">Nitrogen</div>
                <div className="npk-pod-val">{fmt(npk?.nitrogen, 0)}</div>
                <div className="npk-pod-unit">mg/kg</div>
                <div className="npk-pod-desc">Foliar Biomass</div>
              </div>

              <div className="npk-pod">
                <div className="npk-elem">P</div>
                <div className="npk-pod-name">Phosphorus</div>
                <div className="npk-pod-val">{fmt(npk?.phosphorus, 0)}</div>
                <div className="npk-pod-unit">mg/kg</div>
                <div className="npk-pod-desc">Root Architecture</div>
              </div>

              <div className="npk-pod">
                <div className="npk-elem">K</div>
                <div className="npk-pod-name">Potassium</div>
                <div className="npk-pod-val">{fmt(npk?.potassium, 0)}</div>
                <div className="npk-pod-unit">mg/kg</div>
                <div className="npk-pod-desc">Stomatal Turgor</div>
              </div>
            </div>

            <div className="chart-box">
              <div className="chart-title">Nitrogen Ion Curve</div>
              <Sparkline values={history.npk.map((r) => r.nitrogen)} color="var(--accent-lime)" />
            </div>
          </Card>

          {/* Card 4: Hydroponic Irrigation Solenoid Actuator */}
          <section className="card actuator-card">
            <header className="card-head">
              <div className="card-title-group">
                <div className="card-icon-wrap actuator-icon-wrap">
                  <ValveIcon />
                </div>
                <div>
                  <div className="card-zone-tag">ACTUATION SUITE</div>
                  <h2>Irrigation Solenoid Valve</h2>
                  <p className="card-subtitle">Loop 01 · Hydroponic manifold relay</p>
                </div>
              </div>

              <div className="card-badges">
                <span className={`badge ${isValveOpen ? 'valve-active' : 'valve-standby'}`}>
                  <span className="badge-pip" />
                  {isValveOpen ? 'DISCHARGING' : 'ISOLATED'}
                </span>
              </div>
            </header>

            <div className="card-body">
              <div className="actuator-status-banner">
                <div className="actuator-state-label">VALVE LOOP 01 STATUS</div>
                <div className="actuator-state-value">
                  {isValveOpen ? 'FLOW ENGAGED · IRRIGATING ROOT MATRIX' : 'FLOW CLOSED · SYSTEM IN STANDBY'}
                </div>
                <div className="actuator-safety-note">
                  Safety protocol: 1.0s hydraulic dampening interlock between transitions
                </div>
              </div>

              {/* Actuator Trigger Buttons */}
              <div className="actuator-buttons">
                <button
                  className={`valve-btn open-btn ${isValveOpen ? 'active' : ''}`}
                  disabled={!!pending}
                  onClick={() => relay('on')}
                >
                  <span className="btn-indicator" />
                  <span>{pending === 'on' ? 'DISPATCHING…' : 'OPEN VALVE'}</span>
                  <span className="btn-sub">START IRRIGATION</span>
                </button>

                <button
                  className={`valve-btn close-btn ${!isValveOpen && lastCmd ? 'active' : ''}`}
                  disabled={!!pending}
                  onClick={() => relay('off')}
                >
                  <span className="btn-indicator" />
                  <span>{pending === 'off' ? 'DISPATCHING…' : 'CLOSE VALVE'}</span>
                  <span className="btn-sub">HALT IRRIGATION</span>
                </button>
              </div>

              {!mqttOk && health && (
                <div className="warning-callout">
                  Actuator command dispatcher offline: AWS IoT link disconnected.
                </div>
              )}

              {/* Command Audit Stream */}
              <div className="audit-section">
                <div className="audit-title">ACTUATION AUDIT LOG (LAST 5 COMMANDS)</div>
                <ul className="audit-list">
                  {relayLog.length === 0 ? (
                    <li className="audit-empty">No actuation commands recorded this cycle</li>
                  ) : (
                    relayLog.map((r) => (
                      <li key={r.id} className="audit-item">
                        <span className={`audit-pip ${r.status === 'published' ? 'ok' : 'err'}`} />
                        <span className="audit-cmd">{r.command.toUpperCase()}</span>
                        <span className="audit-status">[{r.status}]</span>
                        <span className="audit-time">{ago(r.created_at, now)}</span>
                        {r.error && <span className="audit-err">{r.error}</span>}
                      </li>
                    ))
                  )}
                </ul>
              </div>
            </div>

            <footer className="card-foot">
              <div className="foot-left">
                <span className="channel-topic">action/relay</span>
                <span className="foot-status-text">QoS 1 AWS Broker Handshake</span>
              </div>
              <div className="foot-timestamp">
                {lastCmd ? ago(lastCmd.created_at, now) : 'Ready'}
              </div>
            </footer>
          </section>
        </div>
      </main>

      {/* iOS PWA Installation Helper Modal */}
      {showIosPrompt && (
        <div className="ios-modal-overlay" onClick={() => setShowIosPrompt(false)}>
          <div className="ios-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ios-modal-head">
              <h3>Install BioSphere on iOS</h3>
              <button className="icon-btn-close" onClick={() => setShowIosPrompt(false)} aria-label="Close dialog">
                <CloseIcon />
              </button>
            </div>
            <div className="ios-modal-body">
              <p>Install this greenhouse station console to your iPhone / iPad home screen:</p>
              <ol className="ios-steps">
                <li>Tap the <strong>Share</strong> icon in the Safari bottom toolbar.</li>
                <li>Scroll down and select <strong>Add to Home Screen</strong>.</li>
                <li>Tap <strong>Add</strong> in the top-right corner to launch in fullscreen.</li>
              </ol>
            </div>
            <button className="ios-modal-btn" onClick={() => setShowIosPrompt(false)}>
              Understood
            </button>
          </div>
        </div>
      )}

      {/* Mobile Station Footer */}
      <footer className="station-footer">
        <div>Controlled Environment Agriculture Control Unit</div>
        <div className="station-sub">
          Gateway: <code>{API_URL}</code> · {health?.stats?.stored ?? 0} telemetry readings ingested
        </div>
      </footer>

      {/* Floating System Toasts */}
      <Toasts items={toasts} onClose={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
    </div>
  )
}
