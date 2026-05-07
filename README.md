# Kriya Mitra — Farmer WhatsApp Bot

Multilingual AI-powered WhatsApp bot for Indian farmers. Diagnoses crop pests, diseases, and deficiencies from a photo OR text description, and recommends Kriya Biosys's approved organic biological products.

Built as a $0 prototype on free-tier services. Validated end-to-end with real WhatsApp message delivery.

**Live at:** `https://kriya-mitra.onrender.com`
**WhatsApp number (test):** +1 (555) 645-6725
**GitHub:** `github.com/manikandan-lancer/kriya-mitra`

---

## What's working today

- ✅ **Multilingual onboarding** — Tamil, Hindi, English, Telugu, Kannada, Marathi
- ✅ **Text diagnosis** — farmer describes problem → Groq Llama 3.3 70B identifies issue
- ✅ **Image diagnosis** — farmer sends photo → Gemini Flash analyses; falls back to text if photo is unclear and a caption is provided
- ✅ **Verbatim-dosage recommendations** — bot only serves dosages signed off by Kriya agronomists
- ✅ **Safety escalation** — severe keywords + low confidence + critical severity all route to a human
- ✅ **Cloud-deployed on Render** with permanent URL, auto-deploy on `git push`
- ✅ **DPDP-compliant consent flow** during onboarding
- ✅ **CSV import** for the agronomy team to add real product data (`npm run import:recs`)

---

## What's pending for real launch

These are paperwork + ops tasks, not engineering. Each unblocks a specific capability.

| Task | Owner | Time | Unblocks |
|---|---|---|---|
| **Business Verification** with Meta | Kriya leadership (legal docs) | 1–7 day Meta review | App publication |
| **Display Name** "Kriya Mitra" approval | Kriya | 1–3 day review | Custom contact name (replaces "Test Number") |
| **App Publication** in Meta | Click after the above | Immediate | Real-phone messages reach webhook |
| **Real WhatsApp Business number** | Kriya buys SIM in company name | ~2 days | Removes 5-recipient cap; serves unlimited farmers |
| **Custom profile picture** (Kriya logo) | API call once on real number | 5 min | Branded contact card |
| **Filled CSV from agronomy team** | Kriya agronomist | Days–weeks | Bot recommends real products instead of escalating |
| **Cloudflare R2 image storage** | Engineering | ~30 min | Persist farmer photos for QA review |
| **Admin auth** on `/api/*` | Engineering | ~30 min | Lock down product CRUD endpoints |
| **Admin panel** (Retool / Next.js) | Engineering | ~2 hrs | Visual ops console |

See the **Path to production** section below for step-by-step instructions on each.

---

## Architecture

```
                 WhatsApp (Meta Cloud API)
                    │   ▲
              webhooks   send messages
                    ▼   │
            ┌──────────────────┐
            │   Render (NestJS)  │
            │   Singapore        │
            └─────┬────┬────┬───┘
                  │    │    │
       ┌──────────┘    │    └──────────┐
       ▼               ▼               ▼
   Neon Postgres    Groq Llama       Gemini Flash
   (Singapore)      3.3 70B          (vision)
   farmers, convs,  text diagnosis,
   diagnoses, recs  translation
```

**Hosting:** Render (Singapore, free tier) with UptimeRobot keepalive
**Database:** Neon Postgres (Singapore, free tier)
**AI vision:** Google Gemini 1.5 Flash 8B (free tier, 1.5k req/day)
**AI text:** Groq Llama 3.3 70B (free tier, 14.4k req/day)
**Source control:** GitHub `manikandan-lancer/kriya-mitra` — main branch auto-deploys to Render

---

## Repository layout

```
data/
  recommendations-template.csv   sample CSV with 5 example rows
migrations/
  001_initial_schema.sql         all tables, indexes, triggers
  002_seed_minimal.sql           5 crops × 3 issues × 3 products + 1 dealer
scripts/
  migrate.ts                     idempotent SQL migration runner
  test-webhook.ts                local webhook simulator (signs payloads with HMAC)
  import-recommendations.ts      bulk import + upsert from CSV
src/
  ai/
    ai.service.ts                Gemini (vision) + Groq (text/translate) wrapper
    prompts.ts                   system + image + text + product + translate prompts
  conversations/                 message + state persistence (Postgres)
  db/                            pg pool wrapper (no ORM)
  dealers/                       district + haversine nearest lookup
  diagnoses/                     diagnosis writes + crop/issue label matcher
  escalations/                   queue + multilingual keyword detectors
  farmers/                       create/find by phone, language, profile patches
  orchestrator/                  state machine (the heart of the bot)
    orchestrator.service.ts      onboarding, text diag, image diag, escalation
    messages.ts                  i18n strings for all 6 languages
  products/                      CRUD endpoints
  recommendations/
    recommendations.service.ts   safety-critical: confidence + severity + approved
    recommendations.controller.ts admin CRUD + approve action
  whatsapp/
    webhook.controller.ts        verify + HMAC signature check + dispatch
    whatsapp-client.service.ts   send text/buttons/list, download media
    test-media.controller.ts     local-only image cache for the test script
Dockerfile                       multi-stage Node 20 build
fly.toml                         (unused — kept for if we migrate from Render)
.env.example                     template for required env vars
```

---

## Hard rules baked into the code

These are deliberate safety choices. Don't remove them without understanding why.

1. **The LLM cannot modify dosage.** `dosage`, `application`, `frequency`, `precautions` render VERBATIM from `product_recommendations` rows. The AI only chooses *which row*. See [src/recommendations/recommendations.service.ts](src/recommendations/recommendations.service.ts) and [src/orchestrator/orchestrator.service.ts:composeDiagnosisBody](src/orchestrator/orchestrator.service.ts).

2. **Drafts never serve.** Rows where `approved_by IS NULL` are filtered out by the recommendation engine. The Kriya agronomy team must explicitly sign off.

3. **Confidence threshold escalates.** If diagnosis confidence < `DIAGNOSIS_CONFIDENCE_THRESHOLD` (default 0.6), the bot refuses to recommend and escalates to an agronomist.

4. **Critical severity forces handoff.** Even with an approved match, if severity is `critical`, the recommendation is paired with a forced agronomist escalation.

5. **Severe keywords pre-filter.** Phrases like "many plants dying", "spreading fast", "poora khet" trigger immediate human escalation before any AI runs. See `escalations.service.ts::detectSevereKeywords`.

6. **Webhook signatures verified.** Every inbound webhook's HMAC is verified against `WHATSAPP_APP_SECRET` using `crypto.timingSafeEqual` before processing. Invalid signatures are silently dropped (returns 200 to Meta but processes nothing).

---

## Local development

### Prerequisites

- Node 20+
- Git
- Free accounts: Neon, Groq, Google AI Studio, Meta Business

### One-time setup

```powershell
git clone https://github.com/manikandan-lancer/kriya-mitra.git
cd kriya-mitra
npm install
cp .env.example .env
# Fill in real values (see env vars section below)
npm run db:migrate
```

### Run locally

```powershell
npx nest build
node dist/main.js
```

Should print `Kriya Mitra backend listening on :3000`.

> **OneDrive note:** if the project is in a OneDrive-synced folder, `nest start --watch` can hang indefinitely. Use the build + run combo above instead.

### Test the bot WITHOUT involving Meta

The local test webhook script signs synthetic payloads with your `WHATSAPP_APP_SECRET` and POSTs them to your bot. Bypasses Meta entirely. Outbound replies still go to your real WhatsApp number (the recipient must be allowlisted in Meta API Setup).

```powershell
# Point at local server OR production
$env:TEST_BASE_URL = "http://localhost:3000"
# or: $env:TEST_BASE_URL = "https://kriya-mitra.onrender.com"

# Onboard
npm run test:webhook -- text "Hi"
npm run test:webhook -- list LANG_EN English
npm run test:webhook -- text "Ramesh"
npm run test:webhook -- text "Tamil Nadu, Coimbatore"
npm run test:webhook -- text "tomato"
npm run test:webhook -- button CONSENT_YES Yes

# Now in READY state — test diagnoses
npm run test:webhook -- text "tomato leaves curling, white insects underneath, sticky honeydew"
npm run test:webhook -- image .\sample-leaf.jpg "tomato problem"
```

Each command produces a real WhatsApp message on the allowlisted phone within a few seconds.

---

## Deploying

The repo's `main` branch auto-deploys to Render on every `git push`. To ship a change:

```powershell
git add .
git commit -m "describe what changed"
git push
```

Render rebuilds (Dockerfile) and redeploys in ~3 min. Watch progress in `dashboard.render.com`.

**Health check:** `/api/products` (must return 200 within timeout)
**Region:** Singapore
**Instance:** Free tier (512 MB RAM, 0.1 vCPU, spins down after 15 min idle — but UptimeRobot pings it every 5 min to keep warm)

---

## Adding Kriya agronomy data

**The bot does not recommend anything that hasn't been signed off by Kriya's agronomy team.** This is the single most important data dependency for the bot to be useful.

### Workflow

1. Send `data/recommendations-template.csv` to Kriya's agronomy lead.
2. They open it in Google Sheets, fill in real dosages for each (crop × disease × Kriya product) combination, and put their name in the `approved_by` column to sign each row.
3. They export back to CSV and send to engineering.
4. Run import:
   ```powershell
   npm run import:recs -- data/from-kriya-team.csv --dry-run   # validate first
   npm run import:recs -- data/from-kriya-team.csv             # actually import
   ```
5. The bot picks up new approved rows immediately. No redeploy needed.

The script is **idempotent** — re-running with the same CSV updates only changed rows. Safe to iterate.

### CSV schema

See `data/recommendations-template.csv` for the exact columns. Required: `crop_slug`, `crop_name_en`, `issue_slug`, `issue_name_en`, `issue_type`, `issue_severity`, `product_sku`, `product_name`, `dosage`, `application`, `frequency`. Symptoms and precautions use semicolon-separated lists.

---

## Environment variables

| Var | Required? | Where to get |
|---|---|---|
| `NODE_ENV` | Yes | `production` for deploy, `development` for local |
| `PORT` | Default 3000 | — |
| `DATABASE_URL` | Yes | Neon dashboard → connection details |
| `WHATSAPP_PHONE_NUMBER_ID` | Yes | Meta App Dashboard → WhatsApp → API Setup |
| `WHATSAPP_ACCESS_TOKEN` | Yes | Generate **permanent** System User token (see Path to Production §1) |
| `WHATSAPP_VERIFY_TOKEN` | Yes (≥8 chars) | Random string you choose; same value in Meta's webhook config |
| `WHATSAPP_APP_SECRET` | Yes | Meta App Settings → Basic → Show |
| `GEMINI_API_KEY` | Yes | aistudio.google.com/apikey (free) |
| `GEMINI_MODEL` | Default `gemini-2.0-flash` | Switch to `gemini-1.5-flash-8b` if hitting rate limits |
| `GROQ_API_KEY` | Yes | console.groq.com/keys (free, no card) |
| `GROQ_TEXT_MODEL` | Default `llama-3.3-70b-versatile` | — |
| `DIAGNOSIS_CONFIDENCE_THRESHOLD` | Default 0.6 | Lower = more recommendations, fewer escalations |

For production deploy, set all of these in **Render dashboard → Environment** (NOT in `.env`, which is gitignored).

---

## API endpoints

### Public (Meta webhook)

- `GET /webhooks/whatsapp` — Meta verification handshake
- `POST /webhooks/whatsapp` — Inbound message webhook

### Internal (no auth currently — see Future Enhancements)

- `GET /api/products` — list products (also used as health check)
- `GET /api/products/:id` — single product
- `POST /api/products` — create
- `PATCH /api/products/:id` — update
- `DELETE /api/products/:id` — soft-delete
- `GET /api/recommendations` — list (with filters: `crop_issue_id`, `approved=true|false`)
- `POST /api/recommendations` — create
- `PATCH /api/recommendations/:id` — update
- `POST /api/recommendations/:id/approve` — sign off (sets `approved_by` + `approved_at`)
- `DELETE /api/recommendations/:id`

### Test-only

- `POST /test/media` — upload an image, returns a `TEST_<uuid>` mediaId for use in synthetic webhooks

---

## Path to production

Step-by-step instructions for moving this from a prototype to a real product. Each step blocks the next.

### Step 1 — Generate a permanent WhatsApp access token (5 min)

Done already if you got messages working. If you ever need a fresh one:
1. https://business.facebook.com/latest/settings/system_users
2. Add System User → role: Admin → name: `kriya-mitra-bot`
3. Add Assets → Apps → tick `kriya-mitra-dev`, toggle `Manage app`
4. Add Assets → WhatsApp Accounts → tick the WABA, toggle `Full control`
5. Generate new token → app: `kriya-mitra-dev`, expiration: **Never**, permissions: `whatsapp_business_management` + `whatsapp_business_messaging`
6. Copy `EAA…` immediately — Meta won't show it again
7. Update `WHATSAPP_ACCESS_TOKEN` in Render env vars → Save → auto-redeploys

### Step 2 — Set up Privacy Policy URL (10 min)

Already done — Notion page set in Meta App Settings → Basic. Update if Kriya's privacy policy changes.

### Step 3 — Submit Business Verification (15 min for you, 1–7 days for Meta)

1. https://business.facebook.com/latest/settings/business_info
2. Click **Start Verification**
3. Required documents (PDF/JPG, English):
   - Certificate of Incorporation **OR** GST Certificate **OR** Partnership Deed **OR** Trade License
   - Proof of address (utility bill / bank statement / rent agreement) in business name, < 90 days old
4. Legal name + address must match documents EXACTLY (down to punctuation)
5. Submit. Email arrives when approved or rejected.

### Step 4 — Submit Display Name "Kriya Mitra" (5 min, 1–3 days review)

Business Settings → Accounts → WhatsApp Accounts → click WABA → Display Name → submit `Kriya Mitra`. Most natural names auto-approve quickly.

### Step 5 — Add a real Kriya phone number (~2 days end-to-end)

Wait for Step 3 approval, then:
1. Buy a SIM in Kriya Biosys's name. Number must NOT currently be on regular WhatsApp.
2. https://business.facebook.com/wa/manage/phone-numbers/ → Add phone number
3. Enter the new number → choose SMS or Voice → enter OTP
4. Update env vars in Render: `WHATSAPP_PHONE_NUMBER_ID` to the new ID (visible in API Setup page)

The new number can serve unlimited users — no 5-recipient cap.

### Step 6 — Publish the app (5 min after Steps 3+4 approved)

App Dashboard → Publish (left sidebar) → all requirements should now be green → click **Publish**. App moves from "In development" to "Live". **Real-phone messages now reach the webhook directly.**

### Step 7 — Set custom profile picture and business profile (10 min)

Once on the real number:

```powershell
# Upload Kriya logo as profile picture
curl.exe -X POST "https://graph.facebook.com/v21.0/<NEW_PHONE_ID>/whatsapp_business_profile" `
  -H "Authorization: Bearer <TOKEN>" `
  -H "Content-Type: application/json" `
  -d '{
    "messaging_product": "whatsapp",
    "about": "AI crop advisor by Kriya Biosys",
    "description": "Get instant diagnosis for crop pests, diseases, and deficiencies. Recommendations for Kriya organic biological products.",
    "email": "support@kriya.ltd",
    "websites": ["https://www.kriya.ltd"],
    "address": "Coimbatore, Tamil Nadu, India",
    "vertical": "AGRICULTURE"
  }'
```

For the actual profile picture, use the Resumable Upload API (separate flow — see Meta docs on `whatsapp_business_profile.profile_picture_handle`).

### Step 8 — Onboard real Kriya dealers

Either run SQL inserts directly:
```sql
INSERT INTO dealers (name, phone, whatsapp_number, address, state, district, pincode, lat, lng, is_active)
VALUES ('Kriya Agri Centre - Erode', '+919876500002', '+919876500002', '...', 'Tamil Nadu', 'Erode', '638001', 11.341, 77.717, TRUE);
```
…or build the admin panel (Future Enhancements §3) for non-engineers.

### Step 9 — Replace placeholder agronomy data with real

See "Adding Kriya agronomy data" section above. This is the rate-limiting step for actual usefulness.

### Step 10 — Closed pilot with 5 farmers

Use the test number's 5-recipient cap. Daily QA review of diagnoses. Iterate on prompts and KB. ~1 week.

### Step 11 — Public launch

Switch to the real number, push WhatsApp link via Kriya's existing dealer/FPO channels.

---

## Future enhancements

| Item | Why | Effort |
|---|---|---|
| Cloudflare R2 image storage | Persist farmer photos for QA review + training data | ~30 min |
| Admin auth on `/api/*` | Currently anyone with the URL can read/write products | ~30 min |
| Retool admin panel | Visual ops console for non-engineers (approve recs, view diagnoses, manage dealers) | 1–2 hrs |
| Sentry error tracking | Production observability — catch errors that don't make it to logs | ~15 min |
| pgvector RAG over disease KB | Better symptom matching for synonyms ("white flies" → "Whitefly") | ~1 hr |
| Bhashini STT for voice notes | Farmers often send voice — currently bot asks for photo | ~30 min |
| Outbound campaigns | Crop calendar advisories, weather-linked spray reminders | ~2 hrs |
| Custom-trained vision model | Better Indian crop disease accuracy than off-the-shelf Gemini | weeks (needs dataset) |
| WhatsApp Flows for onboarding | Richer multi-field forms instead of step-by-step | ~3 hrs |

---

## Free-tier capacity (current monthly)

| Service | Limit | Covers |
|---|---|---|
| Render | 750 hrs/mo always-on | 24/7 with UptimeRobot keepalive |
| Neon Postgres | 0.5 GB storage, 100 hrs compute | ~10k farmers + history |
| Groq | 14,400 RPD | ~14k text diagnoses/day |
| Gemini | 1,500 RPD | ~1.5k vision diagnoses/day |
| WhatsApp Cloud API | 1,000 service convos/mo free | First 1k convos, then ~$0.005 each in IN |
| UptimeRobot | 50 monitors | More than enough |

For a 1,000-farmer pilot at 1 message/day each: comfortably within free tiers.

---

## Known limitations

1. **Test number is shared.** `+1 (555) 645-6725` is Meta's dev number used by many developers. Display name "Test Number" is locked. Profile picture is locked. Limited to 5 allowlisted recipients. Resolved by Path to Production §5.

2. **App is unpublished.** Even allowlisted users' real-phone messages don't reach the webhook until app publication is complete (Path to Production §6). For development, use `npm run test:webhook` instead.

3. **Image diagnosis can rate-limit.** Gemini's free tier is 15 RPM; image-heavy testing trips this. Mitigated by caption fallback to text diagnosis (which uses Groq's much higher quota).

4. **OneDrive folder.** Local project lives in OneDrive which causes `tsc-watch` hangs on file changes. Workaround: use one-shot `nest build && node dist/main.js` for local runs. Not an issue for cloud deploys.

5. **No image persistence.** Farmer photos are stored as `tmp/<id>` placeholders in the `images` table; the actual bytes are gone after the diagnosis call. Wiring R2 (Future Enhancements §1) fixes this.

---

## Support

- **Codebase questions:** see inline comments and the rules in `recommendations.service.ts`
- **Business / agronomy questions:** Kriya Biosys leadership
- **Meta-side issues:** Meta Business Help Center; developer console support tickets
- **Free-tier limits:** docs at console.groq.com, ai.google.dev/gemini-api/docs/rate-limits, dashboard.render.com

---

## Credits

Built by Lancers for Kriya Biosys, May 2026. Prototype on a $0 stack.
