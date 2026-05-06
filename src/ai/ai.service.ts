import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import {
  IMAGE_DIAGNOSIS_PROMPT,
  PRODUCT_PICK_PROMPT,
  SYSTEM_PROMPT,
  TRANSLATE_PROMPT,
} from './prompts';

export type VisionCandidate = {
  issue: string;
  type: 'pest' | 'disease' | 'deficiency' | 'stress';
  confidence: number;
  evidence: string;
};

export type VisionResult = {
  image_quality: 'good' | 'blurry' | 'too_dark' | 'too_far' | 'wrong_subject';
  crop_guess: string | null;
  affected_part: 'leaf' | 'stem' | 'fruit' | 'root' | 'whole_plant' | 'unknown';
  observations: string[];
  candidates: VisionCandidate[];
  needs_more_info: string[];
  severity_hint: 'low' | 'medium' | 'high' | 'critical';
};

export type ProductPickInput = {
  diagnosis: { crop: string; issue: string; severity: string; confidence: number };
  productContext: Array<{
    product_id: string;
    name: string;
    mapped_issues: string[];
    dosage: string;
    application: string;
    frequency: string;
    precautions: string[];
    certifications: string[];
  }>;
};

export type ProductPickResult =
  | { product_id: string; why_this_product: string; escalation_trigger: string }
  | { product_id: null; reason: string };

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly genAI: GoogleGenerativeAI;
  private readonly modelName: string;

  constructor(private readonly config: ConfigService) {
    this.genAI = new GoogleGenerativeAI(
      this.config.getOrThrow<string>('GEMINI_API_KEY'),
    );
    this.modelName = this.config.get<string>('GEMINI_MODEL') ?? 'gemini-2.0-flash';
  }

  /** Vision diagnosis on a base64-encoded crop photo. */
  async diagnoseImage(args: {
    imageBase64: string;
    mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
    cropHint?: string;
    farmerCaption?: string;
  }): Promise<VisionResult | null> {
    const userText = [
      args.cropHint ? `Crop reported by farmer: ${args.cropHint}` : 'Crop not specified.',
      args.farmerCaption ? `Farmer says: ${args.farmerCaption}` : '',
      'Diagnose the crop problem from this photo. Return JSON only.',
    ]
      .filter(Boolean)
      .join('\n');

    try {
      const model = this.modelFor({
        systemInstruction: `${SYSTEM_PROMPT}\n\n${IMAGE_DIAGNOSIS_PROMPT}`,
        json: true,
      });
      const result = await model.generateContent([
        { text: userText },
        { inlineData: { data: args.imageBase64, mimeType: args.mediaType } },
      ]);
      const text = result.response.text();
      const parsed = this.tryParseJson<VisionResult>(text);
      if (!parsed) {
        this.logger.warn(`vision JSON parse failed: ${text?.slice(0, 200)}`);
        return null;
      }
      return parsed;
    } catch (e) {
      this.logger.error(`vision call failed: ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * The model picks the best Kriya product from the candidate list.
   * IMPORTANT: dosage/frequency/precautions are never invented; rendered verbatim
   * from product_recommendations rows. Model only chooses which row + writes "why".
   */
  async pickProduct(input: ProductPickInput): Promise<ProductPickResult | null> {
    try {
      const model = this.modelFor({
        systemInstruction: `${SYSTEM_PROMPT}\n\n${PRODUCT_PICK_PROMPT}`,
        json: true,
      });
      const result = await model.generateContent(JSON.stringify(input));
      const text = result.response.text();
      return this.tryParseJson<ProductPickResult>(text);
    } catch (e) {
      this.logger.error(`pickProduct call failed: ${(e as Error).message}`);
      return null;
    }
  }

  /** Translate plain text. Numbers, units, product names are preserved. */
  async translate(text: string, sourceLang: string, targetLang: string): Promise<string> {
    if (sourceLang === targetLang) return text;
    try {
      const model = this.modelFor({});
      const result = await model.generateContent(
        TRANSLATE_PROMPT(sourceLang, targetLang, text),
      );
      return result.response.text().trim() || text;
    } catch (e) {
      this.logger.error(`translate failed: ${(e as Error).message}`);
      return text; // fail open: send original rather than nothing
    }
  }

  private modelFor(opts: { systemInstruction?: string; json?: boolean }): GenerativeModel {
    return this.genAI.getGenerativeModel({
      model: this.modelName,
      systemInstruction: opts.systemInstruction,
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 1024,
        ...(opts.json ? { responseMimeType: 'application/json' } : {}),
      },
    });
  }

  private tryParseJson<T>(text: string | null | undefined): T | null {
    if (!text) return null;
    const cleaned = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
    try {
      return JSON.parse(cleaned) as T;
    } catch {
      const m = cleaned.match(/\{[\s\S]*\}/);
      if (!m) return null;
      try {
        return JSON.parse(m[0]) as T;
      } catch {
        return null;
      }
    }
  }
}
