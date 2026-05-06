import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';

export type EscalationReason =
  | 'low_confidence'
  | 'severe_keyword'
  | 'repeat_question'
  | 'farmer_request'
  | 'regulated_pest'
  | 'no_approved_product'
  | 'critical_severity'
  | 'out_of_scope';

@Injectable()
export class EscalationsService {
  constructor(private readonly db: DbService) {}

  async create(args: {
    conversationId: string;
    farmerId: string;
    reason: EscalationReason;
    priority?: 'p1' | 'p2' | 'p3';
  }): Promise<{ id: string }> {
    const r = await this.db.one<{ id: string }>(
      `INSERT INTO escalations (conversation_id, farmer_id, reason, priority)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [args.conversationId, args.farmerId, args.reason, args.priority ?? 'p2'],
    );
    if (!r) throw new Error('failed to queue escalation');
    return r;
  }

  /**
   * Lightweight rule-based pre-filter before we call the LLM escalation prompt.
   * Catches the unambiguous cases cheaply.
   */
  detectSevereKeywords(text: string | null): boolean {
    if (!text) return false;
    const t = text.toLowerCase();
    const patterns = [
      // English
      /dying/, /spreading fast/, /whole field/, /many plants/, /half the crop/,
      // Hindi (transliterated)
      /mar raha/, /sukh raha/, /poora khet/,
      // Tamil (transliterated)
      /sethu poguthu/, /muzhuvathum/,
    ];
    return patterns.some((p) => p.test(t));
  }

  detectAgronomistRequest(text: string | null): boolean {
    if (!text) return false;
    const t = text.toLowerCase();
    return (
      /agronomist|expert|specialist|human/.test(t) ||
      /நிபுணர்|விவசாய நிபுணர்/.test(t) ||
      /विशेषज्ञ|कृषि विशेषज्ञ/.test(t)
    );
  }
}
