import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { TestMediaService } from './test-media.service';

type Lang = 'en' | 'ta' | 'hi' | 'te' | 'kn' | 'mr' | 'bn';

export type Button = { id: string; title: string };

@Injectable()
export class WhatsappClientService {
  private readonly logger = new Logger(WhatsappClientService.name);
  private readonly http: AxiosInstance;
  private readonly phoneNumberId: string;

  constructor(
    private readonly config: ConfigService,
    private readonly testMedia: TestMediaService,
  ) {
    const token = this.config.getOrThrow<string>('WHATSAPP_ACCESS_TOKEN');
    this.phoneNumberId = this.config.getOrThrow<string>('WHATSAPP_PHONE_NUMBER_ID');
    this.http = axios.create({
      baseURL: `https://graph.facebook.com/v21.0/${this.phoneNumberId}`,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      timeout: 15_000,
    });
  }

  async sendText(to: string, body: string): Promise<string | null> {
    return this.send({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body, preview_url: false },
    });
  }

  async sendButtons(
    to: string,
    body: string,
    buttons: Button[],
    opts: { headerImageUrl?: string; footer?: string } = {},
  ): Promise<string | null> {
    return this.send({
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        ...(opts.headerImageUrl
          ? { header: { type: 'image', image: { link: opts.headerImageUrl } } }
          : {}),
        body: { text: body },
        ...(opts.footer ? { footer: { text: opts.footer } } : {}),
        action: {
          buttons: buttons.slice(0, 3).map((b) => ({
            type: 'reply',
            reply: { id: b.id, title: b.title.slice(0, 20) },
          })),
        },
      },
    });
  }

  async sendList(
    to: string,
    body: string,
    button: string,
    rows: Array<{ id: string; title: string; description?: string }>,
  ): Promise<string | null> {
    return this.send({
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: body },
        action: {
          button: button.slice(0, 20),
          sections: [{ title: 'Options', rows: rows.slice(0, 10) }],
        },
      },
    });
  }

  /** Fetch a media URL for a given media id (WhatsApp media expires after 5 min). */
  async getMediaUrl(mediaId: string): Promise<{ url: string; mimeType: string } | null> {
    try {
      const r = await axios.get<{ url: string; mime_type: string }>(
        `https://graph.facebook.com/v21.0/${mediaId}`,
        { headers: { Authorization: `Bearer ${this.config.getOrThrow('WHATSAPP_ACCESS_TOKEN')}` } },
      );
      return { url: r.data.url, mimeType: r.data.mime_type };
    } catch (e) {
      this.logger.error(`getMediaUrl failed for ${mediaId}: ${(e as Error).message}`);
      return null;
    }
  }

  /** Download the binary bytes for a media id (the URL needs the same bearer token). */
  async downloadMedia(mediaId: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
    if (mediaId.startsWith('TEST_')) {
      return this.testMedia.get(mediaId);
    }
    const meta = await this.getMediaUrl(mediaId);
    if (!meta) return null;
    const r = await axios.get<ArrayBuffer>(meta.url, {
      headers: { Authorization: `Bearer ${this.config.getOrThrow('WHATSAPP_ACCESS_TOKEN')}` },
      responseType: 'arraybuffer',
    });
    return { buffer: Buffer.from(r.data), mimeType: meta.mimeType };
  }

  private async send(payload: unknown): Promise<string | null> {
    try {
      const r = await this.http.post<{ messages: Array<{ id: string }> }>('/messages', payload);
      return r.data.messages?.[0]?.id ?? null;
    } catch (e) {
      const err = e as { response?: { data?: unknown }; message: string };
      this.logger.error(`send failed: ${err.message} ${JSON.stringify(err.response?.data)}`);
      return null;
    }
  }

  // Convenience: language-menu prompt
  buildLanguageMenu(): { body: string; rows: Array<{ id: string; title: string }> } {
    return {
      body: '🙏 Welcome to Kriya Mitra. Please choose your language:',
      rows: [
        { id: 'LANG_TA', title: 'தமிழ் (Tamil)' },
        { id: 'LANG_HI', title: 'हिन्दी (Hindi)' },
        { id: 'LANG_EN', title: 'English' },
        { id: 'LANG_TE', title: 'తెలుగు (Telugu)' },
        { id: 'LANG_KN', title: 'ಕನ್ನಡ (Kannada)' },
        { id: 'LANG_MR', title: 'मराठी (Marathi)' },
      ],
    };
  }
}

export type { Lang };
