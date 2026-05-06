import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.string().default('info'),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),

  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1),
  WHATSAPP_ACCESS_TOKEN: z.string().min(1),
  WHATSAPP_VERIFY_TOKEN: z.string().min(8),
  WHATSAPP_APP_SECRET: z.string().min(1),

  GEMINI_API_KEY: z.string().min(1),
  GEMINI_MODEL: z.string().default('gemini-2.0-flash'),

  // Groq is used for text diagnosis + translation (high-frequency ops).
  // Vision stays on Gemini. Groq's free tier has 14400 RPD vs Gemini's 1000.
  GROQ_API_KEY: z.string().min(1),
  GROQ_TEXT_MODEL: z.string().default('llama-3.3-70b-versatile'),

  S3_ENDPOINT: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_BUCKET: z.string().default('kriya-mitra-media'),
  S3_REGION: z.string().default('auto'),

  DIAGNOSIS_CONFIDENCE_THRESHOLD: z.coerce.number().default(0.6),
  DIAGNOSIS_AUTO_RECOMMEND_THRESHOLD: z.coerce.number().default(0.75),
});

export type AppConfig = z.infer<typeof schema>;

export function loadConfig(): AppConfig {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error('Invalid environment configuration:', parsed.error.format());
    throw new Error('Invalid environment configuration');
  }
  return parsed.data;
}
