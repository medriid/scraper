/**
 * Migration runner — runs all SQL files in supabase/migrations/ in order.
 *
 * Requires a direct PostgreSQL connection URL (not the Supabase REST API).
 * Set DATABASE_URL to your Supabase PostgreSQL connection string, e.g.:
 *   postgresql://postgres:[password]@db.[project-ref].supabase.co:5432/postgres
 *
 * This script is safe to re-run — all migrations use "IF NOT EXISTS" and
 * other idempotent patterns so duplicate runs are harmless.
 *
 * Usage:
 *   npx tsx src/migrate.ts           (development)
 *   node dist/migrate.js             (production build)
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import pg from "pg";

const { Client } = pg;

async function runMigrations() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.warn(
      "⚠  DATABASE_URL is not set — skipping migrations.\n" +
        "   Set it to your Supabase PostgreSQL URL to enable automatic migrations.\n" +
        "   Format: postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres"
    );
    return;
  }

  // __dirname is available in CommonJS (which this compiles to)
  const migrationsDir = path.resolve(__dirname, "../../supabase/migrations");

  let files: string[];
  try {
    files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
  } catch {
    console.warn(`⚠  Could not read migrations directory: ${migrationsDir}`);
    return;
  }

  if (files.length === 0) {
    console.log("ℹ  No migration files found.");
    return;
  }

  const client = new Client({
    connectionString: dbUrl,
    // Supabase requires SSL. rejectUnauthorized defaults to true (validates the cert).
    // Set DATABASE_SSL_REJECT_UNAUTHORIZED=false only if you get cert errors with a
    // self-hosted or local Supabase instance.
    ssl: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === "false"
      ? { rejectUnauthorized: false }
      : { rejectUnauthorized: true },
  });

  try {
    await client.connect();
    console.log(`🗄  Running ${files.length} migration(s)…`);

    // Create a simple migrations tracking table
    await client.query(`
      create table if not exists public._migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      );
    `);

    for (const file of files) {
      const { rows } = await client.query(
        "select name from public._migrations where name = $1",
        [file]
      );

      if (rows.length > 0) {
        console.log(`   ✓ ${file} (already applied)`);
        continue;
      }

      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
      try {
        await client.query(sql);
        await client.query(
          "insert into public._migrations (name) values ($1) on conflict do nothing",
          [file]
        );
        console.log(`   ✓ ${file}`);
      } catch (err: unknown) {
        // Log and continue — later migrations may still succeed independently.
        // If a later migration depends on a failed one it will also fail and be logged.
        // Fix the underlying SQL error and re-run; already-applied migrations are skipped.
        console.error(`   ✗ ${file} failed — ${String(err)}`);
        console.error(`     The database may be in a partially-applied state. Fix the error above and re-run.`);
      }
    }

    console.log("✅  Migrations complete.");
  } finally {
    await client.end();
  }
}

runMigrations().catch((err) => {
  console.error("Migration runner failed:", err);
  // Non-fatal — do not exit with non-zero code so the server still starts
});
