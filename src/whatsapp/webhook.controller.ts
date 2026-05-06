import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Logger,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import * as crypto from 'crypto';
import { OrchestratorService } from '../orchestrator/orchestrator.service';
import { WaWebhookPayload } from './types';

@Controller('webhooks/whatsapp')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly orchestrator: OrchestratorService,
  ) {}

  // Meta verification handshake.
  @Get()
  verify(
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') token?: string,
    @Query('hub.challenge') challenge?: string,
  ): string {
    const expected = this.config.getOrThrow<string>('WHATSAPP_VERIFY_TOKEN');
    if (mode === 'subscribe' && token === expected && challenge) {
      return challenge;
    }
    throw new ForbiddenException('verification failed');
  }

  @Post()
  @HttpCode(200)
  async receive(
    @Req() req: Request,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Body() _body: unknown,
  ): Promise<{ ok: true }> {
    const raw = (req as Request & { body: Buffer }).body;
    this.logger.log(
      `>>> webhook hit: bytes=${Buffer.isBuffer(raw) ? raw.length : 'n/a'} sig=${signature ? 'present' : 'missing'}`,
    );
    if (!Buffer.isBuffer(raw)) {
      this.logger.warn('Webhook body was not buffered. Did you mount express.raw() on /webhooks?');
      return { ok: true };
    }

    if (!this.verifySignature(raw, signature)) {
      // Always return 200 to Meta but drop the payload silently (fail-closed).
      this.logger.warn('Invalid X-Hub-Signature-256 - dropping payload');
      return { ok: true };
    }

    let payload: WaWebhookPayload;
    try {
      payload = JSON.parse(raw.toString('utf8')) as WaWebhookPayload;
    } catch {
      this.logger.warn('Webhook payload not valid JSON');
      return { ok: true };
    }

    // ACK fast, process async. Meta retries on non-2xx.
    setImmediate(() => {
      this.dispatch(payload).catch((e) =>
        this.logger.error(`dispatch error: ${(e as Error).stack ?? e}`),
      );
    });

    return { ok: true };
  }

  private async dispatch(payload: WaWebhookPayload): Promise<void> {
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        const messages = value.messages ?? [];
        const contacts = value.contacts ?? [];
        this.logger.log(
          `dispatch: field=${change.field} messages=${messages.length} contacts=${contacts.length}`,
        );
        for (const message of messages) {
          const profileName = contacts.find((c) => c.wa_id === message.from)?.profile?.name;
          this.logger.log(
            `dispatch -> orchestrator: from=${message.from} type=${message.type} id=${message.id}`,
          );
          await this.orchestrator.handleInbound({
            waId: message.from,
            profileName,
            message,
          });
        }
      }
    }
  }

  private verifySignature(body: Buffer, signature: string | undefined): boolean {
    if (!signature) return false;
    const secret = this.config.getOrThrow<string>('WHATSAPP_APP_SECRET');
    const expected =
      'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    } catch {
      return false;
    }
  }
}
