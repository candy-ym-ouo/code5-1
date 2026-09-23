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
    const sampleColumns = this.db.prepare('PRAGMA table_info(samples)').all() as unknown as Array<{ name: string }>;
    if (!sampleColumns.some((column) => column.name === 'slot')) {
      this.db.exec('ALTER TABLE samples ADD COLUMN slot INTEGER NOT NULL DEFAULT 1');
    }

    // 旧档迁移：新增移动/等待/跨区探索共用的当日恢复预算列。
    // 默认值取 0，读取旧档时按存档所处季节懒初始化，保证“旧档进度”不被重置。
    const saveColumns = this.db.prepare('PRAGMA table_info(saves)').all() as unknown as Array<{ name: string }>;
    if (!saveColumns.some((column) => column.name === 'travel_points')) {
      this.db.exec('ALTER TABLE saves ADD COLUMN travel_points INTEGER NOT NULL DEFAULT 0');
    }
    if (!saveColumns.some((column) => column.name === 'travel_limit')) {
      this.db.exec('ALTER TABLE saves ADD COLUMN travel_limit INTEGER NOT NULL DEFAULT 0');
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
