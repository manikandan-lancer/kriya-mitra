import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';

export type ConvState =
  | 'NEW'
  | 'ONBOARDING_LANG'
  | 'ONBOARDING_NAME'
  | 'ONBOARDING_STATE'
  | 'ONBOARDING_CROP'
  | 'ONBOARDING_CONSENT'
  | 'READY'
  | 'AWAITING_CROP_CONTEXT'
  | 'AWAITING_CLARIFICATION'
  | 'ESCALATED'
  | 'CLOSED';

export type Conversation = {
  id: string;
  farmer_id: string;
  status: 'active' | 'closed' | 'escalated';
  state: ConvState;
  context: Record<string, unknown>;
  channel: string;
  started_at: Date;
  closed_at: Date | null;
};

@Injectable()
export class ConversationsService {
  constructor(private readonly db: DbService) {}

  async getOrCreateActive(farmerId: string): Promise<Conversation> {
    const existing = await this.db.one<Conversation>(
      `SELECT * FROM conversations
       WHERE farmer_id = $1 AND status = 'active'
       ORDER BY started_at DESC LIMIT 1`,
      [farmerId],
    );
    if (existing) return existing;
    const created = await this.db.one<Conversation>(
      `INSERT INTO conversations (farmer_id, status, state, context)
       VALUES ($1, 'active', 'NEW', '{}'::jsonb)
       RETURNING *`,
      [farmerId],
    );
    if (!created) throw new Error('failed to create conversation');
    return created;
  }

  async setState(id: string, state: ConvState): Promise<void> {
    await this.db.query('UPDATE conversations SET state = $1 WHERE id = $2', [state, id]);
  }

  async patchContext(id: string, patch: Record<string, unknown>): Promise<void> {
    await this.db.query(
      'UPDATE conversations SET context = context || $1::jsonb WHERE id = $2',
      [JSON.stringify(patch), id],
    );
  }

  async escalate(id: string): Promise<void> {
    await this.db.query(
      `UPDATE conversations SET status = 'escalated', state = 'ESCALATED' WHERE id = $1`,
      [id],
    );
  }

  async appendInbound(args: {
    conversationId: string;
    waMessageId: string;
    contentType: string;
    text?: string | null;
    mediaId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<{ inserted: boolean }> {
    // ON CONFLICT on whatsapp_message_id is the dedup guard against Meta retries.
    const r = await this.db.query(
      `INSERT INTO messages
         (conversation_id, whatsapp_message_id, direction, sender, content_type, text, media_id, metadata)
       VALUES ($1, $2, 'inbound', 'farmer', $3, $4, $5, $6)
       ON CONFLICT (whatsapp_message_id) DO NOTHING`,
      [
        args.conversationId,
        args.waMessageId,
        args.contentType,
        args.text ?? null,
        args.mediaId ?? null,
        JSON.stringify(args.metadata ?? {}),
      ],
    );
    return { inserted: (r.rowCount ?? 0) > 0 };
  }

  async appendOutbound(args: {
    conversationId: string;
    waMessageId: string | null;
    sender: string;
    contentType: string;
    text?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO messages
         (conversation_id, whatsapp_message_id, direction, sender, content_type, text, metadata)
       VALUES ($1, $2, 'outbound', $3, $4, $5, $6)`,
      [
        args.conversationId,
        args.waMessageId,
        args.sender,
        args.contentType,
        args.text ?? null,
        JSON.stringify(args.metadata ?? {}),
      ],
    );
  }
}
