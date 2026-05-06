import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';

export type DiagnosisCandidate = {
  issue_id: string | null;
  label: string;
  type: string;
  confidence: number;
  evidence: string;
};

export type Diagnosis = {
  id: string;
  farmer_id: string;
  conversation_id: string;
  image_id: string | null;
  crop_id: string | null;
  candidates: DiagnosisCandidate[];
  top_issue_id: string | null;
  top_confidence: string | null;
  severity_hint: string | null;
  model_name: string | null;
  model_version: string | null;
  reasoning: string | null;
  created_at: Date;
};

@Injectable()
export class DiagnosesService {
  constructor(private readonly db: DbService) {}

  async create(args: {
    farmerId: string;
    conversationId: string;
    imageId?: string | null;
    cropId?: string | null;
    candidates: DiagnosisCandidate[];
    topIssueId: string | null;
    topConfidence: number | null;
    severityHint: string | null;
    modelName: string;
  }): Promise<Diagnosis> {
    const row = await this.db.one<Diagnosis>(
      `INSERT INTO diagnoses
         (farmer_id, conversation_id, image_id, crop_id, candidates, top_issue_id,
          top_confidence, severity_hint, model_name)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9)
       RETURNING *`,
      [
        args.farmerId,
        args.conversationId,
        args.imageId ?? null,
        args.cropId ?? null,
        JSON.stringify(args.candidates),
        args.topIssueId,
        args.topConfidence,
        args.severityHint,
        args.modelName,
      ],
    );
    if (!row) throw new Error('failed to create diagnosis');
    return row;
  }

  /**
   * Map a vision model's free-text issue label (e.g., "Whitefly damage") to a
   * crop_issues row id. We use a case-insensitive match on name_en, slug, and
   * scientific name. For the MVP this is good enough; Phase 2 should swap in
   * pgvector cosine match against crop_issues.embedding.
   */
  async lookupIssueId(args: {
    cropId: string | null;
    label: string;
  }): Promise<{ issue_id: string; severity: string | null } | null> {
    const term = args.label.trim();
    if (!term) return null;
    if (args.cropId) {
      const r = await this.db.one<{ id: string; severity: string | null }>(
        `SELECT id, severity FROM crop_issues
         WHERE crop_id = $1
           AND (name_en ILIKE $2 OR slug ILIKE $3 OR scientific ILIKE $2)
         LIMIT 1`,
        [args.cropId, `%${term}%`, term.toLowerCase().replace(/\s+/g, '_')],
      );
      if (r) return { issue_id: r.id, severity: r.severity };
    }
    const r2 = await this.db.one<{ id: string; severity: string | null }>(
      `SELECT id, severity FROM crop_issues
       WHERE name_en ILIKE $1 OR scientific ILIKE $1
       LIMIT 1`,
      [`%${term}%`],
    );
    return r2 ? { issue_id: r2.id, severity: r2.severity } : null;
  }

  async lookupCropId(label: string | null): Promise<string | null> {
    if (!label) return null;
    const r = await this.db.one<{ id: string }>(
      `SELECT id FROM crops WHERE name_en ILIKE $1 OR slug = $2 LIMIT 1`,
      [`%${label.trim()}%`, label.trim().toLowerCase()],
    );
    return r?.id ?? null;
  }
}
