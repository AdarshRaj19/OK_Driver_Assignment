-- SQLite schema used by the local prototype. The tables map directly to PostgreSQL types.
CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE cameras (id TEXT PRIMARY KEY, name TEXT NOT NULL, department TEXT, latitude REAL NOT NULL, longitude REAL NOT NULL, camera_type TEXT NOT NULL, protocol TEXT NOT NULL, endpoint_reference TEXT NOT NULL, status TEXT NOT NULL, last_heartbeat TEXT, zone TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE watchlist (id TEXT PRIMARY KEY, identifier TEXT UNIQUE NOT NULL, entity_type TEXT NOT NULL, reason TEXT NOT NULL, severity TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
CREATE TABLE detections (id TEXT PRIMARY KEY, camera_id TEXT NOT NULL REFERENCES cameras(id), timestamp TEXT NOT NULL, event_type TEXT NOT NULL, vehicle_number TEXT, confidence REAL NOT NULL, vehicle_type TEXT, bounding_box TEXT, source_event_id TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE alerts (id TEXT PRIMARY KEY, detection_id TEXT NOT NULL REFERENCES detections(id), watchlist_id TEXT NOT NULL REFERENCES watchlist(id), camera_id TEXT NOT NULL, identifier TEXT NOT NULL, confidence REAL NOT NULL, status TEXT NOT NULL, severity TEXT NOT NULL, created_at TEXT NOT NULL, acknowledged_at TEXT, resolved_at TEXT);
CREATE TABLE audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id TEXT NOT NULL, action TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT NOT NULL, details TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX detections_vehicle_time ON detections(vehicle_number, timestamp);
CREATE INDEX detections_camera_time ON detections(camera_id, timestamp);
CREATE INDEX alerts_status_time ON alerts(status, created_at);
