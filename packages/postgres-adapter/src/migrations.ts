import { createHash } from 'node:crypto';

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
  readonly checksum: string;
}

export interface MigrationInput {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

export function migrationChecksum(input: MigrationInput): string {
  return createHash('sha256')
    .update(`${String(input.version)}\n${input.name}\n${input.sql}`, 'utf8')
    .digest('hex');
}

export function defineMigration(input: MigrationInput): Migration {
  return Object.freeze({ ...input, checksum: migrationChecksum(input) });
}

export const foundationMigrations: readonly Migration[] = Object.freeze([
  defineMigration({
    version: 1,
    name: 'adapter_foundation',
    sql: `
create table mammoth_adapter_metadata (
  singleton boolean primary key default true check (singleton),
  contract_major integer not null check (contract_major > 0),
  created_at timestamptz not null default clock_timestamp()
);
insert into mammoth_adapter_metadata (singleton, contract_major)
values (true, 1);
`.trim(),
  }),
]);
