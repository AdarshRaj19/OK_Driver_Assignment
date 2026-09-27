// Detection simulator for Sentinel Video Intelligence
// Generates synthetic vehicle sightings, person recognitions, and tests real-time ANPR & watchlist alerting

const crypto = require('crypto')

const API_BASE = process.env.API_BASE || 'http://localhost:4000'

const WATCHLIST_PLATES = [
  'GJ01XX0001', // Critical - Stolen
  'GJ01AB1234', // High - Hit and Run
  'MH02XY9999', // High - Contraband
  'GJ27EF4321', // Medium - Tax evasion
]

const WATCHLIST_PERSONS = [
  'PER-9901', // Critical - Person of interest
  'PER-8822', // High - Missing person
]

const RANDOM_PLATES = [
  'GJ01BK2020',
  'GJ01TR9876',
  'GJ05KM4312',
  'MH12PQ5512',
  'RJ14CV8821',
  'DL03AB3311',
  'KA04MN7722',
  'GJ01AZ9011',
  'GJ18BB4004',
  'MH04EZ1290',
]

const RANDOM_PERSONS = ['PER-1044', 'PER-5219', 'PER-7731', 'PER-3092']

const VEHICLE_TYPES = ['sedan', 'suv', 'truck', 'hatchback', 'commercial van']

async function login() {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@sentinel.local', password: 'admin12345' }),
  })
  if (!res.ok) {
    throw new Error(`Login failed with status ${res.status}: ${await res.text()}`)
  }
  const data = await res.json()
  return data.token
}

async function getCameraIds(token) {
  try {
    const res = await fetch(`${API_BASE}/api/cameras`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) {
      const cameras = await res.json()
      if (cameras.length > 0) {
        return cameras.map((c) => c.id)
      }
    }
  } catch {
    console.warn('Could not fetch cameras from API, using fallback defaults.')
  }
  return ['CAM-AHM-001', 'CAM-AHM-002']
}

async function sendHeartbeats(token, cameraIds) {
  for (const cid of cameraIds) {
    try {
      await fetch(`${API_BASE}/api/cameras/${cid}/heartbeat`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
    } catch {
      // Ignore heartbeat errors
    }
  }
}

async function runSimulator() {
  console.log(`Connecting simulator to Sentinel API at ${API_BASE}...`)
  let token
  try {
    token = await login()
    console.log('✓ Successfully authenticated as Admin')
  } catch (err) {
    console.error(`Simulator failed to authenticate: ${err.message}`)
    console.error('Make sure Sentinel API is running (`npm run server` or `npm run dev`)')
    process.exit(1)
  }

  let cameraIds = await getCameraIds(token)
  console.log(`✓ Active camera nodes: ${cameraIds.join(', ')}`)
  console.log('Starting detection stream (cycle every 5-8 seconds)...')
  console.log('Press Ctrl+C to terminate simulator.\n')

  let count = 0

  const cycle = async () => {
    count++
    // Send periodic heartbeats every 3rd cycle to keep cameras healthy
    if (count % 3 === 0) {
      await sendHeartbeats(token, cameraIds)
    }

    // Refresh camera list occasionally in case user added a camera
    if (count % 10 === 0) {
      cameraIds = await getCameraIds(token)
    }

    const cameraId = cameraIds[Math.floor(Math.random() * cameraIds.length)]
    const sourceEventId = crypto.randomUUID()
    const confidence = Math.round((0.75 + Math.random() * 0.23) * 1000) / 1000
    const boundingBox = {
      x: Math.round((0.3 + Math.random() * 0.2) * 100) / 100,
      y: Math.round((0.25 + Math.random() * 0.2) * 100) / 100,
      width: 0.18,
      height: 0.14,
    }

    // ~15% chance for a person detection event
    const isPerson = Math.random() < 0.15
    let payload

    if (isPerson) {
      // 50% chance watchlisted person vs random person
      const isWatchlistPerson = Math.random() < 0.5
      const personId = isWatchlistPerson
        ? WATCHLIST_PERSONS[Math.floor(Math.random() * WATCHLIST_PERSONS.length)]
        : RANDOM_PERSONS[Math.floor(Math.random() * RANDOM_PERSONS.length)]

      payload = {
        camera_id: cameraId,
        timestamp: new Date().toISOString(),
        event_type: 'person_detection',
        person_id: personId,
        confidence,
        bounding_box: boundingBox,
        source_event_id: sourceEventId,
      }
    } else {
      // Vehicle detection: ~20% watchlisted plate, ~80% random plate
      const isWatchlist = Math.random() < 0.2
      const plate = isWatchlist
        ? WATCHLIST_PLATES[Math.floor(Math.random() * WATCHLIST_PLATES.length)]
        : RANDOM_PLATES[Math.floor(Math.random() * RANDOM_PLATES.length)]
      const vehicleType = VEHICLE_TYPES[Math.floor(Math.random() * VEHICLE_TYPES.length)]

      payload = {
        camera_id: cameraId,
        timestamp: new Date().toISOString(),
        event_type: 'ANPR',
        vehicle_number: plate,
        confidence,
        vehicle_type: vehicleType,
        bounding_box: boundingBox,
        source_event_id: sourceEventId,
      }
    }

    try {
      const res = await fetch(`${API_BASE}/api/detections`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        const data = await res.json()
        const timeStr = new Date().toLocaleTimeString('en-GB')
        const targetId = payload.vehicle_number || payload.person_id
        if (data.alert) {
          console.log(
            `[${timeStr}] 🚨 ALERT TRIGGERED! Target: ${targetId} (${payload.event_type}) | Severity: ${data.alert.severity} | Camera: ${cameraId} (${Math.round(confidence * 100)}%)`
          )
        } else {
          console.log(
            `[${timeStr}] 📡 Detection: ${targetId} (${payload.event_type}) | Camera: ${cameraId} (${Math.round(confidence * 100)}%)`
          )
        }
      } else {
        const errText = await res.text()
        console.warn(`[Warning] Ingestion returned ${res.status}: ${errText}`)
      }
    } catch (err) {
      console.error(`[Error] Failed to post detection: ${err.message}`)
    }

    const nextDelay = 5000 + Math.floor(Math.random() * 3000)
    setTimeout(cycle, nextDelay)
  }

  // Start first cycle
  cycle()
}

runSimulator()
