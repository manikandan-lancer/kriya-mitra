import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { DbService } from '../db/db.service';

const CreateSchema = z.object({
  product_id: z.string().uuid(),
  crop_issue_id: z.string().uuid(),
  dosage: z.string().min(1),
  application: z.string().min(1),
  frequency: z.string().min(1),
  pre_harvest_interval_days: z.number().int().nonnegative().nullable().optional(),
  precautions: z.array(z.string()).default([]),
  notes: z.record(z.string()).default({}),
  rank: z.number().int().default(100),
});

const UpdateSchema = CreateSchema.partial().extend({
  approved_by: z.string().nullable().optional(),
  is_active: z.boolean().optional(),
});

@Controller('api/recommendations')
export class RecommendationsController {
  constructor(private readonly db: DbService) {}

  @Get()
  async list(
    @Query('crop_issue_id') cropIssueId?: string,
    @Query('product_id') productId?: string,
    @Query('approved') approved?: string,
  ) {
    const where: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (cropIssueId) {
      where.push(`r.crop_issue_id = $${i++}`);
      params.push(cropIssueId);
    }
    if (productId) {
      where.push(`r.product_id = $${i++}`);
      params.push(productId);
    }
    if (approved === 'true') where.push(`r.approved_by IS NOT NULL`);
    if (approved === 'false') where.push(`r.approved_by IS NULL`);
    const sql = `
      SELECT r.*, p.name AS product_name, i.name_en AS issue_name, c.name_en AS crop_name
      FROM product_recommendations r
      JOIN products p    ON p.id = r.product_id
      JOIN crop_issues i ON i.id = r.crop_issue_id
      JOIN crops c       ON c.id = i.crop_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY c.name_en, i.name_en, r.rank ASC`;
    return this.db.many(sql, params);
  }

  @Post()
  async create(@Body() raw: unknown) {
    const body = CreateSchema.parse(raw);
    return this.db.one(
      `INSERT INTO product_recommendations
         (product_id, crop_issue_id, dosage, application, frequency,
          pre_harvest_interval_days, precautions, notes, rank)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
       RETURNING *`,
      [
        body.product_id,
        body.crop_issue_id,
        body.dosage,
        body.application,
        body.frequency,
        body.pre_harvest_interval_days ?? null,
        body.precautions,
        JSON.stringify(body.notes),
        body.rank,
      ],
    );
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() raw: unknown) {
    const body = UpdateSchema.parse(raw);
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined) continue;
      if (k === 'notes') {
        sets.push(`notes = $${i++}::jsonb`);
        values.push(JSON.stringify(v));
      } else if (k === 'approved_by') {
        sets.push(`approved_by = $${i++}`);
        values.push(v);
        sets.push(`approved_at = ${v ? 'now()' : 'NULL'}`);
      } else {
        sets.push(`${k} = $${i++}`);
        values.push(v);
      }
    }
    if (sets.length === 0) {
      return this.db.one('SELECT * FROM product_recommendations WHERE id = $1', [id]);
    }
    values.push(id);
    return this.db.one(
      `UPDATE product_recommendations SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      values,
    );
  }

  @Post(':id/approve')
  @HttpCode(200)
  async approve(@Param('id') id: string, @Body() body: { approved_by: string }) {
    return this.db.one(
      `UPDATE product_recommendations
       SET approved_by = $1, approved_at = now(), is_active = TRUE
       WHERE id = $2 RETURNING *`,
      [body.approved_by, id],
    );
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string) {
    await this.db.query('DELETE FROM product_recommendations WHERE id = $1', [id]);
  }
}
