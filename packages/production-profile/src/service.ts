import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProfileConfig } from './config.js';
import { run } from './commands.js';
import { postgresTool } from './tools.js';

export class NativePostgresService {
  readonly #data: string;
  readonly #log: string;
  readonly #passwordFile: string;
  readonly #socket: string;

  constructor(readonly config: ProfileConfig) {
    this.#data = join(config.root, 'postgres');
    this.#log = join(config.root, 'postgres.log');
    this.#passwordFile = join(config.root, '.pg-password');
    this.#socket = join(config.root, 'socket');
  }

  async initialize(): Promise<void> {
    if (
      await readFile(join(this.#data, 'PG_VERSION'), 'utf8').then(
        () => true,
        () => false,
      )
    )
      return;
    await mkdir(this.config.root, { recursive: true, mode: 0o700 });
    await writeFile(this.#passwordFile, `${this.config.password}\n`, {
      mode: 0o600,
    });
    const initdb = await postgresTool('initdb');
    try {
      await run(
        initdb,
        [
          '-D',
          this.#data,
          '--username',
          this.config.user,
          '--pwfile',
          this.#passwordFile,
          '--auth-local=scram-sha-256',
          '--auth-host=scram-sha-256',
          '--encoding=UTF8',
          '--no-locale',
        ],
        { timeoutMs: this.config.startupTimeoutMs },
      );
    } finally {
      await rm(this.#passwordFile, { force: true });
    }
  }

  async start(): Promise<void> {
    await this.initialize();
    await mkdir(this.#socket, { recursive: true, mode: 0o700 });
    if (await this.ready()) return;
    const pgCtl = await postgresTool('pg_ctl');
    try {
      await run(
        pgCtl,
        [
          '-D',
          this.#data,
          '-l',
          this.#log,
          '-w',
          '-t',
          String(Math.ceil(this.config.startupTimeoutMs / 1000)),
          '-o',
          `-h ${this.config.host} -p ${String(this.config.port)} -k ${this.#socket}`,
          'start',
        ],
        { timeoutMs: this.config.startupTimeoutMs + 5_000 },
      );
    } catch (error) {
      const log = await readFile(this.#log, 'utf8').catch(() => '<no log>');
      throw new Error(`${String(error)}\nPostgres log:\n${log.slice(-8_000)}`);
    }
    if (!(await this.ready()))
      throw new Error(
        `Postgres started but readiness failed; inspect ${this.#log}`,
      );
    await this.ensureDatabase();
  }

  async stop(mode: 'fast' | 'immediate' = 'fast'): Promise<void> {
    const pgCtl = await postgresTool('pg_ctl');
    const result = await run(pgCtl, ['-D', this.#data, 'status'], {
      timeoutMs: 5_000,
      allowFailure: true,
    });
    if (!result.stdout.includes('server is running')) return;
    await run(
      pgCtl,
      [
        '-D',
        this.#data,
        '-w',
        '-t',
        String(Math.ceil(this.config.shutdownTimeoutMs / 1000)),
        '-m',
        mode,
        'stop',
      ],
      { timeoutMs: this.config.shutdownTimeoutMs + 5_000 },
    );
  }

  async kill(): Promise<void> {
    await this.stop('immediate');
  }

  async ready(): Promise<boolean> {
    const pgIsReady = await postgresTool('pg_isready');
    const result = await run(
      pgIsReady,
      [
        '-h',
        this.config.host,
        '-p',
        String(this.config.port),
        '-U',
        this.config.user,
        '-d',
        this.config.database,
      ],
      { env: this.pgEnv(), timeoutMs: 5_000, allowFailure: true },
    );
    return result.stdout.includes('accepting connections');
  }

  pgEnv(): NodeJS.ProcessEnv {
    return { ...process.env, PGPASSWORD: this.config.password };
  }

  connectionString(database = this.config.database): string {
    const user = encodeURIComponent(this.config.user);
    const password = encodeURIComponent(this.config.password);
    return `postgresql://${user}:${password}@${this.config.host}:${String(this.config.port)}/${database}`;
  }

  private async ensureDatabase(): Promise<void> {
    const psql = await postgresTool('psql');
    const probe = await run(
      psql,
      [
        '-h',
        this.config.host,
        '-p',
        String(this.config.port),
        '-U',
        this.config.user,
        '-d',
        'postgres',
        '-Atc',
        `select 1 from pg_database where datname = '${sqlLiteral(this.config.database)}'`,
      ],
      { env: this.pgEnv(), timeoutMs: 10_000 },
    );
    if (probe.stdout.trim() === '1') return;
    const createdb = await postgresTool('createdb');
    await run(
      createdb,
      [
        '-h',
        this.config.host,
        '-p',
        String(this.config.port),
        '-U',
        this.config.user,
        this.config.database,
      ],
      { env: this.pgEnv(), timeoutMs: 10_000 },
    );
  }
}

function sqlLiteral(value: string): string {
  return value.replaceAll("'", "''");
}
