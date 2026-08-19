import { Kysely, PostgresDialect, sql } from 'kysely';
import { Client, Pool } from 'pg';
import type { WebApiConfig } from '../config.js';
import type { MusefoldDatabase } from './types.js';

const GENERATION_EVENTS_CHANNEL = 'musefold_generation_events';

export interface GenerationEventWaiter {
  wait(
    ownerId: number,
    runId: string,
    afterSeq: number,
    timeoutMs: number,
  ): Promise<boolean>;
}

interface EventWaiter {
  ownerId: number;
  runId: string;
  afterSeq: number;
  timer: NodeJS.Timeout;
  resolve: (notified: boolean) => void;
}

/** Dedicated LISTEN connection; event rows remain the durable source of truth. */
export class GenerationEventNotifier implements GenerationEventWaiter {
  private client: Client | null = null;
  private canListen = false;
  private readonly waiters = new Set<EventWaiter>();

  constructor(private readonly connectionString: string) {}

  async start(): Promise<void> {
    if (this.client) return;
    const client = new Client({
      connectionString: this.connectionString,
      application_name: 'musefold-web-api-events',
    });
    client.on('notification', (message) => this.handleNotification(message.payload));
    client.on('error', () => {
      // HTTP SSE falls back to its bounded timeout when LISTEN is unavailable.
      this.canListen = false;
    });
    await client.connect();
    await client.query(`LISTEN ${GENERATION_EVENTS_CHANNEL}`);
    this.client = client;
    this.canListen = true;
  }

  wait(
    ownerId: number,
    runId: string,
    afterSeq: number,
    timeoutMs: number,
  ): Promise<boolean> {
    if (!this.client || !this.canListen) return Promise.resolve(false);
    return new Promise((resolve) => {
      const waiter: EventWaiter = {
        ownerId,
        runId,
        afterSeq,
        timer: setTimeout(() => {
          this.waiters.delete(waiter);
          resolve(false);
        }, Math.max(1, timeoutMs)),
        resolve,
      };
      this.waiters.add(waiter);
    });
  }

  async close(): Promise<void> {
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve(false);
    }
    this.waiters.clear();
    const client = this.client;
    this.client = null;
    this.canListen = false;
    if (client) await client.end().catch(() => undefined);
  }

  private handleNotification(payload: string | undefined): void {
    if (!payload) return;
    try {
      const value = JSON.parse(payload) as {
        ownerId?: unknown;
        runId?: unknown;
        seq?: unknown;
      };
      if (
        typeof value.ownerId !== 'number' ||
        typeof value.runId !== 'string' ||
        typeof value.seq !== 'number'
      ) return;
      for (const waiter of [...this.waiters]) {
        if (
          waiter.ownerId !== value.ownerId ||
          waiter.runId !== value.runId ||
          value.seq <= waiter.afterSeq
        ) continue;
        clearTimeout(waiter.timer);
        this.waiters.delete(waiter);
        waiter.resolve(true);
      }
    } catch {
      // A malformed notification is harmless; the next timeout reads durable rows.
    }
  }
}

export interface ReadinessCheck {
  ok: boolean;
  latencyMs: number;
  detail?: string;
}

export interface ReadinessProbe {
  check(): Promise<ReadinessCheck>;
}

export class DatabaseRuntime implements ReadinessProbe {
  readonly pool: Pool;
  readonly db: Kysely<MusefoldDatabase>;
  readonly generationEvents: GenerationEventNotifier;

  constructor(
    config: Pick<WebApiConfig, 'DATABASE_URL' | 'DATABASE_MAX_CONNECTIONS'>,
  ) {
    this.pool = new Pool({
      connectionString: config.DATABASE_URL,
      max: config.DATABASE_MAX_CONNECTIONS,
      application_name: 'musefold-web-api',
    });
    this.db = new Kysely<MusefoldDatabase>({
      dialect: new PostgresDialect({ pool: this.pool }),
    });
    this.generationEvents = new GenerationEventNotifier(config.DATABASE_URL);
  }

  async check(): Promise<ReadinessCheck> {
    const startedAt = performance.now();
    try {
      const result = await sql<{ migration_table: string | null }>`
        select to_regclass('public.pgmigrations')::text as migration_table
      `.execute(this.db);
      const migrationTable = result.rows[0]?.migration_table;
      return {
        ok: migrationTable === 'pgmigrations',
        latencyMs: Math.round(performance.now() - startedAt),
        detail: migrationTable
          ? undefined
          : 'database migrations have not been applied',
      };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Math.round(performance.now() - startedAt),
        detail:
          error instanceof Error ? error.message : 'database check failed',
      };
    }
  }

  async close(): Promise<void> {
    await this.generationEvents.close();
    await this.db.destroy();
  }
}
