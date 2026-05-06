/**
 * Import product recommendations from a CSV file.
 *
 * Usage:
 *   npm run import:recs -- data/recommendations-template.csv
 *   npm run import:recs -- data/from-agronomy-team.csv --dry-run
 *
 * The CSV must have these columns (one row per crop x issue x product):
 *   crop_slug, crop_name_en, crop_scientific (optional),
 *   issue_slug, issue_name_en, issue_type, issue_severity, issue_scientific (optional),
 *   issue_symptoms (semicolon-separated),
 *   product_sku, product_name, product_category, product_active_ingredients (semicolon),
 *   product_certifications (semicolon),
 *   dosage, application, frequency, pre_harvest_interval_days,
 *   precautions (semicolon-separated), notes_en, rank,
 *   approved_by
 *
 * Behaviour:
 *  - Crops/issues/products are upserted (created if missing, updated if present).
 *  - Recommendations are upserted on (product_id, crop_issue_id).
 *  - approved_by empty = recommendation imported as DRAFT (bot will not serve it).
 *  - approved_by filled = recommendation marked approved (approved_at = now).
 *  - --dry-run parses + validates but writes nothing.
 */
import 'dotenv/config';
import { Client } from 'pg';
import { parse } from 'csv-parse/sync';
import { readFileSync } from 'fs';
import { resolve } from 'path';

type Row = Record<string, string>;

const args = process.argv.slice(2);
const csvPath = args.find((a) => !a.startsWith('--'));
const dryRun = args.includes('--dry-run');

if (!csvPath) {
  console.error('Usage: npm run import:recs -- <path-to-csv> [--dry-run]');
  process.exit(1);
}

const REQUIRED = [
  'crop_slug',
  'crop_name_en',
  'issue_slug',
  'issue_name_en',
  'issue_type',
  'issue_severity',
  'product_sku',
  'product_name',
  'dosage',
  'application',
  'frequency',
];

const VALID_ISSUE_TYPES = new Set(['pest', 'disease', 'deficiency', 'stress']);
const VALID_SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);

function splitList(s: string | undefined): string[] {
  if (!s) return [];
  return s
    .split(';')
    .map((x) => x.trim())
    .filter(Boolean);
}

function parseInt0(s: string | undefined, fallback = 0): number | null {
  if (s === undefined || s.trim() === '') return null;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : fallback;
}

function validate(rows: Row[]): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  rows.forEach((row, i) => {
    const line = i + 2; // +1 for 1-index, +1 for header row
    for (const k of REQUIRED) {
      if (!row[k] || !row[k].trim()) {
        errors.push(`Row ${line}: missing required field "${k}"`);
      }
    }
    if (row.issue_type && !VALID_ISSUE_TYPES.has(row.issue_type)) {
      errors.push(
        `Row ${line}: issue_type="${row.issue_type}" must be one of pest|disease|deficiency|stress`,
      );
    }
    if (row.issue_severity && !VALID_SEVERITIES.has(row.issue_severity)) {
      errors.push(
        `Row ${line}: issue_severity="${row.issue_severity}" must be one of low|medium|high|critical`,
      );
    }
  });
  return errors.length ? { ok: false, errors } : { ok: true };
}

async function main() {
  const text = readFileSync(resolve(csvPath!), 'utf8');
  const rows = parse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Row[];

  console.log(`Read ${rows.length} rows from ${csvPath}`);

  const v = validate(rows);
  if (!v.ok) {
    console.error('Validation failed:');
    v.errors.forEach((e) => console.error('  ' + e));
    process.exit(1);
  }
  console.log('Validation OK');

  if (dryRun) {
    console.log('--dry-run: not writing to database');
    process.exit(0);
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  const client = new Client({ connectionString: url });
  await client.connect();

  let crops = 0;
  let issues = 0;
  let products = 0;
  let recs = 0;
  let approved = 0;

  try {
    await client.query('BEGIN');

    for (const row of rows) {
      // 1. Upsert crop
      const cropRes = await client.query<{ id: string; created: boolean }>(
        `INSERT INTO crops (slug, name_en, scientific, category)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (slug) DO UPDATE SET name_en = EXCLUDED.name_en
         RETURNING id, (xmax = 0) AS created`,
        [row.crop_slug, row.crop_name_en, row.crop_scientific || null, row.crop_category || null],
      );
      const cropId = cropRes.rows[0].id;
      if (cropRes.rows[0].created) crops++;

      // 2. Upsert crop_issue
      const issueRes = await client.query<{ id: string; created: boolean }>(
        `INSERT INTO crop_issues
           (crop_id, slug, type, name_en, scientific, symptoms, severity)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (crop_id, slug) DO UPDATE SET
           type = EXCLUDED.type,
           name_en = EXCLUDED.name_en,
           scientific = EXCLUDED.scientific,
           symptoms = EXCLUDED.symptoms,
           severity = EXCLUDED.severity
         RETURNING id, (xmax = 0) AS created`,
        [
          cropId,
          row.issue_slug,
          row.issue_type,
          row.issue_name_en,
          row.issue_scientific || null,
          splitList(row.issue_symptoms),
          row.issue_severity,
        ],
      );
      const issueId = issueRes.rows[0].id;
      if (issueRes.rows[0].created) issues++;

      // 3. Upsert product
      const productRes = await client.query<{ id: string; created: boolean }>(
        `INSERT INTO products
           (sku, name, category, active_ingredients, certifications, is_active)
         VALUES ($1, $2, $3, $4, $5, TRUE)
         ON CONFLICT (sku) DO UPDATE SET
           name = EXCLUDED.name,
           category = EXCLUDED.category,
           active_ingredients = EXCLUDED.active_ingredients,
           certifications = EXCLUDED.certifications
         RETURNING id, (xmax = 0) AS created`,
        [
          row.product_sku,
          row.product_name,
          row.product_category || null,
          splitList(row.product_active_ingredients),
          splitList(row.product_certifications),
        ],
      );
      const productId = productRes.rows[0].id;
      if (productRes.rows[0].created) products++;

      // 4. Upsert product_recommendation (the verbatim row)
      const approvedBy = (row.approved_by || '').trim() || null;
      const isApproved = !!approvedBy;
      if (isApproved) approved++;

      const recRes = await client.query<{ id: string; created: boolean }>(
        `INSERT INTO product_recommendations
           (product_id, crop_issue_id, dosage, application, frequency,
            pre_harvest_interval_days, precautions, notes, rank,
            approved_by, approved_at, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,TRUE)
         ON CONFLICT (product_id, crop_issue_id) DO UPDATE SET
           dosage = EXCLUDED.dosage,
           application = EXCLUDED.application,
           frequency = EXCLUDED.frequency,
           pre_harvest_interval_days = EXCLUDED.pre_harvest_interval_days,
           precautions = EXCLUDED.precautions,
           notes = EXCLUDED.notes,
           rank = EXCLUDED.rank,
           approved_by = EXCLUDED.approved_by,
           approved_at = EXCLUDED.approved_at,
           is_active = TRUE
         RETURNING id, (xmax = 0) AS created`,
        [
          productId,
          issueId,
          row.dosage,
          row.application,
          row.frequency,
          parseInt0(row.pre_harvest_interval_days),
          splitList(row.precautions),
          JSON.stringify({ en: row.notes_en || '' }),
          parseInt0(row.rank, 100) ?? 100,
          approvedBy,
          isApproved ? new Date() : null,
        ],
      );
      if (recRes.rows[0].created) recs++;
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Import failed (rolled back):', e);
    process.exit(1);
  } finally {
    await client.end();
  }

  console.log('---');
  console.log(`Crops:           ${crops} new (existing rows updated in place)`);
  console.log(`Issues:          ${issues} new`);
  console.log(`Products:        ${products} new`);
  console.log(`Recommendations: ${recs} new`);
  console.log(`Approved:        ${approved} of ${rows.length} rows`);
  console.log(`Drafts:          ${rows.length - approved} (won't be served by bot until approved_by is filled)`);
  console.log('---');
  console.log('Done. Bot will now serve approved rows for the matching crop+issue queries.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
