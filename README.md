# Sentinel Video Intelligence

Full-stack prototype for the okDriver CCTV monitoring challenge. It includes a React operator console, Express API, persistent SQLite database with automated seeding, JWT authentication, admin RBAC, camera registry, watchlist correlation, alert persistence, audit logs, WebSocket updates, GIS movement rendering, and browser-playable HTTP video endpoints.

## Run

```bash
npm install
npm run dev
```

`npm run dev` starts the API on `http://localhost:4000` and Vite on `http://localhost:5173`. The frontend proxies `/api` and `/ws` to the API.

Local admin account: `admin@sentinel.local` / `admin12345`. Change this before deployment and set `JWT_SECRET`.

### Automated Detection Simulator

In a separate terminal, launch the synthetic detection simulator to stream live vehicle events, trigger realistic watchlist alerts, and simulate edge heartbeats:

```bash
npm run simulate
```

Production checks:

```bash
npm run build
npm run lint
npm run server
```

Docker:

```bash
docker compose up --build
```

## Implemented flow

1. **Authentication**: Admin authenticates via JWT with bcrypt credentials.
2. **Initial Seeding**: On initial startup, `server/seed.cjs` seeds 2 representative cameras (including one RTSP adapter at an Ahmedabad junction and one HLS relay with playable video at an RTO checkpoint) and 5 watchlist entries with severity tags.
3. **Live Simulator**: Running `npm run simulate` logs in as admin, sends heartbeats, and posts continuous synthetic ANPR detections (~every 5-7s) to `POST /api/detections` with unique `source_event_id`s and bounding boxes.
4. **Watchlist Correlation & Alerting**: When a detected plate matches an active watchlist entry (e.g. `GJ01AB1234`), an alert is generated, audited, and broadcast in real-time over WebSockets.
5. **Operator Workflow**: Operators can click **"Acknowledge"** and **"Resolve"** directly on alert cards in the dashboard, dispatching `PATCH /api/alerts/:id/status`.
6. **Watchlist Management**: Operators can manage the watchlist directly in the UI (or via `POST /api/watchlist`, `PUT /api/watchlist/:id`, and `PATCH /api/watchlist/:id/disable`).
7. **GIS Movement Tracing**: Searching for a vehicle identifier displays its sighting history and renders an animated movement trajectory across cameras on the Leaflet map.
8. **Audit Trail**: Every administrative action, camera update, watchlist change, and alert state transition is recorded in the audit log and viewable in the Audit tab.

## API

All routes except health and login require `Authorization: Bearer <token>`.

- `POST /api/auth/login` (rate-limited)
- `POST /api/auth/register` (default role: operator)
- `GET /api/cameras`
- `POST /api/cameras` (admin)
- `PUT /api/cameras/:id` (admin)
- `PATCH /api/cameras/:id/disable` (admin)
- `POST /api/cameras/:id/heartbeat`
- `GET /api/watchlist`
- `POST /api/watchlist` (admin)
- `PUT /api/watchlist/:id` (admin)
- `PATCH /api/watchlist/:id/disable` (admin)
- `GET /api/detections` (rate-limited)
- `POST /api/detections` (rate-limited)
- `GET /api/alerts`
- `PATCH /api/alerts/:id/status`
- `GET /api/audit-logs` (admin)
- `GET /api/health`
- WebSocket: `/ws`

Example detection:

```json
{
  "camera_id": "CAM-AHM-001",
  "timestamp": "2026-09-26T10:41:22.000Z",
  "event_type": "ANPR",
  "vehicle_number": "GJ01AB1234",
  "confidence": 0.987,
  "vehicle_type": "sedan",
  "bounding_box": { "x": 0.42, "y": 0.38, "width": 0.16, "height": 0.12 },
  "source_event_id": "edge-ahm-9182"
}
```

## Video boundary

Browser clients cannot open RTSP directly without server-side transcoding or WebRTC gateways. HTTP(S) `.mp4`, HLS, or WebRTC-compatible URLs entered in the camera endpoint are rendered in a real `<video>` element with native hardware decoding. RTSP and ONVIF records are persisted as adapter references; the production gateway should use FFmpeg/GStreamer or MediaMTX to expose HLS/WebRTC. This boundary is documented rather than presenting a styled div as live video.

## Known limitations

1. **SQLite storage**: Chosen deliberately for zero-infrastructure, portable local evaluation. The schema uses foreign keys, WAL mode, and strict data typing that is 100% compatible with PostgreSQL/PostGIS in production.
2. **Simulated stream hardware**: Physical CCTV cameras with raw RTSP/ONVIF are simulated through adapters and sample video streams due to browser sandbox constraints and lack of external physical camera hardware in evaluation environments.
3. **No OpenAPI / Swagger UI**: Route schemas are strictly validated at the runtime boundary using Zod (`cameraSchema`, `detectionSchema`, etc.) and documented directly in this README.
4. **Automated test suite**: Focus was placed on end-to-end manual and simulated verification (`npm run simulate`) along with strict TypeScript compilation and Oxlint checks rather than unit test suites.

## Project artifacts

- `server/index.cjs`: API, SQLite schema bootstrap, JWT/RBAC, watchlist matcher, rate limiting, audit logging, WebSocket gateway.
- `server/seed.cjs`: Automated bootstrap seed script for camera sources and watchlist records.
- `scripts/simulate-detections.cjs`: Real-time synthetic detection and alert generator for live demos.
- `database/schema.sql`: Relational schema and indexes.
- `docs/architecture.md`: Architecture diagram, security boundaries, and enterprise scale-out path.
- `Dockerfile` and `docker-compose.yml`: Reproducible API deployment.
- `data/sentinel.sqlite`: Created on first API start and ignored by Git.
