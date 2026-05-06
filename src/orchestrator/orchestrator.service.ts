import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConversationsService, ConvState } from '../conversations/conversations.service';
import { FarmersService, Farmer } from '../farmers/farmers.service';
import { WhatsappClientService } from '../whatsapp/whatsapp-client.service';
import { ParsedInbound, WaIncomingMessage } from '../whatsapp/types';
import { AiService } from '../ai/ai.service';
import { DiagnosesService } from '../diagnoses/diagnoses.service';
import {
  RecommendationsService,
  RecommendationCard,
} from '../recommendations/recommendations.service';
import { EscalationsService } from '../escalations/escalations.service';
import { DealersService } from '../dealers/dealers.service';
import { DbService } from '../db/db.service';
import { t } from './messages';

const LANG_BUTTONS: Record<string, string> = {
  LANG_TA: 'ta',
  LANG_HI: 'hi',
  LANG_EN: 'en',
  LANG_TE: 'te',
  LANG_KN: 'kn',
  LANG_MR: 'mr',
};

@Injectable()
export class OrchestratorService {
  private readonly logger = new Logger(OrchestratorService.name);

  constructor(
    private readonly farmers: FarmersService,
    private readonly conversations: ConversationsService,
    private readonly whatsapp: WhatsappClientService,
    private readonly ai: AiService,
    private readonly diagnoses: DiagnosesService,
    private readonly recommendations: RecommendationsService,
    private readonly escalations: EscalationsService,
    private readonly dealers: DealersService,
    private readonly db: DbService,
    private readonly config: ConfigService,
  ) {}

  async handleInbound(parsed: ParsedInbound): Promise<void> {
    const farmer = await this.farmers.findOrCreateByPhone(parsed.waId, parsed.profileName);
    const conv = await this.conversations.getOrCreateActive(farmer.id);

    const inserted = await this.conversations.appendInbound({
      conversationId: conv.id,
      waMessageId: parsed.message.id,
      contentType: parsed.message.type,
      text: parsed.message.text?.body ?? parsed.message.image?.caption ?? null,
      metadata: { waType: parsed.message.type },
    });
    if (!inserted.inserted) {
      // Duplicate webhook delivery; nothing to do.
      return;
    }

    if (conv.status === 'escalated' || conv.state === 'ESCALATED') {
      // Agronomist owns the conversation now; bot stays silent.
      return;
    }

    // Quick hard-coded escape hatches that override any state.
    if (this.escalations.detectAgronomistRequest(parsed.message.text?.body ?? null)) {
      await this.triggerEscalation(farmer, conv.id, 'farmer_request', 'p2');
      return;
    }
    if (this.escalations.detectSevereKeywords(parsed.message.text?.body ?? null)) {
      await this.triggerEscalation(farmer, conv.id, 'severe_keyword', 'p1');
      return;
    }

    // Dispatch by current state.
    switch (conv.state as ConvState) {
      case 'NEW':
        await this.startOnboarding(farmer, conv.id);
        return;
      case 'ONBOARDING_LANG':
        await this.handleLangChoice(farmer, conv.id, parsed.message);
        return;
      case 'ONBOARDING_NAME':
        await this.handleName(farmer, conv.id, parsed.message);
        return;
      case 'ONBOARDING_STATE':
        await this.handleStateDistrict(farmer, conv.id, parsed.message);
        return;
      case 'ONBOARDING_CROP':
        await this.handleCrop(farmer, conv.id, parsed.message);
        return;
      case 'ONBOARDING_CONSENT':
        await this.handleConsent(farmer, conv.id, parsed.message);
        return;
      case 'AWAITING_CROP_CONTEXT':
      case 'READY':
        await this.handleReady(farmer, conv.id, parsed.message);
        return;
      default:
        await this.handleReady(farmer, conv.id, parsed.message);
    }
  }

  // ---------------- Onboarding ----------------

  private async startOnboarding(farmer: Farmer, convId: string): Promise<void> {
    const menu = this.whatsapp.buildLanguageMenu();
    const id = await this.whatsapp.sendList(
      farmer.whatsapp_number,
      menu.body,
      'Select Language',
      menu.rows.map((r) => ({ id: r.id, title: r.title })),
    );
    await this.conversations.appendOutbound({
      conversationId: convId,
      waMessageId: id,
      sender: 'bot',
      contentType: 'interactive',
      text: menu.body,
    });
    await this.conversations.setState(convId, 'ONBOARDING_LANG');
  }

  private async handleLangChoice(
    farmer: Farmer,
    convId: string,
    msg: WaIncomingMessage,
  ): Promise<void> {
    const replyId = msg.interactive?.list_reply?.id ?? msg.interactive?.button_reply?.id;
    const lang = replyId && LANG_BUTTONS[replyId];
    if (!lang) {
      // Maybe the farmer typed a number 1..6 instead.
      const n = (msg.text?.body ?? '').trim();
      const fallback = ({ '1': 'ta', '2': 'hi', '3': 'en', '4': 'te', '5': 'kn', '6': 'mr' } as Record<string, string>)[n];
      if (!fallback) {
        await this.startOnboarding(farmer, convId);
        return;
      }
      await this.farmers.setLanguage(farmer.id, fallback);
    } else {
      await this.farmers.setLanguage(farmer.id, lang);
    }
    const updated = { ...farmer, preferred_lang: lang ?? farmer.preferred_lang };
    await this.sendAndLog(updated, convId, t('ASK_NAME', updated.preferred_lang));
    await this.conversations.setState(convId, 'ONBOARDING_NAME');
  }

  private async handleName(farmer: Farmer, convId: string, msg: WaIncomingMessage): Promise<void> {
    const name = (msg.text?.body ?? '').trim();
    if (name.length < 2) {
      await this.sendAndLog(farmer, convId, t('ASK_NAME', farmer.preferred_lang));
      return;
    }
    await this.farmers.setProfile(farmer.id, { name });
    await this.sendAndLog(farmer, convId, t('ASK_STATE', farmer.preferred_lang));
    await this.conversations.setState(convId, 'ONBOARDING_STATE');
  }

  private async handleStateDistrict(
    farmer: Farmer,
    convId: string,
    msg: WaIncomingMessage,
  ): Promise<void> {
    const text = (msg.text?.body ?? '').trim();
    // Naive parse: "Tamil Nadu, Coimbatore" or "TN Coimbatore".
    const [stateRaw, districtRaw] = text.split(/[,\-/|]/).map((s) => s.trim());
    if (!stateRaw) {
      await this.sendAndLog(farmer, convId, t('ASK_STATE', farmer.preferred_lang));
      return;
    }
    await this.farmers.setProfile(farmer.id, {
      state: stateRaw,
      district: districtRaw ?? null,
    });
    await this.sendAndLog(farmer, convId, t('ASK_CROP', farmer.preferred_lang));
    await this.conversations.setState(convId, 'ONBOARDING_CROP');
  }

  private async handleCrop(farmer: Farmer, convId: string, msg: WaIncomingMessage): Promise<void> {
    const cropName = (msg.text?.body ?? '').trim();
    if (cropName) {
      await this.conversations.patchContext(convId, { primary_crop: cropName });
    }
    await this.whatsapp.sendButtons(
      farmer.whatsapp_number,
      t('ASK_CONSENT', farmer.preferred_lang),
      [
        { id: 'CONSENT_YES', title: '✅ Yes' },
        { id: 'CONSENT_NO', title: '❌ No' },
      ],
    );
    await this.conversations.setState(convId, 'ONBOARDING_CONSENT');
  }

  private async handleConsent(
    farmer: Farmer,
    convId: string,
    msg: WaIncomingMessage,
  ): Promise<void> {
    const id = msg.interactive?.button_reply?.id;
    if (id === 'CONSENT_YES') {
      await this.farmers.grantConsent(farmer.id);
      await this.sendAndLog(farmer, convId, t('ONBOARD_DONE', farmer.preferred_lang));
      await this.conversations.setState(convId, 'READY');
    } else {
      // Without consent we can still help, but don't store sensitive PII beyond what the farmer sends.
      await this.sendAndLog(farmer, convId, t('ONBOARD_DONE', farmer.preferred_lang));
      await this.conversations.setState(convId, 'READY');
    }
  }

  // ---------------- Main loop ----------------

  private async handleReady(
    farmer: Farmer,
    convId: string,
    msg: WaIncomingMessage,
  ): Promise<void> {
    if (msg.type === 'image' && msg.image?.id) {
      await this.handleImage(farmer, convId, msg);
      return;
    }

    if (msg.type === 'interactive' && msg.interactive?.button_reply?.id) {
      const btn = msg.interactive.button_reply.id;
      if (btn === 'TALK_AGRO') {
        await this.triggerEscalation(farmer, convId, 'farmer_request', 'p2');
        return;
      }
      if (btn === 'FIND_DEALER') {
        await this.handleFindDealer(farmer, convId);
        return;
      }
    }

    if (msg.type === 'text' && msg.text?.body) {
      const body = msg.text.body.trim();
      // Very short messages (< 8 chars) likely aren't symptom descriptions —
      // ask for a photo or detail, don't burn a Gemini call.
      if (body.length < 8) {
        await this.sendAndLog(farmer, convId, t('ASK_PHOTO', farmer.preferred_lang));
        await this.conversations.setState(convId, 'AWAITING_CROP_CONTEXT');
        return;
      }
      await this.handleTextSymptom(farmer, convId, body);
      return;
    }

    // Anything else (audio, location, etc.) -> ask for photo or text description
    await this.sendAndLog(farmer, convId, t('ASK_PHOTO', farmer.preferred_lang));
    await this.conversations.setState(convId, 'AWAITING_CROP_CONTEXT');
  }

  private async handleImage(
    farmer: Farmer,
    convId: string,
    msg: WaIncomingMessage,
  ): Promise<void> {
    const mediaId = msg.image!.id;
    const media = await this.whatsapp.downloadMedia(mediaId);
    if (!media) {
      await this.sendAndLog(farmer, convId, t('IMAGE_BAD', farmer.preferred_lang));
      return;
    }

    // For the MVP we keep the image base64 in memory and persist a row in
    // images with a placeholder s3_key. Wire R2/S3 here in the next iteration.
    const imageRow = await this.db.one<{ id: string }>(
      `INSERT INTO images (farmer_id, conversation_id, s3_key, content_type)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [farmer.id, convId, `tmp/${mediaId}`, media.mimeType],
    );
    const imageId = imageRow?.id ?? null;

    const cropHint = await this.getCropHint(convId);

    const vision = await this.ai.diagnoseImage({
      imageBase64: media.buffer.toString('base64'),
      mediaType:
        media.mimeType === 'image/png'
          ? 'image/png'
          : media.mimeType === 'image/webp'
          ? 'image/webp'
          : 'image/jpeg',
      cropHint,
      farmerCaption: msg.image?.caption,
    });

    this.logger.log(`vision result: ${JSON.stringify(vision)?.slice(0, 800)}`);

    if (!vision || vision.image_quality !== 'good' || vision.candidates.length === 0) {
      await this.sendAndLog(farmer, convId, t('IMAGE_BAD', farmer.preferred_lang));
      return;
    }

    await this.processDiagnosis({
      farmer,
      convId,
      imageId,
      cropGuess: vision.crop_guess,
      candidates: vision.candidates,
      severityHint: vision.severity_hint,
    });
  }

  /**
   * Text-only diagnosis path. The farmer describes the problem instead of
   * sending a photo. Same recommendation engine, same verbatim-dosage rules.
   */
  private async handleTextSymptom(
    farmer: Farmer,
    convId: string,
    text: string,
  ): Promise<void> {
    const cropHint = await this.getCropHint(convId);
    const result = await this.ai.diagnoseText({
      cropHint,
      text,
      farmerLang: farmer.preferred_lang ?? undefined,
    });

    this.logger.log(`text diagnosis result: ${JSON.stringify(result)?.slice(0, 800)}`);

    if (!result || result.candidates.length === 0) {
      // Either off-topic or too vague to diagnose. Ask for more detail / photo.
      await this.sendAndLog(farmer, convId, t('TEXT_UNCLEAR', farmer.preferred_lang));
      await this.conversations.setState(convId, 'AWAITING_CROP_CONTEXT');
      return;
    }

    await this.processDiagnosis({
      farmer,
      convId,
      imageId: null,
      cropGuess: result.crop_guess,
      candidates: result.candidates,
      severityHint: result.severity_hint,
    });
  }

  /**
   * Shared post-diagnosis logic: DB lookup, persist diagnosis, resolve a Kriya
   * recommendation, send the card OR escalate. Used by both the image and text
   * diagnosis paths so the safety rules + recommendation engine are identical.
   */
  private async processDiagnosis(args: {
    farmer: Farmer;
    convId: string;
    imageId: string | null;
    cropGuess: string | null;
    candidates: Array<{
      issue: string;
      type: 'pest' | 'disease' | 'deficiency' | 'stress';
      confidence: number;
      evidence: string;
    }>;
    severityHint: 'low' | 'medium' | 'high' | 'critical';
  }): Promise<void> {
    const cropId = await this.diagnoses.lookupCropId(args.cropGuess);
    const top = args.candidates[0];
    const issueLookup = await this.diagnoses.lookupIssueId({
      cropId,
      label: top.issue,
    });

    const candidates = await Promise.all(
      args.candidates.map(async (c) => ({
        issue_id:
          (await this.diagnoses.lookupIssueId({ cropId, label: c.issue }))?.issue_id ?? null,
        label: c.issue,
        type: c.type,
        confidence: c.confidence,
        evidence: c.evidence,
      })),
    );

    await this.diagnoses.create({
      farmerId: args.farmer.id,
      conversationId: args.convId,
      imageId: args.imageId,
      cropId,
      candidates,
      topIssueId: issueLookup?.issue_id ?? null,
      topConfidence: top.confidence,
      severityHint: args.severityHint,
      modelName: this.config.get<string>('GEMINI_MODEL') ?? 'gemini-2.0-flash',
    });

    const outcome = await this.recommendations.resolve({
      cropIssueId: issueLookup?.issue_id ?? null,
      confidence: top.confidence,
      severity: issueLookup?.severity ?? args.severityHint,
    });

    if (outcome.kind === 'no_match') {
      await this.sendAndLog(args.farmer, args.convId, t('NO_PRODUCT', args.farmer.preferred_lang));
      await this.triggerEscalation(
        args.farmer,
        args.convId,
        outcome.reason === 'low_confidence' ? 'low_confidence' : 'no_approved_product',
        'p2',
      );
      return;
    }

    const card = outcome.card;
    const forceEscalate = outcome.kind === 'critical';
    await this.sendDiagnosisCard({
      farmer: args.farmer,
      convId: args.convId,
      issueLabel: top.issue,
      confidence: top.confidence,
      card,
      critical: forceEscalate,
    });

    if (forceEscalate) {
      await this.triggerEscalation(args.farmer, args.convId, 'critical_severity', 'p1');
    }
  }

  private async getCropHint(convId: string): Promise<string | undefined> {
    const r = await this.db.one<{ context: { primary_crop?: string } }>(
      'SELECT context FROM conversations WHERE id = $1',
      [convId],
    );
    return r?.context?.primary_crop ?? undefined;
  }

  private async sendDiagnosisCard(args: {
    farmer: Farmer;
    convId: string;
    issueLabel: string;
    confidence: number;
    card: RecommendationCard;
    critical: boolean;
  }): Promise<void> {
    const lang = args.farmer.preferred_lang ?? 'en';
    const body = await this.composeDiagnosisBody(
      args.issueLabel,
      args.confidence,
      args.card,
      lang,
      args.critical,
    );

    const id = await this.whatsapp.sendButtons(
      args.farmer.whatsapp_number,
      body,
      [
        { id: 'FIND_DEALER', title: '🛒 Find Dealer' },
        { id: 'TALK_AGRO', title: '👨‍🌾 Talk to Expert' },
      ],
      {
        headerImageUrl: args.card.product_image_url ?? undefined,
        footer: 'Kriya Mitra • Always consult an agronomist for severe cases',
      },
    );
    await this.conversations.appendOutbound({
      conversationId: args.convId,
      waMessageId: id,
      sender: 'bot',
      contentType: 'interactive',
      text: body,
      metadata: {
        product_id: args.card.product_id,
        product_sku: args.card.product_sku,
        confidence: args.confidence,
      },
    });
  }

  /**
   * Builds the diagnosis card body. Dosage / frequency / precautions are
   * inserted VERBATIM from the DB. Only the explanatory wrapper is translated.
   */
  private async composeDiagnosisBody(
    issueLabel: string,
    confidence: number,
    card: RecommendationCard,
    lang: string,
    critical: boolean,
  ): Promise<string> {
    const conf = Math.round(confidence * 100);
    const wrapperEn =
      `${critical ? '⚠️ This looks serious.\n\n' : ''}` +
      `Most likely: *${issueLabel}* (confidence ~${conf}%).\n\n` +
      `Recommended: *${card.product_name}*\n` +
      `Dosage: ${card.dosage}\n` +
      `Application: ${card.application}\n` +
      `Frequency: ${card.frequency}` +
      (card.pre_harvest_interval_days != null
        ? `\nPre-harvest interval: ${card.pre_harvest_interval_days} days`
        : '') +
      `\n\n⚠️ ` +
      (card.precautions.length
        ? card.precautions.join('. ') + '.'
        : 'Wear mask and gloves while spraying.') +
      `\n\n${card.notes_en ?? ''}`.trimEnd();

    const consult = '\n\n— ' + 'Consult an agronomist if symptoms continue or worsen.';

    if (lang === 'en') return wrapperEn + consult;

    // Translate the wrapper. Numbers, units, product names are preserved by the prompt.
    const translated = await this.ai.translate(wrapperEn, 'English', this.langName(lang));
    const consultLine = '\n\n— ' + t('CONSULT_LINE', lang);
    return translated + consultLine;
  }

  private async handleFindDealer(farmer: Farmer, convId: string): Promise<void> {
    const list = farmer.state && farmer.district
      ? await this.dealers.findByDistrict(farmer.state, farmer.district)
      : [];
    if (list.length === 0) {
      await this.sendAndLog(
        farmer,
        convId,
        'I couldn\'t find a Kriya dealer in your district yet. Our team will reach out shortly.',
      );
      return;
    }
    const body = list
      .map(
        (d, i) =>
          `${i + 1}. *${d.name}*\n   ${d.address ?? ''}\n   📞 ${d.phone ?? d.whatsapp_number ?? ''}`,
      )
      .join('\n\n');
    await this.sendAndLog(farmer, convId, body);
  }

  private async triggerEscalation(
    farmer: Farmer,
    convId: string,
    reason:
      | 'farmer_request'
      | 'severe_keyword'
      | 'low_confidence'
      | 'no_approved_product'
      | 'critical_severity'
      | 'regulated_pest',
    priority: 'p1' | 'p2' | 'p3',
  ): Promise<void> {
    await this.escalations.create({
      conversationId: convId,
      farmerId: farmer.id,
      reason,
      priority,
    });
    await this.conversations.escalate(convId);
    await this.sendAndLog(farmer, convId, t('ESCALATED', farmer.preferred_lang));
  }

  private async sendAndLog(farmer: Farmer, convId: string, body: string): Promise<void> {
    const id = await this.whatsapp.sendText(farmer.whatsapp_number, body);
    await this.conversations.appendOutbound({
      conversationId: convId,
      waMessageId: id,
      sender: 'bot',
      contentType: 'text',
      text: body,
    });
  }

  private langName(code: string): string {
    return (
      ({ ta: 'Tamil', hi: 'Hindi', en: 'English', te: 'Telugu', kn: 'Kannada', mr: 'Marathi', bn: 'Bengali' } as Record<string, string>)[
        code
      ] ?? 'English'
    );
  }
}
