const path = require('path')
const Database = require('better-sqlite3')

const seedData = (db) => {
  const now = new Date().toISOString()

  // 1. Seed cameras (idempotent with INSERT OR IGNORE)
  const insertCam = db.prepare(`
    INSERT OR IGNORE INTO cameras (id, name, department, latitude, longitude, camera_type, protocol, endpoint_reference, status, last_heartbeat, zone, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `)

  // Camera 1: HLS relay at Ahmedabad West with playable HTTP MP4 URL
  insertCam.run(
    'CAM-AHM-001',
    'Satellite Junction West',
    'Traffic Police Ahmedabad',
    23.0304,
    72.5178,
    'Registered source',
    'HLS relay',
    'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    'Online',
    now,
    'Ahmedabad West',
    now,
    now
  )

  // Camera 2: RTSP adapter at Ahmedabad East (falls into CSS simulated feed)
  insertCam.run(
    'CAM-AHM-002',
    'Kalupur Junction East',
    'RTO Transport Gujarat',
    23.0289,
    72.6012,
    'Registered source',
    'RTSP adapter',
    'rtsp://edge-node/camera-002',
    'Online',
    now,
    'Ahmedabad East',
    now,
    now
  )

  // 2. Seed watchlist entries (idempotent with INSERT OR REPLACE)
  const insertWl = db.prepare(`
    INSERT OR REPLACE INTO watchlist (id, identifier, entity_type, reason, severity, enabled, created_at)
    VALUES (?, ?, ?, ?, ?, 1, ?)
  `)

  // Vehicles
  insertWl.run('WL-000', 'GJ01XX0001', 'vehicle', 'Reported stolen - FIR #8921/2026 Crime Branch', 'Critical', now)
  insertWl.run('WL-001', 'GJ01AB1234', 'vehicle', 'Hit and run suspect - SG Highway incident', 'High', now)
  insertWl.run('WL-002', 'GJ01CD5678', 'vehicle', 'Stolen commercial truck', 'High', now)
  insertWl.run('WL-003', 'MH02XY9999', 'vehicle', 'Interstate contraband transport alert', 'High', now)
  insertWl.run('WL-004', 'GJ27EF4321', 'vehicle', 'Tax evasion / repeated toll bypass flag', 'Medium', now)

  // Persons (FR / facial recognition watch)
  insertWl.run('WL-005', 'PER-9901', 'person', 'Person of interest - Kalupur station alert', 'Critical', now)
  insertWl.run('WL-006', 'PER-8822', 'person', 'Missing person inquiry #1102', 'High', now)
}

if (require.main === module) {
  const dataDir = path.join(__dirname, '..', 'data')
  const db = new Database(path.join(dataDir, 'sentinel.sqlite'))
  seedData(db)
  console.log('Database seeding complete.')
}

module.exports = { seedData }
