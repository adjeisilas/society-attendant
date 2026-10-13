/**
 * Applies supabase/migrations to the database in SUPABASE_DB_URL, oldest first, each in
 * its own transaction, and records them in supabase_migrations.schema_migrations the way
 * the Supabase CLI does, so `supabase db push` later sees them as already applied.
 *
 *   node scripts/apply-migrations.ts           apply pending migrations
 *   node scripts/apply-migrations.ts --status  list applied and pending migrations
 *
 * Requires psql on PATH (or PSQL_PATH). Use the session pooler (port 5432) or a direct
 * connection: transaction pooling cannot run migrations. The connection string is passed
 * to psql through environment variables and is never printed.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../supabase/migrations");

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
if (existsSync(".env")) process.loadEnvFile(".env");

const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) {
  console.error("SUPABASE_DB_URL is not set. Add the session pooler connection string to .env.");
  process.exit(1);
}

const url = new URL(connectionString);
if (url.port === "6543") {
  console.error("SUPABASE_DB_URL uses transaction pooling (port 6543). Use the session pooler (5432) for migrations.");
  process.exit(1);
}

const psqlEnv = {
  ...process.env,
  PGHOST: url.hostname,
  PGPORT: url.port || "5432",
  PGUSER: decodeURIComponent(url.username),
  PGPASSWORD: decodeURIComponent(url.password),
  PGDATABASE: url.pathname.slice(1) || "postgres",
  PGSSLMODE: url.searchParams.get("sslmode") ?? "require",
  PGAPPNAME: "attendant-migrations",
};
const psqlPath = process.env.PSQL_PATH ?? "psql";

function psql(args: string[], input?: string) {
  const result = spawnSync(psqlPath, ["-X", "-q", "-v", "ON_ERROR_STOP=1", ...args], {
    env: psqlEnv,
    input,
    encoding: "utf8",
  });
  if (result.error) {
    console.error(`Could not run psql: ${result.error.message}. Install PostgreSQL client tools or set PSQL_PATH.`);
    process.exit(1);
  }
  return result;
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

const tracking = psql(
  ["-c", `
    create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (
      version text primary key,
      statements text[],
      name text
    );`],
);
if (tracking.status !== 0) {
  console.error(tracking.stderr.trim());
  process.exit(1);
}

const appliedResult = psql(["-A", "-t", "-c", "select version from supabase_migrations.schema_migrations order by version"]);
if (appliedResult.status !== 0) {
  console.error(appliedResult.stderr.trim());
  process.exit(1);
}
const applied = new Set(appliedResult.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));

const migrations = (await readdir(MIGRATIONS_DIR))
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => {
    const [version, ...rest] = file.replace(/\.sql$/, "").split("_");
    return { file, version, name: rest.join("_") };
  });

const pending = migrations.filter((migration) => !applied.has(migration.version));

if (process.argv.includes("--status")) {
  for (const migration of migrations) {
    console.log(`${applied.has(migration.version) ? "applied" : "pending"}  ${migration.file}`);
  }
  process.exit(0);
}

if (pending.length === 0) {
  console.log("Database is up to date.");
  process.exit(0);
}

for (const migration of pending) {
  const filePath = path.join(MIGRATIONS_DIR, migration.file).replaceAll("\\", "/");
  // The migration and its tracking row commit together, or not at all.
  const script = [
    `\\i ${sqlLiteral(filePath)}`,
    `insert into supabase_migrations.schema_migrations (version, name) values (${sqlLiteral(migration.version)}, ${sqlLiteral(migration.name)});`,
  ].join("\n");

  const result = psql(["--single-transaction", "-f", "-"], script);
  const notices = result.stderr
    .split(/\r?\n/)
    .filter((line) => line.includes("NOTICE"))
    .map((line) => `    ${line.trim()}`);

  if (result.status !== 0) {
    console.error(`FAILED   ${migration.file} (rolled back)`);
    console.error(result.stderr.trim());
    process.exit(1);
  }
  console.log(`applied  ${migration.file}`);
  if (notices.length > 0) console.log(notices.join("\n"));
}

console.log(`Applied ${pending.length} migration(s).`);
