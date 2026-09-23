import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { GameCommand, Season, WorldSnapshot } from '@shanhai/contracts';
import { createApp } from '../src/app.ts';

describe('closed-loop API', () => {
  let app: ReturnType<typeof createApp>['app'];
  let store: ReturnType<typeof createApp>['store'];
  let agent: ReturnType<typeof request.agent>;

  beforeAll(() => {
    const created = createApp({ databasePath: ':memory:', loggerEnabled: false });
    app = created.app;
    store = created.store;
    agent = request.agent(app);
  });

  afterAll(() => store.close());

  it('accepts configured browser origins and rejects unknown origins', async () => {
    await request(app)
      .post('/api/save')
      .set('Origin', 'http://127.0.0.1:5173')
      .expect(201);
    await request(app)
      .post('/api/save')
      .set('Origin', 'https://attacker.example')
      .expect(403);
  });

  it('returns a client error for malformed JSON', async () => {
    await request(app)
      .post('/api/save/import')
      .set('Content-Type', 'application/json')
      .send('{"token":')
      .expect(400)
      .expect((response) => {
        expect(response.body.code).toBe('INVALID_JSON');
      });
  });

  it('creates, observes, samples, evolves and continues into the next year', async () => {
    const createResponse = await agent.post('/api/save').expect(201);
    let world = createResponse.body as WorldSnapshot;
    expect(world.year).toBe(1);
    expect(world.season).toBe('spring');
    expect(world.sites.length).toBe(4);
    const baseline = store.db
      .prepare('SELECT year_start_species_json FROM saves WHERE id = ?')
      .get(world.saveId) as unknown as { year_start_species_json: string };
    expect(JSON.parse(baseline.year_start_species_json).length).toBeGreaterThan(0);

    world = await command(agent, world, {
      type: 'OBSERVE_PLANT',
      speciesId: 'prunus-davidiana',
      values: {
        phenology: 'leafing',
        leafTexture: 'smooth',
        dominantColor: '#557a45',
        temperatureC: 16,
        humidity: 60,
        soilMoisture: 50,
        lightLux: 30000,
        note: '自动化闭环观察'
      }
    });
    expect(world.recentEvents[0]?.type).toBe('OBSERVE_PLANT');

    const beforeSample = world.sites
      .flatMap((site) => site.species)
      .find((species) => species.id === 'prunus-davidiana')!;
    world = await command(agent, world, {
      type: 'TAKE_SAMPLE',
      speciesId: 'prunus-davidiana',
      method: 'litter'
    });
    const afterSample = world.sites
      .flatMap((site) => site.species)
      .find((species) => species.id === 'prunus-davidiana')!;
    expect(afterSample.health).toBeLessThan(beforeSample.health);
    expect(world.recentEvents[0]?.message).toContain('不符合采集协议');

    const requestBody = {
      expectedRevision: world.revision,
      idempotencyKey: 'idempotency-test-key-001',
      command: { type: 'WAIT' as const }
    };
    const first = await agent.post(`/api/save/${world.saveId}/commands`).send(requestBody).expect(200);
    const second = await agent.post(`/api/save/${world.saveId}/commands`).send(requestBody).expect(200);
    expect(second.body.world.revision).toBe(first.body.world.revision);
    expect(second.body.event.id).toBe(first.body.event.id);
    world = first.body.world as WorldSnapshot;

    for (const season of ['spring', 'summer', 'autumn', 'winter'] as Season[]) {
      expect(world.season).toBe(season);
      world = await advanceToDayEight(agent, world);
      world = await command(agent, world, { type: 'END_SEASON' });
      if (season !== 'winter') {
        expect(world.phase).toBe('season_review');
        world = await command(agent, world, { type: 'BEGIN_NEXT_SEASON' });
      }
    }

    expect(world.phase).toBe('year_review');
    expect(world.annualReview?.year).toBe(1);
    expect(world.annualReview?.incorrectSamples).toBeGreaterThan(0);
    expect(world.annualReview?.speciesChanges.length).toBeGreaterThan(0);
    expect(world.annualReview?.speciesChanges.some((item) => item.populationChangePercent === 100)).toBe(false);
    expect(world.annualReview?.populationChangePercent).not.toBe(100);
    expect(world.annualReview?.speciesChanges.every((item) => Number.isFinite(item.populationChangePercent))).toBe(true);
    expect(world.annualReview?.speciesChanges.every((item) => Number.isFinite(item.healthChange))).toBe(true);

    world = await command(agent, world, { type: 'BEGIN_NEXT_YEAR' });
    expect(world.year).toBe(2);
    expect(world.season).toBe('spring');
    expect(world.phase).toBe('active');

    const journal = await agent.get(`/api/save/${world.saveId}/journal`).expect(200);
    expect(journal.body.entries.length).toBeGreaterThan(0);
    expect(journal.body.entries.find((entry: { kind: string }) => entry.kind === 'sample').slot).toBeGreaterThan(0);
    const historyCount = store.db
      .prepare('SELECT COUNT(*) AS count FROM environment_history WHERE save_id = ?')
      .get(world.saveId) as unknown as { count: number };
    expect(Number(historyCount.count)).toBeGreaterThan(0);
    const report = await agent.get(`/api/save/${world.saveId}/report/1`).expect(200);
    expect(report.body.year).toBe(1);

    const firstExport = await agent.post(`/api/save/${world.saveId}/export`).expect(200);
    expect(firstExport.body.token).toHaveLength(43);
    const latestExport = await agent.post(`/api/save/${world.saveId}/export`).expect(200);
    await agent.post('/api/save/import').send({ token: firstExport.body.token }).expect(400);
    const imported = await agent.post('/api/save/import').send({ token: latestExport.body.token }).expect(200);
    expect(imported.body.saveId).toBe(world.saveId);
    expect(imported.body.year).toBe(2);
    expect(store.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  }, 30_000);
});

async function command(
  agent: ReturnType<typeof request.agent>,
  world: WorldSnapshot,
  commandBody: GameCommand
): Promise<WorldSnapshot> {
  const response = await agent
    .post(`/api/save/${world.saveId}/commands`)
    .send({
      expectedRevision: world.revision,
      idempotencyKey: `test-${world.revision}-${commandBody.type}-${Math.random().toString(16).slice(2)}`,
      command: commandBody
    });
  if (response.status !== 200) {
    throw new Error(
      `${commandBody.type} failed at year ${world.year} ${world.season} day ${world.day}: ${response.status} ${JSON.stringify(response.body)}`
    );
  }
  return response.body.world as WorldSnapshot;
}

async function advanceToDayEight(
  agent: ReturnType<typeof request.agent>,
  initialWorld: WorldSnapshot
): Promise<WorldSnapshot> {
  let world = initialWorld;
  let guard = 0;
  while (world.day < 8) {
    world = await command(agent, world, { type: 'WAIT' });
    guard += 1;
    if (guard > 40) {
      throw new Error('Unable to advance to day 8');
    }
  }
  return world;
}

describe('shared seasonal action budget', () => {
  let app: ReturnType<typeof createApp>['app'];
  let store: ReturnType<typeof createApp>['store'];

  beforeAll(() => {
    const created = createApp({ databasePath: ':memory:', loggerEnabled: false });
    app = created.app;
    store = created.store;
  });

  afterAll(() => store.close());

  const newAgent = () => request.agent(app);

  it('charges one shared pool for move, wait and cross-zone exploration', async () => {
    const agent = newAgent();
    const createResponse = await agent.post('/api/save').expect(201);
    let world = createResponse.body as WorldSnapshot;
    expect(world.actionPoints).toBe(30);
    expect(world.actionBudget).toBe(30);
    expect(world.actionBudgetSpent).toBe(0);

    // 山麓 -> 针阔混交林（相邻）：1 AP
    world = await command(agent, world, { type: 'MOVE_ZONE', siteId: 'mixed_forest' });
    expect(world.actionPoints).toBe(29);
    expect(world.actionBudgetSpent).toBe(1);
    expect(world.currentSiteId).toBe('mixed_forest');

    // 勘察不相邻的山麓林缘：moveCost 1（混交林与山麓相邻）+1 = 2 AP，且不移动位置
    world = await command(agent, world, { type: 'EXPLORE_ZONE', siteId: 'foothill' });
    expect(world.actionPoints).toBe(27);
    expect(world.actionBudgetSpent).toBe(3);
    expect(world.currentSiteId).toBe('mixed_forest');
    expect(world.recentEvents[0]?.type).toBe('EXPLORE_ZONE');
    expect(world.recentEvents[0]?.effects.some((effect: string) => effect.includes('可见对象'))).toBe(true);

    // 跨区域移动 混交林 -> 溪谷湿地（相邻）：1 AP；再 溪谷 -> 山麓（不相邻）：2 AP
    world = await command(agent, world, { type: 'MOVE_ZONE', siteId: 'stream_valley' });
    expect(world.actionPoints).toBe(26);
    world = await command(agent, world, { type: 'MOVE_ZONE', siteId: 'foothill' });
    expect(world.actionPoints).toBe(24);
    expect(world.actionBudgetSpent).toBe(6);
  });

  it('refuses to scout the current zone without spending any budget', async () => {
    const agent = newAgent();
    const createResponse = await agent.post('/api/save').expect(201);
    const world = createResponse.body as WorldSnapshot;
    const beforeRevision = world.revision;

    const response = await agent
      .post(`/api/save/${world.saveId}/commands`)
      .send({
        expectedRevision: world.revision,
        idempotencyKey: `explore-self-${Math.random().toString(16).slice(2)}`,
        command: { type: 'EXPLORE_ZONE', siteId: 'foothill' }
      })
      .expect(409);
    expect(response.body.code).toBe('ACTION_NOT_ALLOWED');

    const refreshed = await agent.get(`/api/save/${world.saveId}/world`).expect(200);
    expect(refreshed.body.actionPoints).toBe(30);
    expect(refreshed.body.revision).toBe(beforeRevision);
    expect(refreshed.body.currentSiteId).toBe('foothill');
  });

  it('rolls back without double-deduction when a command fails after validation', async () => {
    const agent = newAgent();
    const createResponse = await agent.post('/api/save').expect(201);
    const world = createResponse.body as WorldSnapshot;

    // 移动到不存在的区域：400，预算与版本不变
    const invalid = await agent
      .post(`/api/save/${world.saveId}/commands`)
      .send({
        expectedRevision: world.revision,
        idempotencyKey: 'invalid-move-zone-001',
        command: { type: 'MOVE_ZONE', siteId: 'foothill' }
      })
      .expect(409);
    expect(invalid.body.code).toBe('ACTION_NOT_ALLOWED');
    const afterInvalid = await agent.get(`/api/save/${world.saveId}/world`).expect(200);
    expect(afterInvalid.body.actionPoints).toBe(30);

    // 耗尽预算后再等待：失败必须回滚，不能出现负数或重扣
    let drained = world;
    for (let index = 0; index < 30; index += 1) {
      drained = await command(agent, drained, { type: 'WAIT' });
    }
    expect(drained.actionPoints).toBe(0);
    expect(drained.day).toBe(10);
    const overBudget = await agent
      .post(`/api/save/${drained.saveId}/commands`)
      .send({
        expectedRevision: drained.revision,
        idempotencyKey: 'wait-after-budget-001',
        command: { type: 'WAIT' }
      })
      .expect(409);
    expect(overBudget.body.code).toBe('NO_ACTION_POINTS');
    expect(overBudget.body.details.remaining).toBe(0);
    const afterFailure = await agent.get(`/api/save/${drained.saveId}/world`).expect(200);
    expect(afterFailure.body.actionPoints).toBe(0);
    expect(afterFailure.body.revision).toBe(drained.revision);
  });

  it('resolves concurrent commands with optimistic revision conflicts, charging the budget only once', async () => {
    const agent = newAgent();
    const createResponse = await agent.post('/api/save').expect(201);
    const world = createResponse.body as WorldSnapshot;
    const idempotencyKey = `concurrent-${Math.random().toString(16).slice(2)}`;

    const [first, second] = await Promise.all([
      agent
        .post(`/api/save/${world.saveId}/commands`)
        .send({ expectedRevision: world.revision, idempotencyKey: `${idempotencyKey}-a`, command: { type: 'WAIT' } }),
      agent
        .post(`/api/save/${world.saveId}/commands`)
        .send({ expectedRevision: world.revision, idempotencyKey: `${idempotencyKey}-b`, command: { type: 'WAIT' } })
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);
    const conflict = first.status === 409 ? first : second;
    expect(conflict.body.code).toBe('REVISION_CONFLICT');

    const refreshed = await agent.get(`/api/save/${world.saveId}/world`).expect(200);
    expect(refreshed.body.revision).toBe(world.revision + 1);
    expect(refreshed.body.actionPoints).toBe(29);
    expect(refreshed.body.actionBudgetSpent).toBe(1);
  });

  it('replays an idempotent retry without deducting the budget twice', async () => {
    const agent = newAgent();
    const createResponse = await agent.post('/api/save').expect(201);
    const world = createResponse.body as WorldSnapshot;
    const body = {
      expectedRevision: world.revision,
      idempotencyKey: 'idempotent-explore-001',
      command: { type: 'EXPLORE_ZONE', siteId: 'mixed_forest' } as const
    };
    const first = await agent.post(`/api/save/${world.saveId}/commands`).send(body).expect(200);
    const second = await agent.post(`/api/save/${world.saveId}/commands`).send(body).expect(200);
    expect(first.body.event.id).toBe(second.body.event.id);
    expect(second.body.world.actionPoints).toBe(28);
    expect(second.body.world.revision).toBe(first.body.world.revision);
  });

  it('applies the winter ridge surcharge to move and exploration costs', async () => {
    const agent = newAgent();
    const createResponse = await agent.post('/api/save').expect(201);
    let world = createResponse.body as WorldSnapshot;
    for (const season of ['spring', 'summer', 'autumn'] as const) {
      world = await advanceToDayEight(agent, world);
      world = await command(agent, world, { type: 'END_SEASON' });
      world = await command(agent, world, { type: 'BEGIN_NEXT_SEASON' });
      expect(world.actionPoints).toBe(30);
      expect(world.actionBudget).toBe(30);
    }
    world = await advanceToDayEight(agent, world);
    world = await command(agent, world, { type: 'END_SEASON' });
    world = await command(agent, world, { type: 'BEGIN_NEXT_YEAR' });
    expect(world.season).toBe('spring');

    // 直接把存档推进到冬季，验证山脊冬季加价
    store.db
      .prepare("UPDATE saves SET season = 'winter', action_points = 30, season_budget = 30, day = 1, slot = 1, phase = 'active' WHERE id = ?")
      .run(world.saveId);
    let winter = (await agent.get(`/api/save/${world.saveId}/world`).expect(200)).body as WorldSnapshot;
    expect(winter.currentSiteId).toBe('foothill');

    // 山麓 -> 山脊：冬季 +1，共 2 AP
    winter = await command(agent, winter, { type: 'MOVE_ZONE', siteId: 'ridge' });
    expect(winter.actionPoints).toBe(28);

    // 在山脊勘察溪谷（相邻，move 冬季 2 AP）：探索共 3 AP
    winter = await command(agent, winter, { type: 'EXPLORE_ZONE', siteId: 'stream_valley' });
    expect(winter.actionPoints).toBe(25);
    expect(winter.currentSiteId).toBe('ridge');
  });
});
