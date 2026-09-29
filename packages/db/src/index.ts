import pg from "pg";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export type Client = pg.PoolClient;
const here = path.dirname(fileURLToPath(import.meta.url));

export class Db {
  constructor(readonly pool: pg.Pool) {}
  static connect(url = process.env.DATABASE_URL): Db {
    if (!url) throw new Error("DATABASE_URL is not set");
    return new Db(new pg.Pool({ connectionString: url, max: 10 }));
  }
  /** Every business query runs in a transaction scoped to one tenant; RLS enforces it. */
  async tx<T>(tenantId: string, fn: (c: Client) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      const out = await fn(c);
      await c.query("COMMIT");
      return out;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  async authLookup(subject: string): Promise<{ user_id: string; tenant_id: string; locale: string } | undefined> {
    const r = await this.pool.query("SELECT * FROM auth_lookup($1)", [subject]);
    return r.rows[0];
  }
  close() { return this.pool.end(); }
}

/** Apply migrations as the owner (admin URL). Idempotent via a schema_migrations table. */
export async function migrate(adminUrl: string): Promise<string[]> {
  const pool = new pg.Pool({ connectionString: adminUrl });
  const dir = path.join(here, "..", "migrations");
  const applied: string[] = [];
  try {
    await pool.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, at timestamptz DEFAULT now())");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
      const done = await pool.query("SELECT 1 FROM schema_migrations WHERE name=$1", [f]);
      if (done.rowCount) continue;
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        await c.query(readFileSync(path.join(dir, f), "utf8"));
        await c.query("INSERT INTO schema_migrations(name) VALUES ($1)", [f]);
        await c.query("COMMIT");
      } catch (e) {
        await c.query("ROLLBACK");
        throw new Error(`${f}: ${(e as Error).message}`);
      } finally {
        c.release();
      }
      applied.push(f);
    }
  } finally {
    await pool.end();
  }
  return applied;
}
