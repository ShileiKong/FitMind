import { expect, it } from 'vitest';
import { LocalCore } from '../src/local/core';
import { LocalAgent } from '../src/local/agent';
import { platformStore } from './local-fixtures';

const exercise = {
  exercise_id: 'bench',
  name: '卧推',
  variant: '平板',
  equipment: '杠铃',
  load_convention: 'total',
  weight_kg: 40,
  increment_kg: 2.5,
  sets: 2,
  reps_min: 8,
  reps_max: 12,
  rest_seconds: 90,
};
const targets = {
  water_ml: 2000,
  calories_kcal: 1800,
  carbs_g: 200,
  protein_g: 120,
  fat_g: 60,
};
function fixture() {
  let now = new Date('2026-10-11T15:59:00Z');
  const platform = platformStore();
  return {
    platform,
    core: new LocalCore(platform, () => now),
    advance: () => {
      now = new Date('2026-10-11T16:01:00Z');
    },
  };
}

it('recomputes natural day in profile timezone and retries the original record once', async () => {
  const { core, platform, advance } = fixture();
  const first = await core.request(
    'POST',
    '/records',
    { kind: 'water', amount_ml: 350 },
    'drink',
  );
  expect(first.entity.local_date).toBe('2026-10-11');
  advance();
  expect(core.context().local_date).toBe('2026-10-12');
  expect(
    (
      await core.request(
        'POST',
        '/records',
        { kind: 'water', amount_ml: 350 },
        'drink',
      )
    ).entity.id,
  ).toBe(first.entity.id);
  expect(
    (await core.request('GET', '/days/2026-10-12/summary')).water_ml
      .known_total,
  ).toBe(0);
  const restart = new LocalCore(
    platform,
    () => new Date('2026-10-11T16:01:00Z'),
  );
  expect((await restart.request('GET', '/records')).items).toHaveLength(1);
  await core.request(
    'PATCH',
    '/profile',
    { expected_version: 0, timezone: 'UTC' },
    'zone',
  );
  expect(core.context().local_date).toBe('2026-10-11');
});

it('preserves unknown nutrition, history and optimistic record conflicts', async () => {
  const { core } = fixture();
  const food = await core.request(
    'POST',
    '/records',
    {
      kind: 'food',
      name: '米饭',
      source: 'estimate',
      assumptions: '熟米饭150g',
      local_date: '2026-10-09',
      nutrition: {
        calories_kcal: 200,
        carbs_g: null,
        protein_g: 4,
        fat_g: null,
      },
    },
    'food',
  );
  const summary = await core.request('GET', '/days/2026-10-09/summary');
  expect(summary.carbs_g).toMatchObject({
    known_total: 0,
    incomplete: true,
    remaining: null,
  });
  expect(
    (
      await core.request(
        'GET',
        '/records?start_date=2026-10-08&end_date=2026-10-10&kind=food',
      )
    ).items[0].id,
  ).toBe(food.entity.id);
  await core.request(
    'PATCH',
    '/records/' + food.entity.id,
    { expected_version: 1, patch: { note: '补记' } },
    'edit',
  );
  await expect(
    core.request(
      'PATCH',
      '/records/' + food.entity.id,
      { expected_version: 1, patch: { note: '陈旧' } },
      'stale',
    ),
  ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  await expect(
    core.request(
      'POST',
      '/records',
      { kind: 'water', amount_ml: 100, local_date: '2026-02-30' },
      'date',
    ),
  ).rejects.toMatchObject({ code: 'INVALID_DATE' });
  await expect(
    core.request(
      'POST',
      '/records',
      { kind: 'water', amount_ml: 100, extra: 'field' },
      'field',
    ),
  ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
});

it('activates targets only after confirmation and retains earlier budgets', async () => {
  const { core } = fixture();
  const draft = await core.request(
    'POST',
    '/targets/drafts',
    { ...targets, effective_from: '2026-10-11' },
    'target',
  );
  expect(
    (await core.request('GET', '/days/2026-10-11/summary')).water_ml.target,
  ).toBeNull();
  await core.request(
    'POST',
    '/targets/' + draft.id + '/confirm',
    { expected_version: 1 },
    'confirm',
  );
  const future = await core.request(
    'POST',
    '/targets/drafts',
    { ...targets, water_ml: 2500, effective_from: '2026-10-12' },
    'future',
  );
  await core.request(
    'POST',
    '/targets/' + future.id + '/confirm',
    { expected_version: 1 },
    'future-confirm',
  );
  expect(
    (await core.request('GET', '/days/2026-10-11/summary')).water_ml.target,
  ).toBe(2000);
  expect(
    (await core.request('GET', '/days/2026-10-12/summary')).water_ml.target,
  ).toBe(2500);
  await expect(
    core.request(
      'POST',
      '/targets/drafts',
      { ...targets, effective_from: '2026-10-01' },
      'history',
    ),
  ).rejects.toMatchObject({ code: 'HISTORY_CONFIRMATION' });
});

it('confirms a full weekly schedule and preserves actual sets when a plan changes', async () => {
  const { core, platform } = fixture();
  const draft = await core.request(
    'POST',
    '/plans/drafts',
    {
      name: '两周训练',
      weekly: {
        start_date: '2026-10-12',
        end_date: '2026-10-25',
        days: [
          { weekday: 1, name: '上肢', exercises: [exercise] },
          {
            weekday: 4,
            name: '下肢',
            exercises: [{ ...exercise, exercise_id: 'squat', name: '深蹲' }],
          },
        ],
      },
    },
    'plan',
  );
  expect(draft.days.map((d: any) => d.local_date)).toEqual([
    '2026-10-12',
    '2026-10-15',
    '2026-10-19',
    '2026-10-22',
  ]);
  expect(await core.request('GET', '/workout-days')).toHaveLength(0);
  const confirmed = await core.request(
    'POST',
    '/plans/' + draft.id + '/confirm',
    { expected_version: 1 },
    'plan-confirm',
  );
  expect(await core.request('GET', '/workout-days')).toHaveLength(4);
  const session = await core.request(
    'POST',
    '/workout-sessions',
    { workout_day_id: confirmed.days[0].id },
    'start',
  );
  const result = await core.request(
    'POST',
    '/workout-sessions/' + session.id + '/sets',
    { exercise_id: 'bench', reps: 12, weight_kg: 40, difficulty: 'easy' },
    'set',
  );
  expect(result.set.local_date).toBe('2026-10-11');
  expect(
    (await core.request('GET', '/recommendations?session_id=' + session.id))
      .length,
  ).toBeGreaterThan(0);
  await core.request(
    'PATCH',
    '/plans/' + draft.id,
    { expected_version: confirmed.version, patch: { name: '调整训练' } },
    'revise',
  );
  const restarted = new LocalCore(platform);
  const actual = await restarted.request(
    'GET',
    '/workout-sessions/' + session.id,
  );
  expect(actual.snapshot.plan_version).toBe(2);
  expect(actual.sets).toHaveLength(1);
  expect(
    (
      await core.request(
        'GET',
        '/trends?metric=workout&start_date=2026-10-11&end_date=2026-10-11',
      )
    ).points[0],
  ).toMatchObject({ weight_kg: 40, reps: 12 });
});

it('replaces validated backup transactionally without secrets and rejects malformed entities', async () => {
  const { core, platform } = fixture();
  platform.values.set('fitmind.ai.settings', { api_key: 'private-secret' });
  await core.request(
    'POST',
    '/records',
    { kind: 'water', amount_ml: 350 },
    'water',
  );
  const backup = core.exportBackup();
  expect(backup).not.toContain('private-secret');
  expect(core.inspectBackup(backup)).toMatchObject({
    version: 1,
    counts: { record: 1 },
    entity_count: 1,
  });
  await core.request(
    'POST',
    '/records',
    { kind: 'water', amount_ml: 500 },
    'water-2',
  );
  platform.failWrites(true);
  expect(() => core.importBackup(backup)).toThrow(/保存/);
  expect((await core.request('GET', '/records')).items).toHaveLength(2);
  platform.failWrites(false);
  core.importBackup(backup);
  expect(
    (await new LocalCore(platform).request('GET', '/records')).items,
  ).toHaveLength(1);
  const malformed = JSON.parse(backup);
  malformed.entities[0].value.amount_ml = -1;
  expect(() => core.importBackup(JSON.stringify(malformed))).toThrow(/备份/);
  expect(() => core.importBackup('{"version":2,"entities":[]}')).toThrow(
    /版本/,
  );
});

it('forgets a sourced memory and blocks restoring it from the deleted source', async () => {
  const { core } = fixture();
  const input = {
    key: '器械',
    value: '只有哑铃',
    source_message_id: 'original-message',
  };
  const memory = await core.request('POST', '/memories', input, 'remember');
  expect(await core.request('GET', '/memories')).toHaveLength(1);
  await core.request(
    'PATCH',
    '/memories/' + memory.id,
    { expected_version: 1, value: '哑铃和长凳' },
    'revise-memory',
  );
  await core.request(
    'POST',
    '/memories/' + memory.id + '/forget',
    { expected_version: 2 },
    'forget',
  );
  expect(await core.request('GET', '/memories')).toHaveLength(0);
  await expect(
    core.request('POST', '/memories', input, 'restore'),
  ).rejects.toMatchObject({ code: 'DELETED_SOURCE' });
});

it('rejects backups with missing record metadata or broken workout references', async () => {
  const { core } = fixture();
  await core.request(
    'POST',
    '/records',
    { kind: 'water', amount_ml: 350 },
    'water',
  );
  const backup = JSON.parse(core.exportBackup());
  delete backup.entities[0].value.local_date;
  expect(() => core.inspectBackup(JSON.stringify(backup))).toThrow(/备份/);
  const draft = await core.request(
    'POST',
    '/plans/drafts',
    {
      name: '训练',
      days: [{ local_date: '2026-10-11', name: '上肢', exercises: [exercise] }],
    },
    'plan',
  );
  await core.request(
    'POST',
    '/plans/' + draft.id + '/confirm',
    { expected_version: 1 },
    'confirm',
  );
  const broken = JSON.parse(core.exportBackup());
  broken.entities = broken.entities.filter(
    (row: any) => row.kind !== 'workout_day',
  );
  expect(() => core.importBackup(JSON.stringify(broken))).toThrow(/备份/);
  expect(await core.request('GET', '/workout-days')).toHaveLength(1);
});

async function backupWithAgentAndWorkout() {
  const fixtureValue = fixture();
  const { core, platform } = fixtureValue;
  const draft = await core.request(
    'POST',
    '/plans/drafts',
    {
      name: '训练',
      days: [{ local_date: '2026-10-11', name: '上肢', exercises: [exercise] }],
    },
    'plan',
  );
  const plan = await core.request(
    'POST',
    '/plans/' + draft.id + '/confirm',
    { expected_version: 1 },
    'confirm',
  );
  const session = await core.request(
    'POST',
    '/workout-sessions',
    { workout_day_id: plan.days[0].id },
    'start',
  );
  await core.request(
    'POST',
    '/workout-sessions/' + session.id + '/sets',
    { exercise_id: 'bench', reps: 10, weight_kg: 40 },
    'set',
  );
  const agent = new LocalAgent(
    core,
    platform,
    () => new Date('2026-10-11T15:59:00Z'),
  );
  await agent.run({
    message_id: 'message',
    conversation_id: 'main',
    text: '喝了300ml水',
  });
  return { ...fixtureValue, agent, backup: JSON.parse(core.exportBackup()) };
}
const invalidBackupCases: [string, (backup: any) => void][] = [
  [
    'record with numeric display timestamp',
    (backup) => {
      backup.entities.find(
        (row: any) => row.kind === 'record',
      ).value.recorded_at = 123;
    },
  ],
  [
    'plan with malformed display period',
    (backup) => {
      backup.entities.find((row: any) => row.kind === 'plan').value.period = {
        start_date: 123,
        end_date: '2026-10-11',
      };
    },
  ],
  [
    'message without request',
    (backup) => {
      const row = backup.entities.find((row: any) => row.kind === 'message');
      row.value = { id: row.value.id, version: 1 };
    },
  ],
  [
    'message request belonging to another id',
    (backup) => {
      backup.entities.find(
        (row: any) => row.kind === 'message',
      ).value.request.message_id = 'another';
    },
  ],
  [
    'message with unsupported future status',
    (backup) => {
      backup.entities.find((row: any) => row.kind === 'message').value.status =
        'future';
    },
  ],
  [
    'message with invalid frozen date',
    (backup) => {
      backup.entities.find(
        (row: any) => row.kind === 'message',
      ).value.ctx.reference_local_date = '2026-02-30';
    },
  ],
  [
    'message with invalid frozen timezone',
    (backup) => {
      backup.entities.find(
        (row: any) => row.kind === 'message',
      ).value.ctx.timezone = 'Mars/Unknown';
    },
  ],
  [
    'message with invalid frozen time',
    (backup) => {
      backup.entities.find(
        (row: any) => row.kind === 'message',
      ).value.ctx.now_utc = 'invalid';
    },
  ],
  [
    'message with nonexistent frozen calendar day',
    (backup) => {
      backup.entities.find(
        (row: any) => row.kind === 'message',
      ).value.ctx.now_utc = '2026-02-30T10:00:00Z';
    },
  ],
  [
    'message with invalid transcript',
    (backup) => {
      backup.entities.find(
        (row: any) => row.kind === 'message',
      ).value.transcript = {};
    },
  ],
  [
    'message with invalid prior snapshot',
    (backup) => {
      backup.entities.find(
        (row: any) => row.kind === 'message',
      ).value.prior_snapshot = [{}];
    },
  ],
  [
    'message with invalid result arrays',
    (backup) => {
      backup.entities.find(
        (row: any) => row.kind === 'message',
      ).value.result.record_receipts = {};
    },
  ],
  [
    'pending message with invalid tool call',
    (backup) => {
      const message = backup.entities.find(
        (row: any) => row.kind === 'message',
      ).value;
      message.status = 'pending';
      message.result = null;
      message.pending = {
        assistant_text: '',
        tool_calls: [
          { name: 'record_water', call_id: 'tool', arguments: 'invalid' },
        ],
      };
    },
  ],
  [
    'orphan set',
    (backup) => {
      backup.entities.find((row: any) => row.kind === 'set').value.session_id =
        'nonexistent';
    },
  ],
  [
    'set with inconsistent occurrence day',
    (backup) => {
      backup.entities.find((row: any) => row.kind === 'set').value.local_date =
        '2026-10-09';
    },
  ],
  [
    'session with another snapshot day id',
    (backup) => {
      backup.entities.find(
        (row: any) => row.kind === 'session',
      ).value.snapshot.id = 'different-day';
    },
  ],
  [
    'session with missing current exercise',
    (backup) => {
      backup.entities.find(
        (row: any) => row.kind === 'session',
      ).value.current_exercise_id = 'missing';
    },
  ],
  [
    'tool command without result',
    (backup) => {
      delete backup.entities.find((row: any) => row.kind === 'command').value
        .result;
    },
  ],
  [
    'tool command referencing missing message',
    (backup) => {
      backup.entities.find(
        (row: any) => row.kind === 'command',
      ).value.message_id = 'missing';
    },
  ],
  [
    'recommendation missing basis array',
    (backup) => {
      delete backup.entities.find((row: any) => row.kind === 'recommendation')
        .value.basis;
    },
  ],
  [
    'recommendation with unsupported future status',
    (backup) => {
      backup.entities.find(
        (row: any) => row.kind === 'recommendation',
      ).value.status = 'future';
    },
  ],
  [
    'entity from another user',
    (backup) => {
      backup.entities.find((row: any) => row.kind === 'record').user_id =
        'other-user';
    },
  ],
  [
    'operation from another user',
    (backup) => {
      backup.operations[0].user_id = 'other-user';
    },
  ],
];
it.each(invalidBackupCases)(
  'rejects %s before writing storage or changing cache epoch',
  async (_name, corrupt) => {
    const { core, platform, backup } = await backupWithAgentAndWorkout();
    const before = JSON.stringify([...platform.values]);
    const epoch = core.store.cacheEpoch;
    corrupt(backup);
    expect(() => core.inspectBackup(JSON.stringify(backup))).toThrow(/备份/);
    expect(() => core.importBackup(JSON.stringify(backup))).toThrow(/备份/);
    expect(core.store.cacheEpoch).toBe(epoch);
    expect(JSON.stringify([...platform.values])).toBe(before);
  },
);
it('round trips agent messages, atomic tool journals and recommendations', async () => {
  const { core, platform } = await backupWithAgentAndWorkout();
  const backup = core.exportBackup();
  expect(core.inspectBackup(backup).counts).toMatchObject({
    message: 1,
    command: 1,
    recommendation: 1,
  });
  core.importBackup(backup);
  const restarted = new LocalCore(platform);
  const agent = new LocalAgent(restarted, platform);
  expect(agent.messages()[0]).toMatchObject({
    message_id: 'message',
    text: '喝了300ml水',
    status: 'completed',
  });
  expect((await agent.recover('message')).record_receipts).toHaveLength(1);
  expect((await restarted.request('GET', '/records')).items).toHaveLength(1);
});

it('rejects label backups whose stored totals differ from the label calculation', async () => {
  const { core, platform } = fixture();
  const nutrition = {
    calories_kcal: 200,
    carbs_g: 30,
    protein_g: null,
    fat_g: 5,
  };
  await core.request(
    'POST',
    '/records',
    {
      kind: 'food',
      name: '标签食物',
      source: 'label',
      nutrition,
      label: {
        basis_quantity: 100,
        basis_unit: 'g',
        consumed_quantity: 150,
        consumed_unit: 'g',
        nutrition_per_basis: nutrition,
      },
    },
    'label',
  );
  const backup = JSON.parse(core.exportBackup());
  expect(backup.entities[0].value.nutrition.calories_kcal).toBe(300);
  const before = JSON.stringify([...platform.values]);
  backup.entities[0].value.nutrition.calories_kcal = 9000;
  expect(() => core.importBackup(JSON.stringify(backup))).toThrow(/备份/);
  expect(JSON.stringify([...platform.values])).toBe(before);
  expect(
    (await core.request('GET', '/days/2026-10-11/summary')).calories_kcal
      .known_total,
  ).toBe(300);
});

it('imports an interrupted message and recovers its already committed tool without replay', async () => {
  const { core, platform, backup } = await backupWithAgentAndWorkout();
  const message = backup.entities.find(
    (row: any) => row.kind === 'message',
  ).value;
  const command = backup.entities.find(
    (row: any) => row.kind === 'command',
  ).value;
  Object.assign(message, {
    status: 'running',
    result: null,
    round: 0,
    transcript: [{ role: 'user', content: message.request.text }],
    pending: { assistant_text: '', tool_calls: [JSON.parse(command.payload)] },
  });
  core.importBackup(JSON.stringify(backup));
  const restarted = new LocalCore(platform);
  const result = await new LocalAgent(restarted, platform).recover(message.id);
  expect(result.status).toBe('completed');
  expect(result.record_receipts).toHaveLength(1);
  expect((await restarted.request('GET', '/records')).items).toHaveLength(1);
});

it('imports historical workout snapshots after a plan revision and date correction with undone sets', async () => {
  const { core } = await backupWithAgentAndWorkout();
  const plan = (await core.request('GET', '/plans'))[0];
  await core.request(
    'PATCH',
    '/plans/' + plan.id,
    { expected_version: plan.version, patch: { name: '调整后计划' } },
    'revise',
  );
  const session = (await core.request('GET', '/workout-sessions'))[0];
  await core.request(
    'POST',
    '/workout-sets/' + session.sets[0].id + '/undo',
    { expected_version: 1 },
    'undo',
  );
  await core.request(
    'POST',
    '/workout-sessions/' + session.id + '/transition',
    {
      expected_version: session.version,
      action: 'change_date',
      local_date: '2026-10-09',
    },
    'date',
  );
  const backup = core.exportBackup();
  expect(() => core.importBackup(backup)).not.toThrow();
  const actual = await core.request('GET', '/workout-sessions/' + session.id);
  expect(actual.local_date).toBe('2026-10-09');
  expect(actual.snapshot.plan_version).toBe(2);
  expect(actual.sets).toHaveLength(0);
});
