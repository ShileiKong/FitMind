import { describe, expect, it, vi } from 'vitest';
import { MiniClient } from '../src/lib/client';
import { LocalClient } from '../src/local/client';
import { LocalCore } from '../src/local/core';
import { platformStore } from './local-fixtures';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function remote(clock: () => Date) {
  const platform = platformStore();
  const core = new LocalCore(platform, clock);
  const transport = async (options: any) => {
    const url = new URL(options.url);
    const path = url.pathname.replace('/api/v1', '') + url.search;
    const data =
      path === '/messages'
        ? []
        : path === '/capabilities'
          ? { text: true, vision: false, transcription: false }
          : await core.request(
              options.method,
              path,
              options.data,
              options.header['Idempotency-Key'],
            );
    return {
      statusCode: 200,
      data: {
        data,
        server_time: clock().toISOString(),
        timezone: core.context().timezone,
        request_id: 'test',
      },
    };
  };
  const request = { handle: transport };
  const client = new MiniClient({
    ...platform,
    request(options: any) {
      Promise.resolve()
        .then(() => request.handle(options))
        .then(options.success, options.fail);
    },
  });
  return { client, core, request, transport };
}

async function water(core: LocalCore, amount_ml: number) {
  return core.request(
    'POST',
    '/records',
    { kind: 'water', amount_ml },
    core.store.id(),
  );
}

async function target(core: LocalCore) {
  const draft = await core.request(
    'POST',
    '/targets/drafts',
    {
      effective_from: '2026-10-11',
      allow_history: true,
      water_ml: 2000,
      calories_kcal: 2200,
      carbs_g: 250,
      protein_g: 150,
      fat_g: 65,
    },
    core.store.id(),
  );
  return core.request(
    'POST',
    '/targets/' + draft.id + '/confirm',
    { expected_version: draft.version },
    core.store.id(),
  );
}

describe('daily client snapshots', () => {
  it.each([
    {
      change: 'natural midnight',
      before: '2026-10-11T15:59:00Z',
      after: '2026-10-11T16:01:00Z',
      date: '2026-10-12',
      timezone: 'Asia/Shanghai',
    },
    {
      change: 'clock rollback',
      before: '2026-10-12T02:00:00Z',
      after: '2026-10-11T02:00:00Z',
      date: '2026-10-11',
      timezone: 'Asia/Shanghai',
    },
    {
      change: 'timezone change on the same date',
      before: '2026-10-11T10:00:00Z',
      after: '2026-10-11T10:00:00Z',
      date: '2026-10-11',
      timezone: 'UTC',
    },
  ])('invalidates cached daily data after $change', async (scenario) => {
    let now = new Date(scenario.before);
    const { client, core } = remote(() => now);
    await client.connect({ base_url: 'https://fit.test', token: 'fixture' });
    await water(core, 500);
    await target(core);
    await client.refresh();
    const originalDate = client.data.context.local_date;
    const originalTargets = structuredClone(client.data.targets);
    expect(client.data.summary.water_ml.known_total).toBe(500);

    now = new Date(scenario.after);
    if (scenario.timezone !== 'Asia/Shanghai')
      await core.request(
        'PATCH',
        '/profile',
        { expected_version: 0, timezone: scenario.timezone },
        core.store.id(),
      );
    await client.time();

    expect(client.data.context).toMatchObject({
      local_date: scenario.date,
      timezone: scenario.timezone,
    });
    expect(client.data.summary).toBeNull();
    expect(client.data.records).toEqual([]);
    expect(client.data.targets).toEqual(originalTargets);
    expect(
      (await core.request('GET', '/days/' + originalDate + '/summary')).water_ml
        .known_total,
    ).toBe(500);
  });

  it('does not let a delayed refresh context restore an older date', async () => {
    let now = new Date('2026-10-11T15:59:00Z');
    const { client, core, request, transport } = remote(() => now);
    await client.connect({ base_url: 'https://fit.test', token: 'fixture' });
    await water(core, 500);
    const oldCheck = deferred<any>();
    const checkStarted = deferred<void>();
    let contextRequests = 0;
    request.handle = async (options: any) => {
      const response = await transport(options);
      if (options.url.endsWith('/context') && ++contextRequests === 2) {
        checkStarted.resolve();
        await oldCheck.promise;
      }
      return response;
    };

    const refreshing = client.refresh();
    await checkStarted.promise;
    now = new Date('2026-10-11T16:01:00Z');
    await client.time();
    expect(client.data.context.local_date).toBe('2026-10-12');
    oldCheck.resolve(undefined);
    await refreshing;

    expect(client.data.context.local_date).toBe('2026-10-12');
    expect(client.data.summary.local_date).toBe('2026-10-12');
    expect(client.data.summary.water_ml.known_total).toBe(0);
    expect(client.data.records).toEqual([]);
  });

  it('loads the current local day before a pending AI reply and keeps history and targets', async () => {
    let now = new Date('2026-10-11T15:59:00Z');
    let modelRequest: any;
    const platform = {
      ...platformStore(),
      request(options: any) {
        modelRequest = options;
        return { abort() {} };
      },
    };
    const client = new LocalClient(platform, () => now);
    await target(client.core);
    await water(client.core, 500);
    await client.refresh();
    const originalTargets = structuredClone(client.data.targets);
    client.agent.saveModel({ api_key: 'fixture-key', model: 'deepseek-flash' });

    now = new Date('2026-10-11T16:01:00Z');
    await water(client.core, 200);
    const sending = client.sendChat('今天还能喝多少水？');
    await vi.waitFor(() => expect(modelRequest).toBeDefined());

    try {
      expect(client.data.context.local_date).toBe('2026-10-12');
      expect(client.data.summary.local_date).toBe('2026-10-12');
      expect(client.data.summary.water_ml).toMatchObject({
        known_total: 200,
        target: 2000,
        remaining: 1800,
      });
      expect(client.data.records).toHaveLength(1);
      expect(client.data.records[0]).toMatchObject({
        kind: 'water',
        amount_ml: 200,
        local_date: '2026-10-12',
      });
      expect(client.data.targets).toEqual(originalTargets);
      expect(client.pending()[0].body).toMatchObject({
        captured_at: '2026-10-11T16:01:00.000Z',
        capture_local_date: '2026-10-12',
        capture_timezone: 'Asia/Shanghai',
      });
      expect(
        (await client.core.request('GET', '/days/2026-10-11/summary')).water_ml
          .known_total,
      ).toBe(500);
    } finally {
      modelRequest.success({
        statusCode: 200,
        data: {
          choices: [
            {
              finish_reason: 'stop',
              message: { role: 'assistant', content: '今天还可喝1800毫升。' },
            },
          ],
        },
      });
      await sending;
    }
  });

  it('refreshes local daily data on the same day before AI work', async () => {
    let modelRequest: any;
    const client = new LocalClient(
      {
        ...platformStore(),
        request(options: any) {
          modelRequest = options;
          return { abort() {} };
        },
      },
      () => new Date('2026-10-11T10:00:00Z'),
    );
    await client.refresh();
    await water(client.core, 300);
    client.agent.saveModel({ api_key: 'fixture-key', model: 'deepseek-flash' });
    const sending = client.sendChat('今天还能喝多少水？');
    await vi.waitFor(() => expect(modelRequest).toBeDefined());
    try {
      expect(client.data.summary.water_ml.known_total).toBe(300);
      expect(client.data.records).toHaveLength(1);
    } finally {
      modelRequest.success({
        statusCode: 200,
        data: {
          choices: [
            {
              finish_reason: 'stop',
              message: { role: 'assistant', content: '已查看今天的饮水。' },
            },
          ],
        },
      });
      await sending;
    }
  });

  it.each([
    {
      change: 'midnight',
      before: '2026-10-11T15:59:00Z',
      after: '2026-10-11T16:01:00Z',
      date: '2026-10-12',
      timezone: 'Asia/Shanghai',
      total: 200,
      count: 1,
    },
    {
      change: 'clock rollback',
      before: '2026-10-12T02:00:00Z',
      after: '2026-10-11T02:00:00Z',
      date: '2026-10-11',
      timezone: 'Asia/Shanghai',
      total: 200,
      count: 1,
    },
    {
      change: 'timezone',
      before: '2026-10-11T10:00:00Z',
      after: '2026-10-11T10:00:00Z',
      date: '2026-10-11',
      timezone: 'UTC',
      total: 700,
      count: 2,
    },
  ])(
    'rechecks local daily reads after $change changes in flight',
    async (scenario) => {
      let now = new Date(scenario.before);
      const client = new LocalClient(platformStore(), () => now);
      await water(client.core, 500);
      await client.refresh();
      const readStarted = deferred<void>();
      const releaseRead = deferred<void>();
      const request = client.request.bind(client);
      let hold = true;
      vi.spyOn(client, 'request').mockImplementation(async (...args) => {
        const result = await request(...args);
        if (hold && args[1].endsWith('/summary')) {
          hold = false;
          readStarted.resolve();
          await releaseRead.promise;
        }
        return result;
      });

      const timing = client.time();
      await readStarted.promise;
      now = new Date(scenario.after);
      if (scenario.timezone !== 'Asia/Shanghai')
        await client.core.request(
          'PATCH',
          '/profile',
          { expected_version: 0, timezone: scenario.timezone },
          client.core.store.id(),
        );
      await water(client.core, 200);
      releaseRead.resolve();
      const context = await timing;

      expect(context).toMatchObject({
        local_date: scenario.date,
        timezone: scenario.timezone,
      });
      expect(client.data.context).toEqual(context);
      expect(client.data.summary.local_date).toBe(scenario.date);
      expect(client.data.summary.water_ml.known_total).toBe(scenario.total);
      expect(client.data.records).toHaveLength(scenario.count);
      expect(
        client.data.records.every(
          (record: any) => record.local_date === scenario.date,
        ),
      ).toBe(true);
    },
  );

  it('retries a lost local chat response after midnight with the original capture and no duplicate record', async () => {
    let now = new Date('2026-10-11T15:59:00Z');
    const client = new LocalClient(platformStore(), () => now);
    const request = client.request.bind(client);
    const bodies: any[] = [];
    let lose = true;
    vi.spyOn(client, 'request').mockImplementation(async (...args) => {
      const result = await request(...args);
      if (args[1] === '/chat') {
        bodies.push(structuredClone(args[2]));
        if (lose) {
          lose = false;
          throw new Error('lost response');
        }
      }
      return result;
    });

    await expect(client.sendChat('喝了300毫升水')).rejects.toThrow(
      'lost response',
    );
    const pending = structuredClone(client.pending()[0]);
    now = new Date('2026-10-11T16:01:00Z');
    await client.time();
    await client.retry(pending.id);

    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[1]).toMatchObject({
      captured_at: '2026-10-11T15:59:00.000Z',
      capture_local_date: '2026-10-11',
      capture_timezone: 'Asia/Shanghai',
    });
    expect(client.pending()).toEqual([]);
    expect(client.data.context.local_date).toBe('2026-10-12');
    expect(client.data.summary.water_ml.known_total).toBe(0);
    const yesterday = await client.core.request(
      'GET',
      '/days/2026-10-11/summary',
    );
    expect(yesterday.water_ml.known_total).toBe(300);
    expect(yesterday.record_count).toBe(1);
  });

  it('keeps the newer local daily snapshot when overlapping same-day reads finish out of order', async () => {
    const client = new LocalClient(
      platformStore(),
      () => new Date('2026-10-11T10:00:00Z'),
    );
    await water(client.core, 500);
    await client.refresh();
    const readStarted = deferred<void>();
    const releaseRead = deferred<void>();
    const request = client.request.bind(client);
    let hold = true;
    vi.spyOn(client, 'request').mockImplementation(async (...args) => {
      const result = await request(...args);
      if (hold && args[1].endsWith('/summary')) {
        hold = false;
        readStarted.resolve();
        await releaseRead.promise;
      }
      return result;
    });

    const earlier = client.time();
    await readStarted.promise;
    await water(client.core, 200);
    const latest = await client.time();
    expect(client.data.summary.water_ml.known_total).toBe(700);
    releaseRead.resolve();
    expect(await earlier).toEqual(latest);

    expect(client.data.summary.water_ml.known_total).toBe(700);
    expect(client.data.records).toHaveLength(2);
    expect(
      (await client.core.request('GET', '/days/2026-10-11/summary')).water_ml
        .known_total,
    ).toBe(700);
  });

  it('keeps a fresher same-day local snapshot when a delayed full refresh completes', async () => {
    const client = new LocalClient(
      platformStore(),
      () => new Date('2026-10-11T10:00:00Z'),
    );
    await water(client.core, 500);
    await client.refresh();
    const readStarted = deferred<void>();
    const releaseRead = deferred<void>();
    const request = client.request.bind(client);
    let summaryReads = 0;
    vi.spyOn(client, 'request').mockImplementation(async (...args) => {
      const result = await request(...args);
      // The first summary belongs to time(); the next is the full refresh read.
      if (args[1].endsWith('/summary') && ++summaryReads === 2) {
        readStarted.resolve();
        await releaseRead.promise;
      }
      return result;
    });

    const refreshing = client.refresh();
    await readStarted.promise;
    await water(client.core, 200);
    await client.time();
    expect(client.data.summary.water_ml.known_total).toBe(700);
    releaseRead.resolve();
    await refreshing;

    expect(client.data.summary.water_ml.known_total).toBe(700);
    expect(client.data.summary.local_date).toBe('2026-10-11');
    expect(client.data.records).toHaveLength(2);
  });

  it.each(['import', 'clear', 'restart'])(
    'blocks %s between a standalone context read and publishing its daily snapshot',
    async (operation) => {
      const client = new LocalClient(
        platformStore(),
        () => new Date('2026-10-11T10:00:00Z'),
      );
      const blank = client.exportBackup();
      await water(client.core, 500);
      await client.refresh();
      const before = client.exportBackup();
      const contextStarted = deferred<void>();
      const releaseContext = deferred<void>();
      const request = client.request.bind(client);
      let hold = true;
      vi.spyOn(client, 'request').mockImplementation(async (...args) => {
        const result = await request(...args);
        if (hold && args[1] === '/context') {
          hold = false;
          contextStarted.resolve();
          await releaseContext.promise;
        }
        return result;
      });

      const timing = client.time();
      await contextStarted.promise;
      try {
        const resetting =
          operation === 'import'
            ? client.importBackup(blank)
            : operation === 'clear'
              ? client.clearLocalData()
              : client.restartOnboarding();
        await expect(resetting).rejects.toMatchObject({ code: 'BUSY' });
        expect(client.exportBackup()).toBe(before);
      } finally {
        releaseContext.resolve();
        await timing;
      }
      expect(client.data.summary.water_ml.known_total).toBe(500);
    },
  );
});
