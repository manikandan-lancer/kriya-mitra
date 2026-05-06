import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { DbService } from '../db/db.service';

const PackSize = z.object({ size: z.string(), price: z.number().nonnegative() });

const CreateProduct = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  category: z.string().optional(),
  description: z.record(z.string()).default({}),
  active_ingredients: z.array(z.string()).default([]),
  certifications: z.array(z.string()).default([]),
  image_urls: z.array(z.string().url()).default([]),
  msrp: z.number().nonnegative().optional(),
  pack_sizes: z.array(PackSize).default([]),
  is_active: z.boolean().default(true),
});
const UpdateProduct = CreateProduct.partial();

@Controller('api/products')
export class ProductsController {
  constructor(private readonly db: DbService) {}

  @Get()
  async list(@Query('q') q?: string, @Query('active') active?: string) {
    const where: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (q) {
      where.push(`(name ILIKE $${i} OR sku ILIKE $${i})`);
      params.push(`%${q}%`);
      i++;
    }
    if (active === 'true') where.push('is_active = TRUE');
    if (active === 'false') where.push('is_active = FALSE');
    return this.db.many(
      `SELECT * FROM products
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY name ASC`,
      params,
    );
  }

  @Get(':id')
  async getOne(@Param('id') id: string) {
    const row = await this.db.one('SELECT * FROM products WHERE id = $1', [id]);
    if (!row) throw new NotFoundException();
    return row;
  }

  @Post()
  async create(@Body() raw: unknown) {
    const body = CreateProduct.parse(raw);
    return this.db.one(
      `INSERT INTO products
         (sku, name, category, description, active_ingredients, certifications,
          image_urls, msrp, pack_sizes, is_active)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9::jsonb,$10)
       RETURNING *`,
      [
        body.sku,
        body.name,
        body.category ?? null,
        JSON.stringify(body.description),
        body.active_ingredients,
        body.certifications,
        body.image_urls,
        body.msrp ?? null,
        JSON.stringify(body.pack_sizes),
        body.is_active,
      ],
    );
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() raw: unknown) {
    const body = UpdateProduct.parse(raw);
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined) continue;
      if (k === 'description' || k === 'pack_sizes') {
        sets.push(`${k} = $${i++}::jsonb`);
        values.push(JSON.stringify(v));
      } else {
        sets.push(`${k} = $${i++}`);
        values.push(v);
      }
    }
    if (sets.length === 0) return this.getOne(id);
    values.push(id);
    return this.db.one(
      `UPDATE products SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      values,
    );
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string) {
    await this.db.query('UPDATE products SET is_active = FALSE WHERE id = $1', [id]);
  }
}
