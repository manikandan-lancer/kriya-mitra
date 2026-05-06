/* Plain-Postgres migration runner. Reads SQL files from /migrations in
 * lexicographic order and applies any that haven't been run yet.
 *
 * Run with:  npm run db:migrate
 */
import 'dotenv/config';
import { Client } from 'pg';
import { readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';

async function main() {
  const dir = resolve(__dirname, '..', 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');

  const client = new Client({ connectionString: url });
  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const applied = new Set(
    (await client.query<{ filename: string }>('SELECT filename FROM schema_migrations')).rows.map(
      (r) => r.filename,
    ),
  );

  for (const file of files) {
    if (applied.has(file)) {
      // eslint-disable-next-line no-console
      console.log(`= already applied: ${file}`);
      continue;
    }
    const sql = readFileSync(join(dir, file), 'utf8');
    // eslint-disable-next-line no-console
    console.log(`+ applying: ${file}`);
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      // eslint-disable-next-line no-console
      console.error(`failed: ${file}`, e);
      process.exit(1);
    }
  }

  await client.end();
  // eslint-disable-next-line no-console
  console.log('all migrations applied.');
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
