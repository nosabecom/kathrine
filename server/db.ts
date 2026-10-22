import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import type { Media } from '../shared/types.js';

export function openDatabase(dataDir: string) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = join(dataDir, 'kathrine.sqlite');
  const db = new DatabaseSync(file);
  chmodSync(file, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL COLLATE NOCASE, password TEXT NOT NULL, admin INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS libraries(id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT UNIQUE NOT NULL, kind TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS media(id TEXT PRIMARY KEY, library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE, path TEXT UNIQUE NOT NULL, mtime REAL NOT NULL, size INTEGER NOT NULL, metadata TEXT NOT NULL, added_at INTEGER NOT NULL, available INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS progress(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE, position REAL NOT NULL DEFAULT 0, completed INTEGER NOT NULL DEFAULT 0, favorite INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, PRIMARY KEY(user_id, media_id));
    CREATE INDEX IF NOT EXISTS media_library ON media(library_id);
    CREATE INDEX IF NOT EXISTS session_expiry ON sessions(expires);
    CREATE TABLE IF NOT EXISTS pairing(code TEXT PRIMARY KEY, device TEXT NOT NULL, poll_hash TEXT NOT NULL, user_id TEXT REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
  `);
  db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
  db.prepare('DELETE FROM pairing WHERE expires < ?').run(Date.now());
  return db;
}
export type DB = ReturnType<typeof openDatabase>;
export type MediaRow = { id: string; library_id: string; path: string; mtime: number; size: number; metadata: string; added_at: number; available: number; position?: number; completed?: number; favorite?: number; progress_updated_at?:number };
export function publicMedia(row: MediaRow): Media {
  const { metadataVersion, remoteArtwork, enrichmentVersion, enrichedAt, metadataRefreshAfter, ...metadata } = JSON.parse(row.metadata);
  return { ...metadata, id: row.id, libraryId: row.library_id, addedAt: row.added_at, available: !!row.available, position: row.position || 0, completed: !!row.completed, favorite: !!row.favorite, progressUpdatedAt:row.progress_updated_at||0 };
}
export const mediaSelect = 'SELECT m.*, p.position, p.completed, p.favorite, p.updated_at AS progress_updated_at FROM media m LEFT JOIN progress p ON p.media_id=m.id AND p.user_id=?';
