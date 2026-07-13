import { describe, expect, it, vi } from 'vitest';
import {
  ProductionProfile,
  ProductionProfileNotReadyError,
  type ProfilePostgresService,
  type ProfileTemporalService,
} from '../src/profile.js';
import type { TemporalReadiness } from '@mammoth/temporal-adapter';

class FakePostgres implements ProfilePostgresService {
  readyValue = false;

  constructor(private readonly events: string[]) {}

  start(): Promise<void> {
    this.events.push('postgres:start');
    this.readyValue = true;
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.events.push('postgres:stop');
    this.readyValue = false;
    return Promise.resolve();
  }

  kill(): Promise<void> {
    this.events.push('postgres:kill');
    this.readyValue = false;
    return Promise.resolve();
  }

  ready(): Promise<boolean> {
    this.events.push('postgres:ready');
    return Promise.resolve(this.readyValue);
  }
}

class FakeTemporal implements ProfileTemporalService {
  constructor(
    private readonly events: string[],
    private readonly failures: { start?: Error; stop?: Error } = {},
  ) {}

  start(): Promise<void> {
    this.events.push('temporal:start');
    return this.failures.start
      ? Promise.reject(this.failures.start)
      : Promise.resolve();
  }

  stop(): Promise<void> {
    this.events.push('temporal:stop');
    return this.failures.stop
      ? Promise.reject(this.failures.stop)
      : Promise.resolve();
  }
}

describe('combined production profile composition', () => {
  it('rolls Postgres back when the Temporal CLI/service cannot start', async () => {
    const events: string[] = [];
    const profile = fixture(events, ready(), {
      start: new Error('temporal CLI missing'),
    });

    await expect(profile.bootstrap()).rejects.toThrow('temporal CLI missing');
    expect(events).toEqual([
      'postgres:start',
      'temporal:start',
      'temporal:stop',
      'postgres:stop',
    ]);
  });

  it.each([
    ['service', ['service-unavailable']],
    ['namespace', ['namespace-unavailable']],
    ['worker', ['worker-incompatible']],
  ])(
    'fails closed when the Temporal %s is unready',
    async (_label, failures) => {
      const events: string[] = [];
      const profile = fixture(events, unready(failures));

      await profile.bootstrap();
      const status = await profile.status();
      expect(status).toMatchObject({
        ready: false,
        postgres: { ready: true },
        temporal: { ready: false, failures },
      });
      await expect(profile.assertReady()).rejects.toBeInstanceOf(
        ProductionProfileNotReadyError,
      );
    },
  );

  it('reports ready only for Postgres plus namespace and compatible worker', async () => {
    const events: string[] = [];
    const profile = fixture(events, ready());

    await expect(profile.start()).resolves.toMatchObject({
      ready: true,
      postgres: { ready: true },
      temporal: { ready: true, failures: [] },
    });
    expect(events).toEqual([
      'postgres:start',
      'temporal:start',
      'postgres:ready',
    ]);
  });

  it('stops Temporal before Postgres and makes repeated stop harmless', async () => {
    const events: string[] = [];
    const profile = fixture(events, ready());
    await profile.bootstrap();
    events.length = 0;

    await profile.stop();
    await profile.stop();

    expect(events).toEqual([
      'temporal:stop',
      'postgres:stop',
      'temporal:stop',
      'postgres:stop',
    ]);
  });

  it('bounds the Temporal stop before the Postgres crash boundary', async () => {
    const events: string[] = [];
    const profile = fixture(events, ready());
    await profile.bootstrap();
    events.length = 0;

    await profile.kill();

    expect(events).toEqual(['temporal:stop', 'postgres:kill']);
  });

  it('leaves Postgres running when bounded Temporal shutdown fails', async () => {
    const events: string[] = [];
    const profile = fixture(events, ready(), {
      stop: new Error('Temporal shutdown exceeded 30ms'),
    });
    await profile.bootstrap();
    events.length = 0;

    await expect(profile.stop()).rejects.toThrow(
      'Temporal shutdown exceeded 30ms',
    );

    expect(events).toEqual(['temporal:stop']);
  });

  it('does not execute or print verification evidence while unready', async () => {
    const events: string[] = [];
    const operation = vi.fn(() => Promise.resolve('evidence'));
    const profile = fixture(events, unready(['worker-incompatible']));

    await expect(profile.runVerified(operation)).rejects.toBeInstanceOf(
      ProductionProfileNotReadyError,
    );
    expect(operation).not.toHaveBeenCalled();
    expect(events.slice(-2)).toEqual(['temporal:stop', 'postgres:stop']);
  });
});

function fixture(
  events: string[],
  readiness: TemporalReadiness,
  temporalFailures: { start?: Error; stop?: Error } = {},
): ProductionProfile {
  return new ProductionProfile({
    postgres: new FakePostgres(events),
    temporal: new FakeTemporal(events, temporalFailures),
    temporalReadiness: () => Promise.resolve(readiness),
  });
}

function ready(): TemporalReadiness {
  return {
    ready: true,
    checkedAt: '2026-07-13T00:00:00.000Z',
    failures: [],
  };
}

function unready(failures: readonly string[]): TemporalReadiness {
  return {
    ready: false,
    checkedAt: '2026-07-13T00:00:00.000Z',
    failures: failures as TemporalReadiness['failures'],
  };
}
