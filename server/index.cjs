const express = require('express')
const cors = require('cors')
const http = require('http')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const Database = require('better-sqlite3')
const { WebSocketServer } = require('ws')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const { z } = require('zod')
const rateLimit = require('express-rate-limit')
const { seedData } = require('./seed.cjs')

const PORT = Number(process.env.PORT || 4000)
const JWT_SECRET = process.env.JWT_SECRET || 'local-development-secret-change-me'
const dataDir = path.join(__dirname, '..', 'data')
fs.mkdirSync(dataDir, { recursive: true })
const db = new Database(path.join(dataDir, 'sentinel.sqlite'))
db.pragma('journal_mode = WAL')
db.exec(`
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','operator')), created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS cameras (id TEXT PRIMARY KEY, name TEXT NOT NULL, department TEXT NOT NULL DEFAULT '', latitude REAL NOT NULL, longitude REAL NOT NULL, camera_type TEXT NOT NULL DEFAULT 'Registered source', protocol TEXT NOT NULL, endpoint_reference TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Offline', last_heartbeat TEXT, zone TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS watchlist (id TEXT PRIMARY KEY, identifier TEXT NOT NULL UNIQUE, entity_type TEXT NOT NULL, reason TEXT NOT NULL, severity TEXT NOT NULL DEFAULT 'High', enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS detections (id TEXT PRIMARY KEY, camera_id TEXT NOT NULL, timestamp TEXT NOT NULL, event_type TEXT NOT NULL, vehicle_number TEXT, confidence REAL NOT NULL, vehicle_type TEXT, bounding_box TEXT, source_event_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, FOREIGN KEY(camera_id) REFERENCES cameras(id));
CREATE TABLE IF NOT EXISTS alerts (id TEXT PRIMARY KEY, detection_id TEXT NOT NULL, watchlist_id TEXT NOT NULL, camera_id TEXT NOT NULL, identifier TEXT NOT NULL, confidence REAL NOT NULL, status TEXT NOT NULL DEFAULT 'Active', severity TEXT NOT NULL, created_at TEXT NOT NULL, acknowledged_at TEXT, resolved_at TEXT, FOREIGN KEY(detection_id) REFERENCES detections(id));
CREATE TABLE IF NOT EXISTS audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id TEXT NOT NULL, action TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT NOT NULL, details TEXT NOT NULL, created_at TEXT NOT NULL);
`)

if (!db.prepare('SELECT id FROM users LIMIT 1').get()) {
  db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)').run(
    'USR-local-admin',
    'Adarsh Raj',
    'admin@sentinel.local',
    bcrypt.hashSync('admin12345', 10),
    'admin',
    new Date().toISOString()
  )
}

// Seed initial cameras and watchlist if empty
seedData(db)

const now = () => new Date().toISOString()
const id = (prefix) => `${prefix}-${crypto.randomUUID()}`
const publicCamera = (row) => ({
  ...row,
  enabled: Boolean(row.enabled),
  position: [row.latitude, row.longitude],
  lastSeen: row.last_heartbeat ? new Date(row.last_heartbeat).toLocaleString() : 'never',
  accent: 'mint'
})
const publicDetection = (row) => ({
  id: row.id,
  time: new Date(row.timestamp).toLocaleTimeString('en-GB'),
  camera: row.camera_id,
  vehicle: row.vehicle_number || '',
  type: row.event_type,
  confidence: row.confidence,
  matched: Boolean(row.alert_id),
  created_at: row.created_at
})

const app = express()
app.use(cors())
app.use(express.json({ limit: '1mb' }))

// Rate limiters for security
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later' }
})

const detectionsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Detection ingestion rate limit exceeded' }
})

const server = http.createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })
const broadcast = (event, payload) => {
  const message = JSON.stringify({ event, payload })
  wss.clients.forEach((client) => client.readyState === 1 && client.send(message))
}

const auth = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return res.status(401).json({ error: 'Authentication required' })
  try {
    req.user = jwt.verify(token, JWT_SECRET)
    next()
  } catch {
    res.status(401).json({ error: 'Invalid token' })
  }
}

const role = (...allowed) => (req, res, next) =>
  allowed.includes(req.user.role) ? next() : res.status(403).json({ error: 'Insufficient permissions' })

const audit = (actor, action, resourceType, resourceId, details = {}) =>
  db.prepare('INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    actor,
    action,
    resourceType,
    resourceId,
    JSON.stringify(details),
    now()
  )

const cameraSchema = z.object({
  name: z.string().min(1),
  department: z.string().optional().default(''),
  latitude: z.number().gte(-90).lte(90),
  longitude: z.number().gte(-180).lte(180),
  camera_type: z.string().min(1),
  protocol: z.enum(['RTSP adapter', 'ONVIF simulator', 'HLS relay', 'Vendor API']),
  endpoint_reference: z.string().min(1),
  zone: z.string().min(1)
})

const detectionSchema = z.object({
  camera_id: z.string().min(1),
  timestamp: z.string().datetime().optional(),
  event_type: z.string().min(1),
  vehicle_number: z.string().optional(),
  person_id: z.string().optional(),
  confidence: z.number().gte(0).lte(1),
  vehicle_type: z.string().optional(),
  bounding_box: z.record(z.string(), z.number()).optional(),
  source_event_id: z.string().min(1)
})

app.get('/', (req, res) =>
  res.json({ service: 'Sentinel API', status: 'ok', dashboard: 'http://localhost:5173', health: '/api/health', websocket: '/ws' })
)
app.get('/api/health', (req, res) => res.json({ ok: true, service: 'sentinel-api', timestamp: now() }))

app.post('/api/auth/login', loginLimiter, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(req.body.email)
  if (!user || !bcrypt.compareSync(req.body.password || '', user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' })
  }
  res.json({
    token: jwt.sign({ sub: user.id, name: user.name, role: user.role }, JWT_SECRET, { expiresIn: '8h' }),
    user: { name: user.name, role: user.role }
  })
})

app.post('/api/auth/register', (req, res) => {
  const parsed = z.object({
    name: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(8),
    role: z.enum(['admin', 'operator']).default('operator')
  }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
  const value = parsed.data
  try {
    const userId = id('USR')
    db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)').run(
      userId,
      value.name,
      value.email,
      bcrypt.hashSync(value.password, 10),
      value.role,
      now()
    )
    res.status(201).json({ id: userId })
  } catch {
    res.status(409).json({ error: 'Email already registered' })
  }
})

app.get('/api/cameras', auth, (req, res) =>
  res.json(db.prepare('SELECT * FROM cameras ORDER BY created_at DESC').all().map(publicCamera))
)

app.post('/api/cameras', auth, role('admin'), (req, res) => {
  const parsed = cameraSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
  const value = parsed.data
  const cameraId = id('CAM')
  const timestamp = now()
  db.prepare(`
    INSERT INTO cameras (id,name,department,latitude,longitude,camera_type,protocol,endpoint_reference,status,last_heartbeat,zone,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    cameraId,
    value.name,
    value.department,
    value.latitude,
    value.longitude,
    value.camera_type,
    value.protocol,
    value.endpoint_reference,
    'Online',
    timestamp,
    value.zone,
    timestamp,
    timestamp
  )
  audit(req.user.sub, 'camera.created', 'camera', cameraId, value)
  const camera = publicCamera(db.prepare('SELECT * FROM cameras WHERE id = ?').get(cameraId))
  broadcast('camera.created', camera)
  res.status(201).json(camera)
})

app.put('/api/cameras/:id', auth, role('admin'), (req, res) => {
  const parsed = cameraSchema.partial().safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
  const existing = db.prepare('SELECT * FROM cameras WHERE id = ?').get(req.params.id)
  if (!existing) return res.status(404).json({ error: 'Camera not found' })
  const value = { ...existing, ...parsed.data }
  db.prepare(`
    UPDATE cameras SET name=?,department=?,latitude=?,longitude=?,camera_type=?,protocol=?,endpoint_reference=?,zone=?,updated_at=?
    WHERE id=?
  `).run(value.name, value.department, value.latitude, value.longitude, value.camera_type, value.protocol, value.endpoint_reference, value.zone, now(), req.params.id)
  audit(req.user.sub, 'camera.updated', 'camera', req.params.id, parsed.data)
  res.json(publicCamera(db.prepare('SELECT * FROM cameras WHERE id = ?').get(req.params.id)))
})

app.patch('/api/cameras/:id/disable', auth, role('admin'), (req, res) => {
  const result = db.prepare("UPDATE cameras SET enabled = 0, status = 'Offline', updated_at = ? WHERE id = ?").run(now(), req.params.id)
  if (!result.changes) return res.status(404).json({ error: 'Camera not found' })
  audit(req.user.sub, 'camera.disabled', 'camera', req.params.id)
  const camera = publicCamera(db.prepare('SELECT * FROM cameras WHERE id = ?').get(req.params.id))
  broadcast('camera.updated', camera)
  res.json(camera)
})

app.post('/api/cameras/:id/heartbeat', auth, (req, res) => {
  const result = db.prepare("UPDATE cameras SET last_heartbeat = ?, status = 'Online', updated_at = ? WHERE id = ? AND enabled = 1").run(now(), now(), req.params.id)
  if (!result.changes) return res.status(404).json({ error: 'Enabled camera not found' })
  const camera = publicCamera(db.prepare('SELECT * FROM cameras WHERE id = ?').get(req.params.id))
  broadcast('camera.updated', camera)
  res.json(camera)
})

app.get('/api/watchlist', auth, (req, res) =>
  res.json(db.prepare('SELECT * FROM watchlist ORDER BY created_at DESC').all())
)

app.post('/api/watchlist', auth, role('admin'), (req, res) => {
  const parsed = z.object({
    identifier: z.string().min(1),
    entity_type: z.string().min(1),
    reason: z.string().min(1),
    severity: z.enum(['Critical', 'High', 'Medium']).default('High')
  }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
  const record = { id: id('WL'), ...parsed.data, created_at: now() }
  try {
    db.prepare('INSERT INTO watchlist (id,identifier,entity_type,reason,severity,created_at) VALUES (?,?,?,?,?,?)').run(
      record.id,
      record.identifier,
      record.entity_type,
      record.reason,
      record.severity,
      record.created_at
    )
    audit(req.user.sub, 'watchlist.created', 'watchlist', record.id, parsed.data)
    broadcast('watchlist.created', record)
    res.status(201).json(record)
  } catch {
    res.status(409).json({ error: 'Identifier already on watchlist' })
  }
})

app.put('/api/watchlist/:id', auth, role('admin'), (req, res) => {
  const parsed = z.object({
    entity_type: z.string().min(1).optional(),
    reason: z.string().min(1).optional(),
    severity: z.enum(['Critical', 'High', 'Medium']).optional(),
    enabled: z.union([z.boolean(), z.number()]).optional()
  }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
  const existing = db.prepare('SELECT * FROM watchlist WHERE id = ?').get(req.params.id)
  if (!existing) return res.status(404).json({ error: 'Watchlist entry not found' })
  const value = { ...existing, ...parsed.data }
  if (typeof value.enabled === 'boolean') value.enabled = value.enabled ? 1 : 0
  db.prepare('UPDATE watchlist SET entity_type = ?, reason = ?, severity = ?, enabled = ? WHERE id = ?')
    .run(value.entity_type, value.reason, value.severity, value.enabled, req.params.id)
  audit(req.user.sub, 'watchlist.updated', 'watchlist', req.params.id, parsed.data)
  const updated = db.prepare('SELECT * FROM watchlist WHERE id = ?').get(req.params.id)
  broadcast('watchlist.updated', updated)
  res.json(updated)
})

app.patch('/api/watchlist/:id/disable', auth, role('admin'), (req, res) => {
  const result = db.prepare('UPDATE watchlist SET enabled = 0 WHERE id = ?').run(req.params.id)
  if (!result.changes) return res.status(404).json({ error: 'Watchlist entry not found' })
  audit(req.user.sub, 'watchlist.disabled', 'watchlist', req.params.id)
  const updated = db.prepare('SELECT * FROM watchlist WHERE id = ?').get(req.params.id)
  broadcast('watchlist.updated', updated)
  res.json(updated)
})

app.get('/api/detections', auth, (req, res) => {
  const rows = db.prepare('SELECT d.*, a.id AS alert_id FROM detections d LEFT JOIN alerts a ON a.detection_id=d.id ORDER BY d.timestamp DESC LIMIT 200').all()
  res.json(rows.map(publicDetection))
})

app.post('/api/detections', auth, detectionsLimiter, (req, res) => {
  const parsed = detectionSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
  const value = parsed.data
  if (!db.prepare('SELECT id FROM cameras WHERE id = ? AND enabled = 1').get(value.camera_id)) {
    return res.status(404).json({ error: 'Enabled camera not found' })
  }
  const detectionId = id('DET')
  const timestamp = value.timestamp || now()
  const candidateId = value.vehicle_number || value.person_id
  try {
    db.prepare('INSERT INTO detections VALUES (?,?,?,?,?,?,?,?,?,?)').run(
      detectionId,
      value.camera_id,
      timestamp,
      value.event_type,
      candidateId || null,
      value.confidence,
      value.vehicle_type || null,
      JSON.stringify(value.bounding_box || {}),
      value.source_event_id,
      now()
    )
  } catch {
    return res.status(409).json({ error: 'Duplicate source event' })
  }

  const match = candidateId && db.prepare('SELECT * FROM watchlist WHERE identifier = ? AND enabled = 1').get(candidateId)
  let alert = null
  if (match) {
    alert = {
      id: id('ALT'),
      detection_id: detectionId,
      watchlist_id: match.id,
      camera_id: value.camera_id,
      identifier: candidateId,
      confidence: value.confidence,
      status: 'Active',
      severity: match.severity,
      created_at: now()
    }
    db.prepare('INSERT INTO alerts (id,detection_id,watchlist_id,camera_id,identifier,confidence,status,severity,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(
      alert.id,
      alert.detection_id,
      alert.watchlist_id,
      alert.camera_id,
      alert.identifier,
      alert.confidence,
      alert.status,
      alert.severity,
      alert.created_at
    )
    audit(req.user.sub, 'alert.created', 'alert', alert.id, alert)
    broadcast('alert.created', alert)
  }

  const detection = publicDetection({
    ...value,
    id: detectionId,
    timestamp,
    camera_id: value.camera_id,
    vehicle_number: candidateId,
    alert_id: alert?.id,
    created_at: now()
  })
  broadcast('detection.created', detection)
  res.status(201).json({ detection, alert })
})

app.get('/api/alerts', auth, (req, res) =>
  res.json(db.prepare('SELECT * FROM alerts ORDER BY created_at DESC LIMIT 100').all())
)

app.patch('/api/alerts/:id/status', auth, (req, res) => {
  const status = z.enum(['Acknowledged', 'Resolved']).safeParse(req.body.status)
  if (!status.success) return res.status(400).json({ error: 'Status must be Acknowledged or Resolved' })
  const field = status.data === 'Acknowledged' ? 'acknowledged_at' : 'resolved_at'
  const result = db.prepare(`UPDATE alerts SET status = ?, ${field} = ? WHERE id = ?`).run(status.data, now(), req.params.id)
  if (!result.changes) return res.status(404).json({ error: 'Alert not found' })
  audit(req.user.sub, `alert.${status.data.toLowerCase()}`, 'alert', req.params.id)
  const alert = db.prepare('SELECT * FROM alerts WHERE id = ?').get(req.params.id)
  broadcast('alert.updated', alert)
  res.json(alert)
})

app.get('/api/audit-logs', auth, role('admin'), (req, res) =>
  res.json(db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 200').all())
)

wss.on('connection', (socket) =>
  socket.send(JSON.stringify({ event: 'connected', payload: { service: 'sentinel-api' } }))
)

// Health monitor with 2 thresholds:
// 30s-90s without heartbeat -> Degraded
// >90s or NULL without heartbeat -> Offline
setInterval(() => {
  const cutoffOffline = new Date(Date.now() - 90000).toISOString()
  const cutoffDegraded = new Date(Date.now() - 30000).toISOString()

  // Offline
  const staleOffline = db.prepare("SELECT * FROM cameras WHERE enabled = 1 AND status != 'Offline' AND (last_heartbeat IS NULL OR last_heartbeat < ?)").all(cutoffOffline)
  if (staleOffline.length) {
    db.prepare("UPDATE cameras SET status = 'Offline', updated_at = ? WHERE enabled = 1 AND status != 'Offline' AND (last_heartbeat IS NULL OR last_heartbeat < ?)").run(now(), cutoffOffline)
    staleOffline.forEach((camera) => broadcast('camera.updated', publicCamera({ ...camera, status: 'Offline' })))
  }

  // Degraded
  const staleDegraded = db.prepare("SELECT * FROM cameras WHERE enabled = 1 AND status = 'Online' AND last_heartbeat < ? AND last_heartbeat >= ?").all(cutoffDegraded, cutoffOffline)
  if (staleDegraded.length) {
    db.prepare("UPDATE cameras SET status = 'Degraded', updated_at = ? WHERE enabled = 1 AND status = 'Online' AND last_heartbeat < ? AND last_heartbeat >= ?").run(now(), cutoffDegraded, cutoffOffline)
    staleDegraded.forEach((camera) => broadcast('camera.updated', publicCamera({ ...camera, status: 'Degraded' })))
  }
}, 15000)

if (require.main === module) {
  server.listen(PORT, () => console.log(`Sentinel API listening on http://localhost:${PORT}`))
}

module.exports = { app, server, db, JWT_SECRET }
