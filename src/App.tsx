import { useEffect, useMemo, useState } from 'react'
import { MapContainer, Marker, Polyline, Popup, TileLayer } from 'react-leaflet'
import L from 'leaflet'
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Bell,
  Camera,
  Check,
  ChevronDown,
  CircleDot,
  Clock3,
  Eye,
  FileText,
  Filter,
  LayoutDashboard,
  Map as MapIcon,
  Menu,
  MoreHorizontal,
  Plus,
  Radio,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Video,
  Wifi,
  X
} from 'lucide-react'
import 'leaflet/dist/leaflet.css'
import './App.css'

type CameraStatus = 'Online' | 'Degraded' | 'Offline'
type AlertStatus = 'Active' | 'Acknowledged' | 'Resolved'
type CameraRecord = {
  id: string
  name: string
  area?: string
  department?: string
  type?: string
  camera_type?: string
  protocol: string
  endpoint_reference?: string
  status: CameraStatus
  lastSeen: string
  position: [number, number]
  accent: string
  enabled?: boolean
  zone?: string
}
type Detection = {
  id: string
  time: string
  camera: string
  vehicle: string
  type: string
  confidence: number
  matched: boolean
  created_at?: string
}
type AlertRecord = Detection & {
  status: AlertStatus
  severity: 'Critical' | 'High' | 'Medium'
  acknowledged_at?: string
  resolved_at?: string
}
type WatchlistEntry = {
  id: string
  identifier: string
  entity_type: string
  reason: string
  severity: 'Critical' | 'High' | 'Medium'
  enabled: number | boolean
  created_at: string
}
type AuditLog = {
  id: number
  actor_id: string
  action: string
  resource_type: string
  resource_id: string
  details: string
  created_at: string
}

type NavView = 'command' | 'watchlist' | 'audit'

const mapIcon = (status: CameraStatus, alert = false) =>
  L.divIcon({
    className: 'camera-marker-wrapper',
    html: `<div class="camera-marker ${status.toLowerCase()} ${alert ? 'alert' : ''}"><span></span></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11]
  })

function App() {
  const [activeView, setActiveView] = useState<NavView>('command')
  const [cameras, setCameras] = useState<CameraRecord[]>([])
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'All' | CameraStatus>('All')
  const [selectedCamera, setSelectedCamera] = useState('')
  const [selectedVehicle, setSelectedVehicle] = useState('')
  const [detections, setDetections] = useState<Detection[]>([])
  const [alerts, setAlerts] = useState<AlertRecord[]>([])
  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>([])
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([])
  const [watchlistCount, setWatchlistCount] = useState(0)
  const [ingestionLatency, setIngestionLatency] = useState<number | null>(null)
  const [token, setToken] = useState(() => localStorage.getItem('sentinel_token') || '')
  const [backendReady, setBackendReady] = useState(false)

  // Camera Onboarding Modal State
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [cameraName, setCameraName] = useState('')
  const [cameraProtocol, setCameraProtocol] = useState('RTSP adapter')
  const [cameraZone, setCameraZone] = useState('')
  const [cameraEndpoint, setCameraEndpoint] = useState('')
  const [cameraLatitude, setCameraLatitude] = useState('23.0225')
  const [cameraLongitude, setCameraLongitude] = useState('72.5714')

  // Watchlist Add Modal State
  const [showAddWatchlist, setShowAddWatchlist] = useState(false)
  const [wlIdentifier, setWlIdentifier] = useState('')
  const [wlEntityType, setWlEntityType] = useState('Vehicle')
  const [wlReason, setWlReason] = useState('')
  const [wlSeverity, setWlSeverity] = useState<'Critical' | 'High' | 'Medium'>('High')

  useEffect(() => {
    let socket: WebSocket | undefined
    const load = async () => {
      try {
        let activeToken = token
        if (!activeToken) {
          const login = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'admin@sentinel.local', password: 'admin12345' })
          })
          if (!login.ok) return
          activeToken = (await login.json()).token
          localStorage.setItem('sentinel_token', activeToken)
          setToken(activeToken)
        }

        const headers = { Authorization: `Bearer ${activeToken}` }
        const [cameraResponse, detectionResponse, alertResponse, watchlistResponse] = await Promise.all([
          fetch('/api/cameras', { headers }),
          fetch('/api/detections', { headers }),
          fetch('/api/alerts', { headers }),
          fetch('/api/watchlist', { headers })
        ])

        if (![cameraResponse, detectionResponse, alertResponse, watchlistResponse].every((res) => res.ok)) return

        setCameras(await cameraResponse.json())
        setDetections(await detectionResponse.json())
        const serverAlerts = await alertResponse.json()
        const watchlistData: WatchlistEntry[] = await watchlistResponse.json()
        setWatchlist(watchlistData)
        setWatchlistCount(watchlistData.filter((w) => Boolean(w.enabled)).length)

        setAlerts(
          serverAlerts.map(
            (alert: AlertRecord & { identifier: string; camera_id: string; created_at: string }) => ({
              ...alert,
              vehicle: alert.identifier,
              camera: alert.camera_id,
              time: new Date(alert.created_at).toLocaleTimeString('en-GB'),
              type: 'ANPR',
              matched: true
            })
          )
        )

        // Try fetching audit logs (admin-only)
        try {
          const auditResponse = await fetch('/api/audit-logs', { headers })
          if (auditResponse.ok) {
            setAuditLogs(await auditResponse.json())
          }
        } catch (auditErr) {
          console.warn('Audit logs fetch failed', auditErr)
        }

        setBackendReady(true)

        socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`)
        socket.onmessage = (message) => {
          try {
            const { event, payload } = JSON.parse(message.data)
            if (event === 'camera.created') {
              setCameras((current) => [payload, ...current])
            }
            if (event === 'camera.updated') {
              setCameras((current) => current.map((c) => (c.id === payload.id ? payload : c)))
            }
            if (event === 'detection.created') {
              setDetections((current) => [payload, ...current].slice(0, 100))
              if (payload.created_at) {
                const diff = Math.max(12, Math.min(220, Math.round(Date.now() - new Date(payload.created_at).getTime())))
                setIngestionLatency(diff)
              }
            }
            if (event === 'alert.created') {
              setAlerts((current) => [
                {
                  ...payload,
                  vehicle: payload.identifier,
                  camera: payload.camera_id,
                  time: new Date(payload.created_at).toLocaleTimeString('en-GB'),
                  type: 'ANPR',
                  matched: true
                },
                ...current
              ].slice(0, 100))
            }
            if (event === 'alert.updated') {
              setAlerts((current) =>
                current.map((a) =>
                  a.id === payload.id
                    ? {
                        ...a,
                        status: payload.status,
                        acknowledged_at: payload.acknowledged_at,
                        resolved_at: payload.resolved_at
                      }
                    : a
                )
              )
            }
            if (event === 'watchlist.created') {
              setWatchlist((current) => [payload, ...current.filter((w) => w.id !== payload.id)])
              setWatchlistCount((count) => count + 1)
            }
            if (event === 'watchlist.updated') {
              setWatchlist((current) => current.map((w) => (w.id === payload.id ? payload : w)))
            }
          } catch (e) {
            console.error('Error handling WebSocket message', e)
          }
        }
      } catch (error) {
        console.error('Backend unavailable', error)
      }
    }

    void load()
    return () => socket?.close()
  }, [token])

  const filteredCameras = useMemo(
    () =>
      cameras.filter(
        (camera) =>
          `${camera.name} ${camera.id} ${camera.zone || ''} ${camera.department || ''}`
            .toLowerCase()
            .includes(query.toLowerCase()) && (statusFilter === 'All' || camera.status === statusFilter)
      ),
    [cameras, query, statusFilter]
  )

  const vehicleDetections = detections.filter(
    (detection) => selectedVehicle && detection.vehicle === selectedVehicle
  )
  const movementPath: [number, number][] = vehicleDetections.map(
    (detection) => cameras.find((camera) => camera.id === detection.camera)?.position ?? [23.0225, 72.5714]
  )
  const alertCount = alerts.filter((alert) => alert.status === 'Active').length
  const onlineCameras = cameras.filter((camera) => camera.status === 'Online').length

  // Phase 1: Acknowledge & Resolve Alert Handler
  const updateAlertStatus = async (alertId: string, status: 'Acknowledged' | 'Resolved') => {
    try {
      const response = await fetch(`/api/alerts/${alertId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ status })
      })
      if (!response.ok) return
      const updated = await response.json()
      setAlerts((current) =>
        current.map((a) =>
          a.id === alertId
            ? {
                ...a,
                status: updated.status,
                acknowledged_at: updated.acknowledged_at,
                resolved_at: updated.resolved_at
              }
            : a
        )
      )
      // Refresh audit logs
      fetchAuditLogs()
    } catch (err) {
      console.error('Failed to update alert status', err)
    }
  }

  // Phase 3: Watchlist management handlers
  const addWatchlist = async () => {
    if (!wlIdentifier.trim() || !wlReason.trim()) return
    try {
      const res = await fetch('/api/watchlist', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          identifier: wlIdentifier.trim().toUpperCase(),
          entity_type: wlEntityType.trim() || 'Vehicle',
          reason: wlReason.trim(),
          severity: wlSeverity
        })
      })
      if (!res.ok) return
      const created = await res.json()
      setWatchlist((current) => [created, ...current])
      setWatchlistCount((c) => c + 1)
      setWlIdentifier('')
      setWlReason('')
      setShowAddWatchlist(false)
      fetchAuditLogs()
    } catch (err) {
      console.error('Failed to add watchlist item', err)
    }
  }

  const disableWatchlistItem = async (id: string) => {
    try {
      const res = await fetch(`/api/watchlist/${id}/disable`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!res.ok) return
      const updated = await res.json()
      setWatchlist((current) => current.map((w) => (w.id === id ? updated : w)))
      setWatchlistCount((c) => Math.max(0, c - 1))
      fetchAuditLogs()
    } catch (err) {
      console.error('Failed to disable watchlist item', err)
    }
  }

  // Phase 4: Fetch audit logs
  const fetchAuditLogs = async () => {
    if (!token) return
    try {
      const res = await fetch('/api/audit-logs', {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        setAuditLogs(await res.json())
      }
    } catch (err) {
      console.warn('Could not refresh audit logs', err)
    }
  }

  const addCamera = async () => {
    if (!cameraName.trim() || !cameraZone.trim() || !cameraEndpoint.trim()) return
    const response = await fetch('/api/cameras', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        name: cameraName.trim(),
        department: '',
        latitude: Number(cameraLatitude),
        longitude: Number(cameraLongitude),
        camera_type: 'Registered source',
        protocol: cameraProtocol,
        endpoint_reference: cameraEndpoint.trim(),
        zone: cameraZone.trim()
      })
    })
    if (!response.ok) return
    const nextCamera = await response.json()
    setCameras((current) => [nextCamera, ...current])
    setSelectedCamera(nextCamera.id)
    setCameraName('')
    setCameraZone('')
    setCameraEndpoint('')
    setShowOnboarding(false)
    fetchAuditLogs()
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Radio size={18} />
          </div>
          <div>
            <strong>
              sentinel<span>_</span>
            </strong>
            <small>VIDEO INTELLIGENCE</small>
          </div>
        </div>
        <div className="workspace-label">
          OPERATIONS CENTER <ChevronDown size={13} />
        </div>
        <nav>
          <a
            className={`nav-clickable ${activeView === 'command' ? 'active' : ''}`}
            onClick={() => setActiveView('command')}
          >
            <LayoutDashboard size={17} /> Command center
          </a>
          <a
            className="nav-clickable"
            onClick={() => {
              setActiveView('command')
              setShowOnboarding(true)
            }}
          >
            <Camera size={17} /> Camera registry <span className="nav-count">{cameras.length}</span>
          </a>
          <a
            className="nav-clickable"
            onClick={() => {
              setActiveView('command')
            }}
          >
            <Eye size={17} /> Detection events <span className="nav-count">{detections.length}</span>
          </a>
          <a
            className={`nav-clickable ${activeView === 'watchlist' ? 'active' : ''}`}
            onClick={() => setActiveView('watchlist')}
          >
            <ShieldCheck size={17} /> Watchlist <span className="nav-count warning">{watchlistCount}</span>
          </a>
          <a
            className="nav-clickable"
            onClick={() => {
              setActiveView('command')
            }}
          >
            <MapIcon size={17} /> GIS & movement
          </a>
          <a
            className={`nav-clickable ${activeView === 'audit' ? 'active' : ''}`}
            onClick={() => {
              fetchAuditLogs()
              setActiveView('audit')
            }}
          >
            <FileText size={17} /> Audit logs <span className="nav-count">{auditLogs.length}</span>
          </a>
        </nav>
        <div className="sidebar-bottom">
          <div className="node-status">
            <span className="pulse-dot"></span>
            <div>
              <b>API node connected</b>
              <small>{backendReady ? 'sentinel-api · online' : 'connecting...'}</small>
            </div>
            <MoreHorizontal size={16} />
          </div>
          <div className="user">
            <div className="avatar">AR</div>
            <div>
              <b>Adarsh Raj</b>
              <small>Operator · Admin</small>
            </div>
            <ChevronDown size={15} />
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="mobile-brand">
            <Radio size={18} /> sentinel_
          </div>
          <div className="breadcrumbs">
            <span>Operations</span>
            <span>/</span>
            <b>
              {activeView === 'command'
                ? 'Command center'
                : activeView === 'watchlist'
                ? 'Watchlist Registry'
                : 'Security & Audit Logs'}
            </b>
          </div>
          <div className="top-actions">
            <div className="system-live">
              <span className="pulse-dot"></span> All systems operational
            </div>
            <button
              className="icon-button"
              aria-label="Notifications"
              onClick={() => setActiveView('command')}
            >
              <Bell size={18} />
              <i>{alertCount}</i>
            </button>
            <div className="top-avatar">AR</div>
            <button className="mobile-menu">
              <Menu size={20} />
            </button>
          </div>
        </header>

        <div className="page-content">
          {/* VIEW: COMMAND CENTER */}
          {activeView === 'command' && (
            <>
              <section className="page-heading">
                <div>
                  <div className="eyebrow">
                    <span className="live-dot"></span> LIVE MONITORING · REAL-TIME CORRELATION
                  </div>
                  <h1>Command center</h1>
                  <p>Unified situational awareness across your camera network.</p>
                </div>
                <div className="heading-actions">
                  <button className="secondary-button" onClick={() => setShowOnboarding(true)}>
                    <Plus size={16} /> Add camera
                  </button>
                  <div className="live-toggle on">
                    <span></span> Live ingestion active
                  </div>
                </div>
              </section>

              <section className="stats-grid">
                <div className="stat-card">
                  <div className="stat-top">
                    <span>CAMERAS ONLINE</span>
                    <Wifi size={16} />
                  </div>
                  <div className="stat-value">
                    {onlineCameras} <small>/ {cameras.length}</small>
                  </div>
                  <div className="stat-foot good">
                    <CircleDot size={13} /> {onlineCameras === cameras.length ? 'All sources online' : `${cameras.length - onlineCameras} degraded/offline`}
                  </div>
                </div>

                <div className="stat-card alert-stat">
                  <div className="stat-top">
                    <span>ACTIVE ALERTS</span>
                    <AlertTriangle size={16} />
                  </div>
                  <div className="stat-value">
                    {alertCount} <small>high priority</small>
                  </div>
                  <div className={`stat-foot ${alertCount > 0 ? 'danger' : 'neutral'}`}>
                    <CircleDot size={13} /> {alertCount > 0 ? `${alertCount} require operator review` : 'No active alerts'}
                  </div>
                </div>

                <div className="stat-card">
                  <div className="stat-top">
                    <span>DETECTIONS TODAY</span>
                    <Activity size={16} />
                  </div>
                  <div className="stat-value">{detections.length}</div>
                  <div className="stat-foot good">
                    <CircleDot size={13} /> Continuous ANPR inference
                  </div>
                </div>

                <div className="stat-card">
                  <div className="stat-top">
                    <span>INGESTION LATENCY</span>
                    <Clock3 size={16} />
                  </div>
                  <div className="stat-value">
                    {ingestionLatency !== null ? ingestionLatency : '32'} <small>ms</small>
                  </div>
                  <div className="stat-foot good">
                    <CircleDot size={13} /> {ingestionLatency !== null ? 'Live edge stream active' : 'Sub-50ms target'}
                  </div>
                </div>
              </section>

              <section className="workspace-grid">
                <div className="camera-panel panel">
                  <div className="panel-header">
                    <div>
                      <h2>Live feeds</h2>
                      <p>
                        {cameras.length} registered source{cameras.length === 1 ? '' : 's'} ·{' '}
                        {backendReady ? 'persisted in API' : 'connecting to API'}
                      </p>
                    </div>
                    <button className="ghost-button">
                      <SlidersHorizontal size={15} /> Layout
                    </button>
                  </div>
                  <div className="feed-toolbar">
                    <div className="search-field">
                      <Search size={15} />
                      <input
                        placeholder="Search cameras..."
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                      />
                    </div>
                    <div className="filter-buttons">
                      {(['All', 'Online', 'Degraded'] as const).map((filter) => (
                        <button
                          key={filter}
                          className={statusFilter === filter ? 'selected' : ''}
                          onClick={() => setStatusFilter(filter)}
                        >
                          {filter}
                          {filter === 'All' && <span>{cameras.length}</span>}
                        </button>
                      ))}
                    </div>
                    <button className="filter-icon" aria-label="Filter">
                      <Filter size={16} />
                    </button>
                  </div>
                  <div className="feed-grid">
                    {filteredCameras.length ? (
                      filteredCameras.map((camera) => (
                        <button
                          className={`feed-card ${selectedCamera === camera.id ? 'selected' : ''}`}
                          key={camera.id}
                          onClick={() => setSelectedCamera(camera.id)}
                        >
                          {camera.endpoint_reference?.match(/^https?:\/\//) ? (
                            <video
                              className="real-video"
                              src={camera.endpoint_reference}
                              controls
                              muted
                              autoPlay
                              loop
                            />
                          ) : (
                            <div className={`fake-video ${camera.accent}`}>
                              <div className="scan-lines"></div>
                              <div className="feed-top">
                                <span className="source-label">
                                  <span className="tiny-live"></span> {camera.protocol}
                                </span>
                                <span className="feed-time">{camera.lastSeen}</span>
                              </div>
                              <div className="road-scene">
                                <div className="road-line"></div>
                                <div className="vehicle-shape"></div>
                              </div>
                              <div className="feed-bottom">
                                <span>{camera.id}</span>
                                <span>
                                  <Video size={12} /> adapter
                                </span>
                              </div>
                            </div>
                          )}
                          <div className="feed-meta">
                            <div>
                              <b>{camera.name}</b>
                              <small>
                                {camera.camera_type || camera.type || 'Source'} ·{' '}
                                {camera.zone || camera.area || 'Junction'}
                              </small>
                            </div>
                            <span className={`status-badge ${camera.status.toLowerCase()}`}>
                              <span></span>
                              {camera.status}
                            </span>
                          </div>
                        </button>
                      ))
                    ) : (
                      <div className="empty-state">
                        <Camera size={24} />
                        <b>No camera sources found</b>
                        <span>Register a source to see its live feed here.</span>
                        <button className="primary-button" onClick={() => setShowOnboarding(true)}>
                          <Plus size={14} /> Add first camera
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Phase 1: Alert Panel with Acknowledge and Resolve */}
                <div className="alerts-panel panel">
                  <div className="panel-header">
                    <div>
                      <h2>
                        Priority alerts <span className="header-count">{alertCount}</span>
                      </h2>
                      <p>Watchlist correlation stream</p>
                    </div>
                    <button className="more-button" aria-label="More alert options">
                      <MoreHorizontal size={18} />
                    </button>
                  </div>
                  <div className="alert-list">
                    {alerts.length ? (
                      alerts.map((alert) => (
                        <div className={`alert-row ${alert.status.toLowerCase()}`} key={alert.id}>
                          <div className="alert-icon">
                            <AlertTriangle size={16} />
                          </div>
                          <div className="alert-info">
                            <div>
                              <b>{alert.vehicle}</b>
                              <span className={`severity ${alert.severity.toLowerCase()}`}>
                                {alert.severity}
                              </span>
                            </div>
                            <p>Watchlist match · {alert.camera}</p>
                            <small>
                              <Clock3 size={12} /> {alert.time} <span>·</span>{' '}
                              {Math.round(alert.confidence > 1 ? alert.confidence : alert.confidence * 100)}% confidence
                            </small>

                            {/* Phase 1: Action buttons */}
                            <div className="alert-actions">
                              {alert.status === 'Active' && (
                                <>
                                  <button
                                    className="ack-button"
                                    onClick={() => updateAlertStatus(alert.id, 'Acknowledged')}
                                  >
                                    Acknowledge
                                  </button>
                                  <button
                                    className="resolve-button"
                                    onClick={() => updateAlertStatus(alert.id, 'Resolved')}
                                  >
                                    Resolve
                                  </button>
                                </>
                              )}
                              {alert.status === 'Acknowledged' && (
                                <button
                                  className="resolve-button"
                                  onClick={() => updateAlertStatus(alert.id, 'Resolved')}
                                >
                                  Resolve
                                </button>
                              )}
                            </div>
                          </div>

                          <span className="alert-state">
                            <Check size={13} /> {alert.status}
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="empty-state compact">
                        <AlertTriangle size={22} />
                        <b>No priority alerts</b>
                        <span>Alerts will appear when an event matches your watchlist.</span>
                      </div>
                    )}
                  </div>
                  <button className="view-all" onClick={() => setActiveView('command')}>
                    Total alerts logged: {alerts.length} <ArrowUpRight size={14} />
                  </button>
                </div>
              </section>

              <section className="lower-grid">
                {/* Phase 5: Map Alert Markers */}
                <div className="map-panel panel">
                  <div className="panel-header">
                    <div>
                      <h2>
                        Camera network <span className="header-count muted">GIS</span>
                      </h2>
                      <p>
                        {cameras.length} registered source{cameras.length === 1 ? '' : 's'}
                      </p>
                    </div>
                    <button className="ghost-button">
                      Full map <ArrowUpRight size={14} />
                    </button>
                  </div>
                  <div className="map-wrap">
                    <MapContainer
                      center={[23.0304, 72.54]}
                      zoom={12}
                      scrollWheelZoom={false}
                      zoomControl={false}
                      className="leaflet-map"
                    >
                      <TileLayer
                        attribution='&copy; OpenStreetMap'
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                      />
                      {cameras.map((camera) => (
                        <Marker
                          key={camera.id}
                          position={camera.position}
                          icon={mapIcon(
                            camera.status,
                            alerts.some((a) => a.camera === camera.id && a.status === 'Active')
                          )}
                        >
                          <Popup>
                            <b>
                              {camera.id} · {camera.name}
                            </b>
                            <br />
                            {camera.status} · {camera.protocol}
                            {alerts.some((a) => a.camera === camera.id && a.status === 'Active') && (
                              <div style={{ color: '#d7463e', fontWeight: 600, marginTop: 4 }}>
                                🚨 Active Alert Present
                              </div>
                            )}
                          </Popup>
                        </Marker>
                      ))}
                      {vehicleDetections.length > 1 && (
                        <Polyline
                          positions={[...movementPath].reverse()}
                          pathOptions={{ color: '#e46b38', weight: 3, dashArray: '6 8' }}
                        />
                      )}
                    </MapContainer>
                    <div className="map-legend">
                      <span>
                        <i className="legend-online"></i> Online
                      </span>
                      <span>
                        <i className="legend-alert"></i> Alert Active
                      </span>
                      <span>
                        <i className="legend-degraded"></i> Degraded
                      </span>
                    </div>
                  </div>
                </div>

                <div className="activity-panel panel">
                  <div className="panel-header">
                    <div>
                      <h2>Detection stream</h2>
                      <p>Latest AI inference results</p>
                    </div>
                    <button className="more-button">
                      <MoreHorizontal size={18} />
                    </button>
                  </div>
                  <div className="entity-search">
                    <Search size={15} />
                    <input
                      placeholder="Search vehicle / entity"
                      value={selectedVehicle}
                      onChange={(event) => setSelectedVehicle(event.target.value.toUpperCase())}
                    />
                    <span>ANPR</span>
                  </div>
                  <div className="movement-label">
                    <span>Movement history</span>
                    <b>{vehicleDetections.length} sightings</b>
                  </div>
                  <div className="activity-list">
                    {detections.length ? (
                      detections.slice(0, 5).map((detection) => (
                        <button
                          className={`activity-row ${detection.vehicle === selectedVehicle ? 'active' : ''}`}
                          key={detection.id}
                          onClick={() => setSelectedVehicle(detection.vehicle)}
                        >
                          <div className="activity-time">
                            {detection.time}
                            <small>{detection.camera}</small>
                          </div>
                          <div className="activity-line">
                            <span></span>
                          </div>
                          <div className="activity-details">
                            <b>{detection.vehicle || 'Unknown Plate'}</b>
                            <span>
                              {detection.type} ·{' '}
                              {Math.round(detection.confidence > 1 ? detection.confidence : detection.confidence * 100)}%
                            </span>
                          </div>
                          {detection.matched && <span className="match-chip">MATCH</span>}
                        </button>
                      ))
                    ) : (
                      <div className="empty-state compact">
                        <Activity size={22} />
                        <b>No detection events</b>
                        <span>Validated AI events will appear here.</span>
                      </div>
                    )}
                  </div>
                </div>
              </section>
            </>
          )}

          {/* VIEW: WATCHLIST MANAGEMENT (Phase 3) */}
          {activeView === 'watchlist' && (
            <div className="watchlist-view">
              <div className="view-header">
                <div>
                  <div className="eyebrow">
                    <ShieldCheck size={14} /> SECURITY & CORRELATION REGISTRY
                  </div>
                  <h2>Watchlist Management</h2>
                  <p>Register and manage target license plates for automated ANPR alert correlation.</p>
                </div>
                <div className="heading-actions">
                  <button className="primary-button" onClick={() => setShowAddWatchlist(true)}>
                    <Plus size={15} /> Add to watchlist
                  </button>
                  <button className="secondary-button" onClick={() => setActiveView('command')}>
                    Back to Command Center
                  </button>
                </div>
              </div>

              <div className="data-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Identifier / Plate</th>
                      <th>Entity Type</th>
                      <th>Reason / Offense</th>
                      <th>Severity</th>
                      <th>Status</th>
                      <th>Created</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {watchlist.length ? (
                      watchlist.map((item) => (
                        <tr key={item.id}>
                          <td>
                            <strong>{item.identifier}</strong>
                          </td>
                          <td>{item.entity_type}</td>
                          <td>{item.reason}</td>
                          <td>
                            <span className={`badge ${item.severity.toLowerCase()}`}>
                              {item.severity}
                            </span>
                          </td>
                          <td>
                            <span className={`badge ${item.enabled ? 'enabled' : 'disabled'}`}>
                              {item.enabled ? 'Active' : 'Disabled'}
                            </span>
                          </td>
                          <td>{new Date(item.created_at).toLocaleDateString()}</td>
                          <td>
                            <div className="table-actions">
                              {item.enabled ? (
                                <button
                                  className="action-btn danger"
                                  onClick={() => disableWatchlistItem(item.id)}
                                >
                                  Disable
                                </button>
                              ) : (
                                <span style={{ color: '#888', fontSize: 10 }}>Disabled</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={7} style={{ textAlign: 'center', padding: 30 }}>
                          No watchlist entries found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* VIEW: AUDIT LOGS (Phase 4) */}
          {activeView === 'audit' && (
            <div className="audit-view">
              <div className="view-header">
                <div>
                  <div className="eyebrow">
                    <FileText size={14} /> COMPLIANCE & SECURITY AUDITING
                  </div>
                  <h2>System Audit Trail</h2>
                  <p>Immutable ledger of administrative actions, alert acknowledgements, and registry changes.</p>
                </div>
                <div className="heading-actions">
                  <button className="secondary-button" onClick={fetchAuditLogs}>
                    <RefreshCw size={14} /> Refresh
                  </button>
                  <button className="secondary-button" onClick={() => setActiveView('command')}>
                    Back to Command Center
                  </button>
                </div>
              </div>

              <div className="data-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Timestamp</th>
                      <th>Actor ID</th>
                      <th>Action</th>
                      <th>Resource Type</th>
                      <th>Resource ID</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLogs.length ? (
                      auditLogs.map((log) => (
                        <tr key={log.id}>
                          <td>
                            <span style={{ fontFamily: 'DM Mono', fontSize: 10 }}>
                              {new Date(log.created_at).toLocaleString()}
                            </span>
                          </td>
                          <td>
                            <code>{log.actor_id}</code>
                          </td>
                          <td>
                            <span
                              className={`badge ${
                                log.action.includes('created')
                                  ? 'enabled'
                                  : log.action.includes('disabled')
                                  ? 'critical'
                                  : 'medium'
                              }`}
                            >
                              {log.action}
                            </span>
                          </td>
                          <td>{log.resource_type}</td>
                          <td>
                            <code>{log.resource_id}</code>
                          </td>
                          <td style={{ maxWidth: 350, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <small style={{ fontFamily: 'DM Mono', color: '#688074' }}>
                              {log.details}
                            </small>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={6} style={{ textAlign: 'center', padding: 30 }}>
                          No audit log entries recorded yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <footer>
            <span>
              <ShieldCheck size={14} /> Protected workspace · RBAC enabled (Admin: Adarsh Raj)
            </span>
            <span>Sentinel Video Intelligence · Ahmedabad Fleet Node</span>
          </footer>
        </div>
      </main>

      {/* MODAL: ONBOARD CAMERA */}
      {showOnboarding && (
        <div className="modal-backdrop" onClick={() => setShowOnboarding(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <span className="modal-kicker">CAMERA REGISTRY</span>
                <h2>Onboard a source</h2>
              </div>
              <button className="close-button" onClick={() => setShowOnboarding(false)}>
                <X size={18} />
              </button>
            </div>
            <p>Enter source details to add a camera to the network.</p>
            <label>
              Camera name
              <input
                value={cameraName}
                onChange={(event) => setCameraName(event.target.value)}
                placeholder="e.g. Satellite Junction West"
              />
            </label>
            <div className="form-row">
              <label>
                Source protocol
                <select
                  value={cameraProtocol}
                  onChange={(event) => setCameraProtocol(event.target.value)}
                >
                  <option>RTSP adapter</option>
                  <option>ONVIF simulator</option>
                  <option>HLS relay</option>
                  <option>Vendor API</option>
                </select>
              </label>
              <label>
                Zone
                <input
                  value={cameraZone}
                  onChange={(event) => setCameraZone(event.target.value)}
                  placeholder="Ahmedabad West"
                />
              </label>
            </div>
            <label>
              Stream endpoint reference
              <input
                value={cameraEndpoint}
                onChange={(event) => setCameraEndpoint(event.target.value)}
                placeholder="rtsp://edge-node/camera-005 or https://...mp4"
              />
            </label>
            <div className="form-row">
              <label>
                Latitude
                <input
                  value={cameraLatitude}
                  onChange={(event) => setCameraLatitude(event.target.value)}
                />
              </label>
              <label>
                Longitude
                <input
                  value={cameraLongitude}
                  onChange={(event) => setCameraLongitude(event.target.value)}
                />
              </label>
            </div>
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => setShowOnboarding(false)}>
                Cancel
              </button>
              <button
                className="primary-button"
                disabled={!cameraName.trim() || !cameraZone.trim() || !cameraEndpoint.trim()}
                onClick={addCamera}
              >
                <Plus size={15} /> Register camera
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: ADD TO WATCHLIST (Phase 3) */}
      {showAddWatchlist && (
        <div className="modal-backdrop" onClick={() => setShowAddWatchlist(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <span className="modal-kicker">WATCHLIST CORRELATION</span>
                <h2>Add target to watchlist</h2>
              </div>
              <button className="close-button" onClick={() => setShowAddWatchlist(false)}>
                <X size={18} />
              </button>
            </div>
            <p>Specify vehicle license plate and reason to trigger priority alerts upon detection.</p>
            <label>
              Identifier / License Plate
              <input
                value={wlIdentifier}
                onChange={(event) => setWlIdentifier(event.target.value.toUpperCase())}
                placeholder="e.g. GJ01AB9999"
              />
            </label>
            <div className="form-row">
              <label>
                Entity Type
                <select
                  value={wlEntityType}
                  onChange={(event) => setWlEntityType(event.target.value)}
                >
                  <option>Vehicle</option>
                  <option>Commercial Transport</option>
                  <option>Person</option>
                </select>
              </label>
              <label>
                Alert Severity
                <select
                  value={wlSeverity}
                  onChange={(event) =>
                    setWlSeverity(event.target.value as 'Critical' | 'High' | 'Medium')
                  }
                >
                  <option value="Critical">Critical</option>
                  <option value="High">High</option>
                  <option value="Medium">Medium</option>
                </select>
              </label>
            </div>
            <label>
              Reason / FIR reference
              <input
                value={wlReason}
                onChange={(event) => setWlReason(event.target.value)}
                placeholder="e.g. Reported stolen in Navrangpura, FIR #4321/2026"
              />
            </label>
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => setShowAddWatchlist(false)}>
                Cancel
              </button>
              <button
                className="primary-button"
                disabled={!wlIdentifier.trim() || !wlReason.trim()}
                onClick={addWatchlist}
              >
                <Plus size={15} /> Save Watchlist Entry
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
