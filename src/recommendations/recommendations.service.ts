import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DbService } from '../db/db.service';

export type RecommendationCard = {
  product_id: string;
  product_sku: string;
  product_name: string;
  product_image_url: string | null;
  certifications: string[];
  // The four fields below are rendered VERBATIM from the DB. The orchestrator
  // and the LLM are forbidden from modifying them.
  dosage: string;
  application: string;
  frequency: string;
  pre_harvest_interval_days: number | null;
  precautions: string[];
  notes_en: string | null;
};

export type RecommendationOutcome =
  | { kind: 'recommend'; card: RecommendationCard; escalate: boolean; escalate_reason?: string }
  | { kind: 'no_match'; reason: 'no_approved_product_for_this_issue' | 'low_confidence' }
  | { kind: 'critical'; card: RecommendationCard; reason: 'critical_severity' };

type RecRow = {
  id: string;
  product_id: string;
  product_sku: string;
  product_name: string;
  product_image_url: string | null;
  certifications: string[];
  dosage: string;
  application: string;
  frequency: string;
  pre_harvest_interval_days: number | null;
  precautions: string[];
  notes: { en?: string } & Record<string, unknown>;
};

@Injectable()
export class RecommendationsService {
  private readonly logger = new Logger(RecommendationsService.name);
  private readonly minConfidence: number;

  constructor(
    private readonly db: DbService,
    private readonly config: ConfigService,
  ) {
    this.minConfidence = Number(this.config.get('DIAGNOSIS_CONFIDENCE_THRESHOLD') ?? 0.6);
  }

  /**
   * Resolve a diagnosis to a single approved Kriya product, or signal that
   * we should escalate instead. Hard rules:
   *
   *   1. If confidence < threshold -> no_match (escalate).
   *   2. If severity = 'critical' -> always pair the product with a forced
   *      agronomist handoff.
   *   3. Only rows with approved_by IS NOT NULL AND is_active = true are
   *      considered. The bot never serves "draft" recommendations.
   *   4. The card returned holds dosage/frequency/precautions VERBATIM from
   *      the DB. Callers must not mutate those fields.
   */
  async resolve(args: {
    cropIssueId: string | null;
    confidence: number;
    severity: string | null;
  }): Promise<RecommendationOutcome> {
    if (!args.cropIssueId) {
      return { kind: 'no_match', reason: 'no_approved_product_for_this_issue' };
    }
    if (args.confidence < this.minConfidence) {
      return { kind: 'no_match', reason: 'low_confidence' };
    }

    const row = await this.db.one<RecRow>(
      `SELECT
         r.id,
         r.product_id,
         p.sku        AS product_sku,
         p.name       AS product_name,
         (p.image_urls)[1] AS product_image_url,
         p.certifications,
         r.dosage,
         r.application,
         r.frequency,
         r.pre_harvest_interval_days,
         r.precautions,
         r.notes
       FROM product_recommendations r
       JOIN products p ON p.id = r.product_id
       WHERE r.crop_issue_id = $1
         AND r.is_active = TRUE
         AND r.approved_by IS NOT NULL
         AND p.is_active = TRUE
       ORDER BY r.rank ASC
       LIMIT 1`,
      [args.cropIssueId],
    );

    if (!row) {
      return { kind: 'no_match', reason: 'no_approved_product_for_this_issue' };
    }

    const card: RecommendationCard = {
      product_id: row.product_id,
      product_sku: row.product_sku,
      product_name: row.product_name,
      product_image_url: row.product_image_url,
      certifications: row.certifications ?? [],
      dosage: row.dosage,
      application: row.application,
      frequency: row.frequency,
      pre_harvest_interval_days: row.pre_harvest_interval_days,
      precautions: row.precautions ?? [],
      notes_en: row.notes?.en ?? null,
    };

    if (args.severity === 'critical') {
      return { kind: 'critical', card, reason: 'critical_severity' };
    }

    return { kind: 'recommend', card, escalate: false };
  }

  /** Used by the LLM product-pick prompt. Returns the candidate set the model can choose from. */
  async candidatesFor(
    cropIssueId: string,
  ): Promise<
    Array<{
      product_id: string;
      name: string;
      mapped_issues: string[];
      dosage: string;
      application: string;
      frequency: string;
      precautions: string[];
      certifications: string[];
    }>
  > {
    return this.db.many(
      `SELECT
         r.product_id,
         p.name,
         ARRAY[i.name_en]               AS mapped_issues,
         r.dosage,
         r.application,
         r.frequency,
         r.precautions,
         p.certifications
       FROM product_recommendations r
       JOIN products p     ON p.id = r.product_id
       JOIN crop_issues i  ON i.id = r.crop_issue_id
       WHERE r.crop_issue_id = $1 AND r.is_active = TRUE AND r.approved_by IS NOT NULL`,
      [cropIssueId],
    );
  }
}
