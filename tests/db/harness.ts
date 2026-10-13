import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../../supabase/migrations");
const SHIM_PATH = path.resolve(import.meta.dirname, "supabase-shim.sql");

export type ApiRole = "anon" | "authenticated" | "service_role";
export type Queryable = PGlite | Transaction;

/** Creates an in-memory Postgres with the Supabase shim and every migration applied in order. */
export async function createTestDatabase(): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { btree_gist, pgcrypto } });
  await db.exec(await readFile(SHIM_PATH, "utf8"));

  const migrations = (await readdir(MIGRATIONS_DIR)).filter((file) => file.endsWith(".sql")).sort();
  for (const file of migrations) {
    try {
      await db.exec(await readFile(path.join(MIGRATIONS_DIR, file), "utf8"));
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${errorMessage(error)}`, { cause: error });
    }
  }

  return db;
}

/** Runs the callback in a transaction that is always rolled back, isolating each test. */
export async function inRollback(db: PGlite, callback: (tx: Transaction) => Promise<void>): Promise<void> {
  await db.transaction(async (tx) => {
    await callback(tx);
    await tx.rollback();
  });
}

/** Switches the transaction to an API role and JWT subject, as PostgREST does per request. */
export async function actAs(tx: Transaction, userId: string | null, role: ApiRole = "authenticated"): Promise<void> {
  const claims = userId ? { sub: userId, role } : { role };
  await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
  await tx.exec(`set local role ${role}`);
}

/** Returns the transaction to the migration owner (bypasses RLS), for arranging and inspecting state. */
export async function actAsOwner(tx: Transaction): Promise<void> {
  await tx.exec("reset role");
  await tx.query("select set_config('request.jwt.claims', '', true)");
}

export async function rows<T>(db: Queryable, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

export async function affectedRows(db: Queryable, sql: string, params: unknown[] = []): Promise<number> {
  return (await db.query(sql, params)).affectedRows ?? 0;
}

interface ExpectedSqlError {
  code: string;
  message?: string;
}

/** Asserts the statement fails with the given SQLSTATE, keeping the surrounding transaction usable. */
export async function expectSqlError(
  tx: Transaction,
  sql: string,
  expected: ExpectedSqlError,
  params: unknown[] = [],
): Promise<void> {
  await tx.exec("savepoint expect_sql_error");
  try {
    await tx.query(sql, params);
  } catch (error) {
    await tx.exec("rollback to savepoint expect_sql_error");
    const { code, message } = error as { code?: string; message?: string };
    assert.equal(code, expected.code, `Expected SQLSTATE ${expected.code}, got ${code}: ${message}`);
    if (expected.message) {
      assert.ok(message?.includes(expected.message), `Expected message to include "${expected.message}", got "${message}"`);
    }
    return;
  }
  await tx.exec("release savepoint expect_sql_error");
  assert.fail(`Expected SQLSTATE ${expected.code}, but the statement succeeded: ${sql}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
