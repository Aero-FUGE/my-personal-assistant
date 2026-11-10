CREATE TABLE IF NOT EXISTS push_devices (
 id TEXT PRIMARY KEY, subscription TEXT NOT NULL, app_url TEXT NOT NULL,
 timezone TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
 revision INTEGER NOT NULL DEFAULT 0, min_interval INTEGER NOT NULL DEFAULT 0,
 last_sent INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS push_reminders (
 device_id TEXT NOT NULL REFERENCES push_devices(id) ON DELETE CASCADE,
 id TEXT NOT NULL, title TEXT NOT NULL, due_at INTEGER NOT NULL,
 route TEXT NOT NULL, version TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
 PRIMARY KEY(device_id,id)
);
CREATE INDEX IF NOT EXISTS push_due ON push_reminders(state,due_at);
