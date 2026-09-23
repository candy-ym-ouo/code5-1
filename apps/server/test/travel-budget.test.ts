import { describe, expect, it, vi } from 'vitest';
import type { GameCommand, RecentEvent, Season, SiteId, WorldSnapshot } from '@shanhai/contracts';
import { travelCost, travelLimitFor } from '@shanhai/contracts';
import type { SpeciesDefinition } from '@shanhai/game-core';
import { SPECIES, SITES } from '@shanhai/game-core';
import { GameService } from '../src/services/game-service.ts';
import { AppError } from '../src/errors.ts';

// 极简内存数据库：仅覆盖 GameService 在本特性中触达的 SQL，
// 用来在没有 node:sqlite 的环境下验证行动点/移动体力预算与回滚语义。
interface SaveRow {
  id: string;
  session_id: string;
  seed: string;
  revision: number;
  year: number;
  season: Season;
  day: number;
  slot: number;
  action_points: number;
  travel_points: number;
  travel_limit: number;
  phase: string;
  current_site_id: SiteId;
  year_start_species_json: string;
  year_start_sites_json: string;
  restoration_unlocked: number;
  created_at: string;
  updated_at: string;
}

function createFakeStore() {
  const saves = new Map<string, SaveRow>();
  const siteStates = new Map<string, any>();
  const speciesStates = new Map<string, any>();
  const observations: any[] = [];
  const samples: any[] = [];
  const events: any[] = [];
  const receipts = new Map<string, { command_hash: string; response_json: string }>();
  const summaries: any[] = [];
  const annualReports: any[] = [];
  const envHistory: any[] = [];

  const key = (...parts: Array<string | number>) => parts.join('|');

  const statement = (sql: string) => ({
    get: (...params: unknown[]) => {
      if (sql.includes('SELECT id FROM sessions')) {
        return params[0] === 'session-1' ? { id: 'session-1' } : undefined;
      }
      if (sql.includes('FROM saves WHERE id = ? AND session_id = ?')) {
        const row = saves.get(String(params[0]));
        return row && row.session_id === params[1] ? clone(row) : undefined;
      }
      if (sql.includes('FROM saves WHERE session_id = ?')) {
        for (const row of saves.values()) {
          if (row.session_id === params[0]) return clone(row);
        }
        return undefined;
      }
      if (sql.includes('FROM site_states WHERE save_id = ? AND year = ? AND site_id = ?')) {
        return clone(siteStates.get(key(String(params[0]), Number(params[1]), String(params[2])))) ?? undefined;
      }
      if (sql.includes('FROM species_states WHERE save_id = ? AND year = ? AND site_id = ? AND species_id = ?')) {
        return clone(speciesStates.get(key(...(params as [string, number, string, string])))) ?? undefined;
      }
      if (sql.includes('COALESCE(MAX(sequence)')) {
        return { sequence: events.length };
      }
      if (sql.includes('FROM command_receipts')) {
        return clone(receipts.get(key(String(params[0]), String(params[1])))) ?? undefined;
      }
      if (sql.includes('COUNT(*) AS count FROM samples')) {
        return { count: countSamples(samples, params) };
      }
      if (sql.includes('FROM observations') && sql.includes('COUNT(*)')) {
        return { count: observations.length };
      }
      if (sql.includes('AVG(score)')) {
        return { count: observations.length, average: 0 };
      }
      if (sql.includes('SUM(CASE WHEN protocol_match = 0')) {
        return { count: samples.length, incorrect: samples.filter((sample) => sample.protocol_match === 0).length };
      }
      if (sql.includes('COUNT(*) AS count,') || sql.includes('COUNT(*) AS count FROM samples WHERE save_id = ? AND year = ?')) {
        return { count: samples.length };
      }
      if (sql.includes('SELECT species_id, method, COUNT(*)')) {
        return [];
      }
      if (sql.includes('SELECT species_id, COUNT(*)')) {
        return [];
      }
      if (sql.includes('FROM game_events')) return undefined;
      if (sql.includes('FROM season_summaries')) return undefined;
      if (sql.includes('FROM annual_reports WHERE save_id = ? AND year = ?')) {
        return annualReports.find((report) => report.save_id === params[0] && report.year === Number(params[1])) ?? undefined;
      }
      return undefined;
    },
    all: (...params: unknown[]) => {
      if (sql.includes('FROM site_states')) {
        return [...siteStates.values()].filter((row) => row.save_id === params[0] && row.year === Number(params[1])).map(clone);
      }
      if (sql.includes('FROM species_states')) {
        return [...speciesStates.values()].filter((row) => row.save_id === params[0] && row.year === Number(params[1])).map(clone);
      }
      if (sql.includes('FROM environment_history')) {
        return envHistory
          .filter((row) => row.save_id === params[0] && row.year === Number(params[1]) && row.season === params[2])
          .map(clone);
      }
      if (sql.includes('FROM observations') || sql.includes('FROM samples')) return [];
      if (sql.includes('FROM annual_reports')) return annualReports;
      if (sql.includes('FROM game_events')) return events.slice(-12).reverse().map(clone);
      return [];
    },
    run: (...params: unknown[]) => {
      if (sql.trimStart().startsWith('INSERT INTO sessions')) {
        return;
      }
      if (sql.trimStart().startsWith('INSERT INTO saves')) {
        const [id, session_id, seed, travel_points, travel_limit, created_at, updated_at] =
          params as unknown[] as any[];
        saves.set(String(id), {
          id: String(id),
          session_id: String(session_id),
          seed: String(seed),
          revision: 0,
          year: 1,
          season: 'spring',
          day: 1,
          slot: 1,
          action_points: 30,
          travel_points: Number(travel_points),
          travel_limit: Number(travel_limit),
          phase: 'active',
          current_site_id: 'foothill',
          year_start_species_json: '[]',
          year_start_sites_json: '[]',
          restoration_unlocked: 0,
          created_at: String(created_at),
          updated_at: String(updated_at)
        });
        return;
      }
      if (sql.trimStart().startsWith('UPDATE saves SET')) {
        const [
          revision, year, season, day, slot, action_points, travel_points, travel_limit, phase,
          current_site_id, ys, ysite, restoration_unlocked, updated_at, id
        ] = params as unknown[] as any[];
        const row = saves.get(String(id));
        if (row) {
          Object.assign(row, {
            revision: Number(revision),
            year: Number(year),
            season: String(season) as Season,
            day: Number(day),
            slot: Number(slot),
            action_points: Number(action_points),
            travel_points: Number(travel_points),
            travel_limit: Number(travel_limit),
            phase: String(phase),
            current_site_id: String(current_site_id) as SiteId,
            year_start_species_json: String(ys),
            year_start_sites_json: String(ysite),
            restoration_unlocked: Number(restoration_unlocked)
          });
        }
        return;
      }
      if (sql.includes('INSERT INTO site_states') || sql.trimStart().startsWith('INSERT OR REPLACE INTO environment_history')) {
        const [save_id, year, site_id, weather, temperature_c, humidity, soil_moisture, light_lux, wind_speed, disturbance] =
          params as unknown[] as any[];
        const row = {
          save_id: String(save_id),
          year: Number(year),
          site_id: String(site_id) as SiteId,
          weather: String(weather),
          temperature_c: Number(temperature_c),
          humidity: Number(humidity),
          soil_moisture: Number(soil_moisture),
          light_lux: Number(light_lux),
          wind_speed: Number(wind_speed),
          disturbance: Number(disturbance)
        };
        siteStates.set(key(row.save_id, row.year, row.site_id), row);
        envHistory.push(row);
        return;
      }
      if (sql.includes('INSERT INTO species_states')) {
        const [save_id, year, site_id, species_id, population, health, seed_bank, suitability, status, phenology_json] =
          params as unknown[] as any[];
        const row = {
          save_id: String(save_id),
          year: Number(year),
          site_id: String(site_id) as SiteId,
          species_id: String(species_id),
          population: Number(population),
          health: Number(health),
          seed_bank: Number(seed_bank),
          suitability: Number(suitability),
          status: String(status),
          phenology_json: String(phenology_json)
        };
        speciesStates.set(key(row.save_id, row.year, row.site_id, row.species_id), row);
        return;
      }
      if (sql.includes('INSERT INTO observations')) {
        observations.push({});
        return;
      }
      if (sql.includes('INSERT INTO samples')) {
        const [id, save_id, , year, season, day, slot, site_id, species_id, method, protocol_match, effects_json, created_at] =
          params as unknown[] as any[];
        samples.push({
          id: String(id),
          save_id: String(save_id),
          year: Number(year),
          season: String(season),
          day: Number(day),
          slot: Number(slot),
          site_id: String(site_id),
          species_id: String(species_id),
          method: String(method),
          protocol_match: Number(protocol_match),
          effects_json: String(effects_json),
          created_at: String(created_at)
        });
        return;
      }
      if (sql.includes('INSERT INTO game_events')) {
        const [id, save_id, sequence, type, message, effects_json, payload_json, created_at] = params as unknown[] as any[];
        events.push({
          id: String(id),
          save_id: String(save_id),
          sequence: Number(sequence),
          type: String(type),
          message: String(message),
          effects_json: String(effects_json),
          payload_json: String(payload_json),
          created_at: String(created_at)
        });
        return;
      }
      if (sql.includes('INSERT INTO command_receipts')) {
        const [save_id, idempotency_key, command_hash, response_json, created_at] = params as unknown[] as any[];
        receipts.set(key(String(save_id), String(idempotency_key)), {
          command_hash: String(command_hash),
          response_json: String(response_json)
        });
        void created_at;
        return;
      }
      if (sql.includes('INSERT INTO season_summaries')) {
        summaries.push(params);
        return;
      }
      if (sql.includes('INSERT OR REPLACE INTO annual_reports')) {
        const [id, save_id, year, report_json, created_at] = params as unknown[] as any[];
        annualReports.push({ id: String(id), save_id: String(save_id), year: Number(year), report_json: String(report_json), created_at });
        return;
      }
    }
  });

  return {
    saves,
    siteStates,
    speciesStates,
    samples,
    receipts,
    transaction<T>(operation: () => T): T {
      return operation();
    },
    db: { prepare: statement }
  };
}

function countSamples(samples: any[], params: unknown[]): number {
  return samples.filter(
    (sample) =>
      sample.save_id === String(params[0]) &&
      sample.year === Number(params[1]) &&
      sample.season === String(params[2]) &&
      sample.species_id === String(params[3]) &&
      sample.method === String(params[4])
  ).length;
}

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

interface CommandResult {
  world: WorldSnapshot;
  event: RecentEvent;
  evaluation: unknown;
}

function seedWorld(service: GameService, fakeStore: ReturnType<typeof createFakeStore>, overrides: Partial<SaveRow> = {}) {
  service.createSession('hash');
  service.createSave('session-1');
  const row = [...fakeStore.saves.values()][0]!;
  Object.assign(row, overrides, { updated_at: new Date().toISOString() });
  return row.id;
}

function execute(service: GameService, saveId: string, command: GameCommand, revision: number, key = `key-${revision}-${command.type}`): CommandResult {
  return service.executeCommand('session-1', saveId, {
    expectedRevision: revision,
    idempotencyKey: key,
    command
  }) as CommandResult;
}

describe('travel budget rules', () => {
  it('charges adjacent moves 1 point and long moves 2, with winter penalty', () => {
    expect(travelCost('move', 'foothill', 'mixed_forest', 'spring')).toBe(1);
    expect(travelCost('move', 'foothill', 'stream_valley', 'summer')).toBe(2);
    expect(travelCost('move', 'foothill', 'stream_valley', 'winter')).toBe(3);
    expect(travelCost('explore', 'foothill', 'mixed_forest', 'spring')).toBe(1);
    expect(travelCost('explore', 'foothill', 'mixed_forest', 'winter')).toBe(2);
    expect(travelCost('explore', 'foothill', 'stream_valley', 'autumn')).toBe(3);
    expect(travelCost('explore', 'foothill', 'stream_valley', 'winter')).toBe(4);
  });

  it('uses shorter travel budgets in winter', () => {
    expect(travelLimitFor('summer')).toBe(5);
    expect(travelLimitFor('spring')).toBe(4);
    expect(travelLimitFor('autumn')).toBe(4);
    expect(travelLimitFor('winter')).toBe(3);
  });
});

describe('shared recovery budget via GameService', () => {
  function setup(overrides: Partial<SaveRow> = {}) {
    const fakeStore = createFakeStore() as unknown as ConstructorParameters<typeof GameService>[0];
    const service = new GameService(fakeStore);
    const saveId = seedWorld(service, fakeStore as unknown as ReturnType<typeof createFakeStore>, overrides);
    return { service, fakeStore: fakeStore as unknown as ReturnType<typeof createFakeStore>, saveId };
  }

  it('gives a new spring save a full 4/4 shared budget and charges moves from it', () => {
    const { service, saveId } = setup();
    const result = execute(service, saveId, { type: 'MOVE_ZONE', siteId: 'mixed_forest' }, 0);
    expect(result.world.travelPoints).toBe(3);
    expect(result.world.travelLimit).toBe(4);
    expect(result.world.actionPoints).toBe(29);
  });

  it('WAIT costs no travel stamina and restores one point up to the seasonal cap', () => {
    const { service, saveId } = setup({ action_points: 29, travel_points: 2, travel_limit: 4 });
    let result = execute(service, saveId, { type: 'WAIT' }, 0, 'wait-1');
    expect(result.world.travelPoints).toBe(3);
    expect(result.world.actionPoints).toBe(28);
    result = execute(service, saveId, { type: 'WAIT' }, 1, 'wait-2');
    expect(result.world.travelPoints).toBe(4);
    result = execute(service, saveId, { type: 'WAIT' }, 2, 'wait-3');
    expect(result.world.travelPoints).toBe(4);
  });

  it('shares one budget between moves, waits and recon, and refills when the day rolls over', () => {
    const { service, saveId } = setup({ action_points: 28, travel_points: 2, day: 1, slot: 3 });
    // 远途侦察到非相邻溪谷：春季 3 点，预算 2 不足 → 拒绝。
    expect(() => execute(service, saveId, { type: 'EXPLORE_ZONE', siteId: 'stream_valley' }, 0, 'recon-blocked')).toThrow(
      AppError
    );
    // 等待恢复 1 点到 3，仍占用一个行动点（推进到第 2 日，触发补满）。
    const waited = execute(service, saveId, { type: 'WAIT' }, 0, 'wait-refill');
    expect(waited.world.day).toBe(2);
    expect(waited.world.travelPoints).toBe(4);
    // 补满后跨区侦察成功。
    const recon = execute(service, saveId, { type: 'EXPLORE_ZONE', siteId: 'stream_valley' }, 1, 'recon-ok');
    expect(recon.world.travelPoints).toBe(1);
    expect(recon.event.type).toBe('EXPLORE_ZONE');
    expect(recon.evaluation).toMatchObject({ siteId: 'stream_valley', adjacent: false, cost: 3 });
  });

  it('rolls back and does not double-charge when a command fails validation', () => {
    const { service, fakeStore, saveId } = setup({ travel_points: 2 });
    const before = clone([...fakeStore.saves.values()][0]!);
    let failed: AppError | undefined;
    try {
      execute(service, saveId, { type: 'EXPLORE_ZONE', siteId: 'stream_valley' }, 0, 'recon-fail');
    } catch (error) {
      failed = error as AppError;
    }
    expect(failed?.code).toBe('TRAVEL_BUDGET_EXHAUSTED');
    const after = [...fakeStore.saves.values()][0]!;
    // 没有任何写入：行动点、移动体力、时间、revision 全部保持原值。
    expect(after.action_points).toBe(before.action_points);
    expect(after.travel_points).toBe(before.travel_points);
    expect(after.day).toBe(before.day);
    expect(after.revision).toBe(before.revision);
    expect(fakeStore.samples.length).toBe(0);

    // 用同一幂等键重试同一失败命令：因为之前没有产生回执，重试应正常成功
    // （先等待把预算补够，再重试），且不会被扣费两次。
    execute(service, saveId, { type: 'WAIT' }, 0, 'wait-before-retry');
    const retry = execute(service, saveId, { type: 'EXPLORE_ZONE', siteId: 'stream_valley' }, 1, 'recon-fail');
    expect(retry.event.type).toBe('EXPLORE_ZONE');
    expect(retry.world.revision).toBe(2);
  });

  it('keeps a rejected command free of receipts while concurrent commands lose the revision race', () => {
    const { service, fakeStore, saveId } = setup();
    // 两个基于 revision=0 的并发命令：先到的成功，后到的版本冲突且不写任何东西。
    execute(service, saveId, { type: 'WAIT' }, 0, 'concurrent-1');
    expect(() => execute(service, saveId, { type: 'WAIT' }, 0, 'concurrent-2')).toThrow(AppError);
    const save = [...fakeStore.saves.values()][0]!;
    expect(save.revision).toBe(1);
    expect(fakeStore.receipts.size).toBe(1);
  });

  it('replays an idempotent command without charging the budget again', () => {
    const { service, saveId } = setup();
    const request = {
      expectedRevision: 0,
      idempotencyKey: 'idempotent-move',
      command: { type: 'MOVE_ZONE', siteId: 'mixed_forest' } as GameCommand
    };
    const first = service.executeCommand('session-1', saveId, request) as CommandResult;
    const second = service.executeCommand('session-1', saveId, request) as CommandResult;
    expect(second.world.revision).toBe(first.world.revision);
    expect(second.event.id).toBe(first.event.id);
    expect(second.world.travelPoints).toBe(3);
  });

  it('migrates legacy saves that lack travel columns without resetting progress', () => {
    const fakeStore = createFakeStore();
    const service = new GameService(fakeStore as unknown as ConstructorParameters<typeof GameService>[0]);
    const saveId = seedWorld(service, fakeStore);
    const row = [...fakeStore.saves.values()][0]!;
    // 模拟旧档：年/季/日已推进到第 2 年冬季第 9 日，行动点剩余 4，新列默认 0。
    Object.assign(row, {
      year: 2,
      season: 'winter',
      day: 9,
      slot: 2,
      action_points: 4,
      revision: 37,
      travel_points: 0,
      travel_limit: 0
    });

    const world = service.getWorld('session-1', saveId);
    expect(world.year).toBe(2);
    expect(world.season).toBe('winter');
    expect(world.day).toBe(9);
    expect(world.actionPoints).toBe(4);
    expect(world.travelLimit).toBe(travelLimitFor('winter'));
    expect(world.travelPoints).toBe(travelLimitFor('winter'));
    // 迁移不消耗 revision。
    const migrated = [...fakeStore.saves.values()][0]!;
    expect(migrated.revision).toBe(37);
  });
});

describe('catalog scaffolding availability for recon', () => {
  it('keeps site and species catalogs populated for the fake-store path', () => {
    expect(SITES.length).toBe(4);
    expect(SPECIES.length).toBeGreaterThan(0);
    const definition: SpeciesDefinition | undefined = SPECIES.find((species) => species.zones.stream_valley);
    expect(definition).toBeDefined();
  });
});

// createSession 需要 db.prepare(...).run，fake store 已覆盖；vi 保持占位以便后续扩展。
void vi;
