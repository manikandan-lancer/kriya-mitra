import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';

export type Farmer = {
  id: string;
  whatsapp_number: string;
  name: string | null;
  preferred_lang: string | null;
  state: string | null;
  district: string | null;
  pincode: string | null;
  farm_size_acres: string | null;
  consent_given: boolean;
  consent_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

@Injectable()
export class FarmersService {
  constructor(private readonly db: DbService) {}

  async findOrCreateByPhone(waId: string, profileName?: string): Promise<Farmer> {
    const existing = await this.db.one<Farmer>(
      'SELECT * FROM farmers WHERE whatsapp_number = $1',
      [waId],
    );
    if (existing) return existing;
    const created = await this.db.one<Farmer>(
      `INSERT INTO farmers (whatsapp_number, name)
       VALUES ($1, $2)
       RETURNING *`,
      [waId, profileName ?? null],
    );
    if (!created) throw new Error('failed to create farmer');
    return created;
  }

  async setLanguage(id: string, lang: string): Promise<void> {
    await this.db.query('UPDATE farmers SET preferred_lang = $1 WHERE id = $2', [lang, id]);
  }

  async setProfile(
    id: string,
    patch: Partial<Pick<Farmer, 'name' | 'state' | 'district' | 'pincode' | 'farm_size_acres'>>,
  ): Promise<void> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      fields.push(`${k} = $${i++}`);
      values.push(v);
    }
    if (fields.length === 0) return;
    values.push(id);
    await this.db.query(`UPDATE farmers SET ${fields.join(', ')} WHERE id = $${i}`, values);
  }

  async grantConsent(id: string): Promise<void> {
    await this.db.query(
      'UPDATE farmers SET consent_given = TRUE, consent_at = now() WHERE id = $1',
      [id],
    );
  }
}
