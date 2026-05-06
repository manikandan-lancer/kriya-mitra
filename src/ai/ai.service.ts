import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import Groq from 'groq-sdk';
import {
  IMAGE_DIAGNOSIS_PROMPT,
  PRODUCT_PICK_PROMPT,
  SYSTEM_PROMPT,
  TEXT_DIAGNOSIS_PROMPT,
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

export type TextDiagnosisResult = {
  crop_guess: string | null;
  candidates: VisionCandidate[];
  needs_more_info: string[];
  severity_hint: 'low' | 'medium' | 'high' | 'critical';
};

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly genAI: GoogleGenerativeAI;
  private readonly modelName: string;
  private readonly groq: Groq;
  private readonly groqModel: string;

  constructor(private readonly config: ConfigService) {
    this.genAI = new GoogleGenerativeAI(
      this.config.getOrThrow<string>('GEMINI_API_KEY'),
    );
    this.modelName = this.config.get<string>('GEMINI_MODEL') ?? 'gemini-2.0-flash';

    this.groq = new Groq({
      apiKey: this.config.getOrThrow<string>('GROQ_API_KEY'),
    });
    this.groqModel = this.config.get<string>('GROQ_TEXT_MODEL') ?? 'llama-3.3-70b-versatile';
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
   * Text-only diagnosis. Used when the farmer types a description (no photo).
   * Routed to Groq (Llama 3.3 70B) for higher free-tier headroom (14k RPD vs
   * Gemini's 1k RPD). Vision still uses Gemini.
   */
  async diagnoseText(args: {
    cropHint?: string;
    text: string;
    farmerLang?: string;
  }): Promise<TextDiagnosisResult | null> {
    const userText = [
      args.cropHint ? `Crop reported by farmer: ${args.cropHint}` : 'Crop not specified.',
      args.farmerLang ? `Farmer's preferred language: ${args.farmerLang}` : '',
      `Farmer says: "${args.text}"`,
      'Diagnose the crop problem from this description. Return JSON only.',
    ]
      .filter(Boolean)
      .join('\n');

    try {
      const r = await this.groq.chat.completions.create({
        model: this.groqModel,
        messages: [
          { role: 'system', content: `${SYSTEM_PROMPT}\n\n${TEXT_DIAGNOSIS_PROMPT}` },
          { role: 'user', content: userText },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
        max_tokens: 800,
      });
      const content = r.choices[0]?.message?.content;
      const parsed = this.tryParseJson<TextDiagnosisResult>(content);
      if (!parsed) {
        this.logger.warn(`text diagnosis JSON parse failed: ${content?.slice(0, 200)}`);
        return null;
      }
      return parsed;
    } catch (e) {
      this.logger.error(`text diagnosis (groq) failed: ${(e as Error).message}`);
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

  /**
   * Translate plain text. Numbers, units, product names are preserved.
   * Routed to Groq for the same headroom reason as text diagnosis.
   */
  async translate(text: string, sourceLang: string, targetLang: string): Promise<string> {
    if (sourceLang === targetLang) return text;
    try {
      const r = await this.groq.chat.completions.create({
        model: this.groqModel,
        messages: [
          { role: 'user', content: TRANSLATE_PROMPT(sourceLang, targetLang, text) },
        ],
        temperature: 0.3,
        max_tokens: 800,
      });
      return r.choices[0]?.message?.content?.trim() || text;
    } catch (e) {
      this.logger.error(`translate (groq) failed: ${(e as Error).message}`);
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
