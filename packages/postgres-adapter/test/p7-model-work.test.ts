import { describe, expect, it } from 'vitest';
import { foundationMigrations } from '../src/migrations.js';

describe('P7 model-work migration', () => {
  it('appends forward-only migration 8 after the P6 authority schema', () => {
    expect(foundationMigrations.map(({ version }) => version)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    const migration = foundationMigrations.at(-1);
    expect(migration).toMatchObject({
      version: 8,
      name: 'p7_provider_model_work',
    });
    expect(migration?.sql).toContain('create table mammoth_p7_model_work');
    expect(migration?.sql).toContain(
      'references mammoth_p6_topology_budget_settlements(id)',
    );
    expect(migration?.sql).toContain(
      'references mammoth_p6_topology_budget_releases(id)',
    );
    expect(migration?.sql).toContain('P7 cancelled model work cannot complete');
    expect(migration?.sql).toContain('P7 provider predecessor is not terminal');
    expect(migration?.sql).toContain('P7 reconstruction link is incomplete');
    expect(migration?.sql).toContain(
      'P7 model work lacks completion authority',
    );
    expect(migration?.checksum).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('keeps identities immutable while allowing fenced lifecycle revisions', () => {
    const sql = foundationMigrations.at(-1)?.sql ?? '';
    expect(sql).toContain('new.revision <> old.revision + 1');
    expect(sql).toContain(
      'old.authoritative_request is distinct from new.authoritative_request',
    );
    expect(sql).toContain('mammoth_p7_provider_attempt_update_guard');
    expect(sql).toContain('mammoth_p7_forbid_authority_mutation');
  });

  it('binds capability, egress, artifact, charge, and budget rows to authority', () => {
    const sql = foundationMigrations.at(-1)?.sql ?? '';
    for (const marker of [
      'mammoth_p7_capability_guard',
      'mammoth_p7_egress_guard',
      'mammoth_p7_artifact_guard',
      'mammoth_p7_provider_charge_guard',
      'mammoth_p7_budget_settlement_guard',
      'mammoth_p7_budget_release_guard',
      'mammoth_p7_cancellation_guard',
      'mammoth_p7_reconstruction_guard',
    ]) {
      expect(sql).toContain(marker);
    }
  });
});
