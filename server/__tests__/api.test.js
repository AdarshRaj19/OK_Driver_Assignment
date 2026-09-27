import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import crypto from 'crypto'
import backend from '../index.cjs'

const { app } = backend

describe('Sentinel API Tests', () => {
  let adminToken

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@sentinel.local', password: 'admin12345' })

    expect(res.status).toBe(200)
    expect(res.body.token).toBeDefined()
    adminToken = res.body.token
  })

  // Test 3: Protected route without Authorization returns 401
  it('protected route without Authorization header returns 401', async () => {
    const res = await request(app).get('/api/cameras')
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('Authentication required')
  })

  // Test 1: Posting duplicate source_event_id returns 409
  it('posting the same source_event_id twice returns 409 on second call', async () => {
    const eventId = `test-dup-${crypto.randomUUID()}`
    const payload = {
      camera_id: 'CAM-AHM-001',
      event_type: 'ANPR',
      vehicle_number: 'TEST8888',
      confidence: 0.92,
      source_event_id: eventId,
    }

    const first = await request(app)
      .post('/api/detections')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(payload)

    expect(first.status).toBe(201)

    const second = await request(app)
      .post('/api/detections')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(payload)

    expect(second.status).toBe(409)
    expect(second.body.error).toBe('Duplicate source event')
  })

  // Test 2: Detection with watchlisted identifier creates an alert
  it('detection with watchlisted vehicle_number results in an alert being created', async () => {
    const eventId = `test-alert-${crypto.randomUUID()}`
    const payload = {
      camera_id: 'CAM-AHM-001',
      event_type: 'ANPR',
      vehicle_number: 'GJ01XX0001', // Seeded Critical watchlist entry
      confidence: 0.98,
      source_event_id: eventId,
    }

    const detectionRes = await request(app)
      .post('/api/detections')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(payload)

    expect(detectionRes.status).toBe(201)
    expect(detectionRes.body.alert).toBeDefined()
    expect(detectionRes.body.alert.identifier).toBe('GJ01XX0001')
    expect(detectionRes.body.alert.status).toBe('Active')

    const alertListRes = await request(app)
      .get('/api/alerts')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(alertListRes.status).toBe(200)
    const foundAlert = alertListRes.body.find((a) => a.id === detectionRes.body.alert.id)
    expect(foundAlert).toBeDefined()
    expect(foundAlert.identifier).toBe('GJ01XX0001')
  })
})
