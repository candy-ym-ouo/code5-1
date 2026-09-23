import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../src/db/store.ts';

const OLD_SAVES_SCHEMA = `
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE TABLE saves (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  seed TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  year INTEGER NOT NULL,
  season TEXT NOT NULL,
  day INTEGER NOT NULL,
  slot INTEGER NOT NULL,
  action_points INTEGER NOT NULL,
  phase TEXT NOT NULL,
  current_site_id TEXT NOT NULL,
  year_start_species_json TEXT NOT NULL,
  year_start_sites_json TEXT NOT NULL,
  restoration_unlocked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

describe('legacy save migration', () => {
  let directory: string;
  let databasePath: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'shanhai-migrate-'));
    databasePath = path.join(directory, 'legacy.db');
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('adds the shared season budget column without resetting in-progress progress', () => {
    const setup = new DatabaseSync(databasePath);
    setup.exec(OLD_SAVES_SCHEMA);
    setup
      .prepare(
        `INSERT INTO saves (
          id, session_id, seed, revision, year, season, day, slot, action_points, phase,
          current_site_id, year_start_species_json, year_start_sites_json,
          restoration_unlocked, created_at, updated_at
        ) VALUES ('save-1', 'session-1', 'seed', 7, 2, 'autumn', 4, 2, 19, 'active',
          'ridge', '[]', '[]', 0, '2026-01-01', '2026-01-02')`
      )
      .run();
    setup.close();

    const store = new Store(databasePath);
    const columns = store.db.prepare('PRAGMA table_info(saves)').all() as unknown as Array<{ name: string }>;
    expect(columns.some((column) => column.name === 'season_budget')).toBe(true);

    const row = store.db.prepare('SELECT * FROM saves WHERE id = ?').get('save-1') as unknown as {
      year: number;
      season: string;
      day: number;
      slot: number;
      action_points: number;
      season_budget: number;
      revision: number;
      current_site_id: string;
    };
    // 旧档季中进度完整保留，仅补齐 30 点季节预算
    expect(row.year).toBe(2);
    expect(row.season).toBe('autumn');
    expect(row.day).toBe(4);
    expect(row.slot).toBe(2);
    expect(row.action_points).toBe(19);
    expect(row.season_budget).toBe(30);
    expect(row.revision).toBe(7);
    expect(row.current_site_id).toBe('ridge');
    store.close();
  });

  it('is idempotent when the database is opened repeatedly', () => {
    const storeA = new Store(databasePath);
    storeA.close();
    const storeB = new Store(databasePath);
    const columns = storeB.db.prepare('PRAGMA table_info(saves)').all() as unknown as Array<{ name: string }>;
    expect(columns.filter((column) => column.name === 'season_budget')).toHaveLength(1);
    const sampleColumns = storeB.db.prepare('PRAGMA table_info(samples)').all() as unknown as Array<{ name: string }>;
    expect(sampleColumns.some((column) => column.name === 'slot')).toBe(true);
    storeB.close();
  });
});
