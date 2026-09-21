import { createServer, createConnection, type Socket, type AddressInfo } from 'node:net';
import type { Pool } from 'pg';

/** Faults belong only to a disposable test database and its generation worker connections. */
export async function generationDatabaseFault(
  pool: Pool,
  databaseUrl: string,
  mode: 'output-rollback' | 'commit-response',
) {
  if (mode === 'output-rollback') {
    await pool.query(`
      CREATE SEQUENCE fixture_output_registration_hits;
      CREATE FUNCTION fixture_reject_output_registration() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM generation_assets asset
          JOIN generation_runs generation ON generation.id=asset.run_id
          JOIN design_scheme_runs scheme ON scheme.run_id=generation.design_scheme_run_id
          WHERE scheme.revision_id=NEW.revision_id AND scheme.user_id=NEW.user_id
        ) THEN RAISE EXCEPTION 'fixture requires preceding generation output in this transaction'; END IF;
        PERFORM nextval('fixture_output_registration_hits');
        RAISE EXCEPTION 'fixture output registration failure';
      END $$;
      CREATE TRIGGER fixture_reject_output_registration BEFORE INSERT ON design_scheme_assets
        FOR EACH ROW EXECUTE FUNCTION fixture_reject_output_registration();
    `);
    return {
      databaseUrl,
      // Sequence increments survive rollback, proving the failing transaction saw its own output.
      async snapshot() {
        const row = (
          await pool.query('SELECT last_value,is_called FROM fixture_output_registration_hits')
        ).rows[0];
        return { mode, outputRegistrationHits: row.is_called ? Number(row.last_value) : 0 };
      },
      dropResponse() {},
      async close() {
        await pool.query(`
          DROP TRIGGER IF EXISTS fixture_reject_output_registration ON design_scheme_assets;
          DROP FUNCTION IF EXISTS fixture_reject_output_registration();
          DROP SEQUENCE IF EXISTS fixture_output_registration_hits;
        `);
      },
    };
  }

  const target = new URL(databaseUrl);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname))
    throw new Error('Database fault proxy requires the disposable loopback PostgreSQL endpoint');
  const sockets = new Set<Socket>();
  const errors: string[] = [];
  let commitHeld = false;
  let responseDropped = false;
  let heldAt: string | null = null;
  let heldPair: [Socket, Socket] | undefined;
  let insertsObserved = 0;
  const dropResponse = () => {
    if (!heldPair) return;
    responseDropped = true;
    for (const socket of heldPair) socket.destroy();
    heldPair = undefined;
  };
  const server = createServer((client) => {
    const upstream = createConnection({ host: target.hostname, port: Number(target.port || 5432) });
    for (const socket of [client, upstream]) {
      sockets.add(socket);
      socket.on('error', () => {
        // Connection termination is the intentional fault; never export raw PG diagnostics.
        if (!responseDropped) errors.push('unexpected-socket-error');
        client.destroy();
        upstream.destroy();
      });
      socket.on('close', () => {
        sockets.delete(socket);
        client.destroy();
        upstream.destroy();
      });
    }
    let startup = true;
    let frontend = Buffer.alloc(0);
    let backend = Buffer.alloc(0);
    let outputTransaction = false;
    let outputCommitRequested = false;
    let suppress = false;
    function invalidFrame() {
      errors.push('invalid-or-unsupported-protocol-frame');
      client.destroy();
      upstream.destroy();
    }
    function observeQuery(query: string) {
      const sql = query.replaceAll('"', '').trim();
      if (/^begin\b/i.test(sql)) outputTransaction = false;
      if (/^insert\s+into\s+(?:public\.)?generation_assets\b/i.test(sql)) {
        outputTransaction = true;
        insertsObserved++;
      }
      if (/^commit\s*;?$/i.test(sql)) outputCommitRequested = outputTransaction;
      if (/^rollback\b/i.test(sql)) {
        outputTransaction = false;
        outputCommitRequested = false;
      }
    }
    client.on('data', (chunk: Buffer) => {
      frontend = Buffer.concat([frontend, chunk]);
      while (frontend.length >= (startup ? 4 : 5)) {
        const length = frontend.readInt32BE(startup ? 0 : 1);
        if (length < 4 || length > 32 * 1024 * 1024) return invalidFrame();
        const size = length + (startup ? 0 : 1);
        if (frontend.length < size) break;
        const frame = frontend.subarray(0, size);
        frontend = frontend.subarray(size);
        if (startup) {
          // This fixture intentionally supports the disposable server's unencrypted v3 protocol.
          if (length < 8 || frame.readInt32BE(4) !== 196608) return invalidFrame();
          startup = false;
        } else {
          const type = String.fromCharCode(frame[0]);
          if (type === 'Q') observeQuery(frame.toString('utf8', 5, frame.length - 1));
          if (type === 'P') {
            const start = frame.indexOf(0, 5) + 1;
            const end = frame.indexOf(0, start);
            if (start < 6 || end < start) return invalidFrame();
            observeQuery(frame.toString('utf8', start, end));
          }
        }
        upstream.write(frame);
      }
    });
    upstream.on('data', (chunk: Buffer) => {
      backend = Buffer.concat([backend, chunk]);
      while (backend.length >= 5) {
        const length = backend.readInt32BE(1);
        if (length < 4 || length > 32 * 1024 * 1024) return invalidFrame();
        const size = length + 1;
        if (backend.length < size) break;
        const frame = backend.subarray(0, size);
        backend = backend.subarray(size);
        // CommandComplete(COMMIT) originates from PostgreSQL after committing, not from the caller.
        if (
          !commitHeld &&
          outputCommitRequested &&
          frame[0] === 67 &&
          frame.toString('utf8', 5, size - 1) === 'COMMIT'
        ) {
          commitHeld = true;
          heldAt = new Date().toISOString();
          heldPair = [client, upstream];
          suppress = true;
        }
        if (!suppress) client.write(frame);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const proxied = new URL(databaseUrl);
  proxied.hostname = '127.0.0.1';
  proxied.port = String((server.address() as AddressInfo).port);
  return {
    databaseUrl: proxied.toString(),
    async snapshot() {
      return { mode, insertsObserved, commitHeld, responseDropped, heldAt, errors: [...errors] };
    },
    dropResponse,
    async close() {
      dropResponse();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
