import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import Database from 'better-sqlite3';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  const dataDir = process.env.SLACK_MCP_DATA_DIR ?? join(homedir(), '.local', 'share', 'mcp-slack');
  mkdirSync(dataDir, { recursive: true });

  const dbPath = join(dataDir, 'data.db');
  db = new Database(dbPath);

  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      synced_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_channels_name ON channels(name);

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      synced_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_users_name ON users(name);

    CREATE TABLE IF NOT EXISTS user_groups (
      id TEXT PRIMARY KEY,
      handle TEXT NOT NULL,
      synced_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_user_groups_handle ON user_groups(handle);

    CREATE TABLE IF NOT EXISTS sync_meta (
      table_name TEXT PRIMARY KEY,
      started_at INTEGER NOT NULL DEFAULT 0,
      completed_at INTEGER NOT NULL DEFAULT 0
    );
  `);

  const upsert = db.prepare(
    'INSERT OR IGNORE INTO sync_meta (table_name, started_at, completed_at) VALUES (?, 0, 0)'
  );
  db.transaction(() => {
    upsert.run('channels');
    upsert.run('users');
    upsert.run('user_groups');
  })();

  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
