# Kriya Mitra — Farmer WhatsApp Bot Backend

NestJS backend for the Kriya Ltd. farmer assistant. Receives WhatsApp messages,
runs vision diagnosis with Claude, looks up the approved Kriya product, and
escalates to a human agronomist when needed.

## Quick start

```bash
# 1. Install
npm install

# 2. Bring up Postgres + Redis
npm run db:up

# 3. Configure env
cp .env.example .env
# fill in WHATSAPP_*, ANTHROPIC_API_KEY at minimum

# 4. Run migrations + seed
npm run db:migrate

# 5. Run
npm run start:dev
```

## Layout

```
migrations/   raw SQL migrations (run in lex order)
scripts/      ops scripts (migrate)
src/
  ai/             Claude wrapper + system / vision / product / translate prompts
  conversations/  conversation + message persistence
  db/             pg pool wrapper (no ORM)
  dealers/        dealer lookup (district + nearest)
  diagnoses/      diagnosis writes + crop/issue lookup
  escalations/    escalation queue + keyword detectors
  farmers/        farmer onboarding model
  orchestrator/   the state machine that ties it all together
  products/       admin CRUD
  recommendations/  the safety-critical engine + admin CRUD
  whatsapp/       webhook controller (verify + signature) and Graph API client
```

## Hard rules baked into the code

1. The bot only serves rows from `product_recommendations` where
   `approved_by IS NOT NULL AND is_active = TRUE`.
2. `dosage`, `application`, `frequency`, `precautions` are rendered VERBATIM
   from the DB. The LLM cannot mutate them — see
   `recommendations.service.ts::resolve` and
   `orchestrator.service.ts::composeDiagnosisBody`.
3. If diagnosis confidence < `DIAGNOSIS_CONFIDENCE_THRESHOLD`, the bot
   refuses to recommend and escalates to an agronomist instead.
4. If severity is `critical`, the recommendation is paired with a forced
   handoff (`triggerEscalation` is always called).
5. WhatsApp signature is verified with `crypto.timingSafeEqual` before any
   processing. Invalid signatures are silently dropped.

## Pointing WhatsApp at a local dev box

1. Run `npm run start:dev`.
2. Tunnel the port: `ngrok http 3000`.
3. In Meta Business Manager → WhatsApp → Configuration → Webhooks:
   - Callback URL: `https://<ngrok>.ngrok-free.app/webhooks/whatsapp`
   - Verify token: same as `WHATSAPP_VERIFY_TOKEN` in `.env`
4. Subscribe to `messages`.

## What's not yet wired

- S3 / R2 image upload — the orchestrator stores a placeholder `s3_key`. Drop
  in `@aws-sdk/client-s3` and replace `tmp/${mediaId}` in
  `orchestrator.service.ts::handleImage`.
- pgvector RAG over the disease KB — schema and embedding column exist;
  embedding generation + cosine search to be added in Phase 2.
- Bhashini STT for audio messages.
- Auth on the admin endpoints (`/api/products`, `/api/recommendations`).
- A Next.js admin panel.
