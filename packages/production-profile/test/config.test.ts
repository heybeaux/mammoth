import { describe, expect, it } from 'vitest';
import { ProfileConfigError, loadProfileConfig } from '../src/config.js';

describe('production profile configuration', () => {
  it('fails closed without a credential', () => {
    expect(() => loadProfileConfig({})).toThrow(ProfileConfigError);
    expect(() => loadProfileConfig({})).toThrow(
      'MAMMOTH_PG_PASSWORD is required',
    );
  });

  it('rejects weak credentials and invalid bounds', () => {
    expect(() => loadProfileConfig({ MAMMOTH_PG_PASSWORD: 'short' })).toThrow(
      'at least 12',
    );
    expect(() =>
      loadProfileConfig({
        MAMMOTH_PG_PASSWORD: 'long-enough-secret',
        MAMMOTH_PG_PORT: '80',
      }),
    ).toThrow('MAMMOTH_PG_PORT');
  });

  it('loads explicit production-like settings', () => {
    const config = loadProfileConfig({
      MAMMOTH_PG_PASSWORD: 'long-enough-secret',
      MAMMOTH_PG_PORT: '55433',
      MAMMOTH_PROFILE_ROOT: '/tmp/mammoth-profile',
    });
    expect(config.port).toBe(55433);
    expect(config.root).toBe('/tmp/mammoth-profile');
    expect(config.password).toBe('long-enough-secret');
  });
});
