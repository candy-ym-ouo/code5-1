import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_SQL } from './schema.ts';

export class Store {
  readonly db: DatabaseSync;

  constructor(databasePath: string) {
    if (databasePath !== ':memory:') {
      fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    }
    this.db = new DatabaseSync(databasePath);
    this.db.exec(SCHEMA_SQL);
    this.migrate();
  }

  private migrate(): void {
    const samplesColumns = this.db.prepare('PRAGMA table_info(samples)').all() as unknown as Array<{ name: string }>;
    if (!samplesColumns.some((column) => column.name === 'slot')) {
      this.db.exec('ALTER TABLE samples ADD COLUMN slot INTEGER NOT NULL DEFAULT 1');
    }

    const savesColumns = this.db.prepare('PRAGMA table_info(saves)').all() as unknown as Array<{ name: string }>;
    if (!savesColumns.some((column) => column.name === 'season_budget')) {
      this.db.exec('ALTER TABLE saves ADD COLUMN season_budget INTEGER NOT NULL DEFAULT 30');
      // 旧档统一沿用 30 点季节预算；中途季节的剩余行动点保持不变，继续按新成本规则结算。
      this.db.exec("UPDATE saves SET season_budget = 30 WHERE season_budget IS NULL OR season_budget <= 0");
    }
  }

  transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }
}
