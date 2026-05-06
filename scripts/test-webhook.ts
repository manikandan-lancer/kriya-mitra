/**
 * Local webhook tester. Simulates a WhatsApp inbound message webhook by POSTing
 * a payload directly to localhost:3000/webhooks/whatsapp with a valid HMAC
 * signature computed using WHATSAPP_APP_SECRET.
 *
 * This bypasses Meta entirely so you can develop the bot logic without needing
 * the app to be published in Meta Business.
 *
 * Usage:
 *   npm run test:webhook -- text "Hi"
 *   npm run test:webhook -- image ./tomato.jpg
 *   npm run test:webhook -- button LANG_EN
 */
import 'dotenv/config';
import { createHmac, randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { extname, resolve } from 'path';

const FROM = process.env.TEST_FROM || '917825938625';
const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';
const URL_TARGET = `${BASE}/webhooks/whatsapp`;
const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '0';
const APP_SECRET = process.env.WHATSAPP_APP_SECRET;

if (!APP_SECRET) {
  console.error('WHATSAPP_APP_SECRET missing in .env');
  process.exit(1);
}

const [, , kind, ...rest] = process.argv;
if (!kind) {
  console.error('Usage: ts-node scripts/test-webhook.ts <text|image|button> <value>');
  process.exit(1);
}

function mimeFromPath(p: string): 'image/jpeg' | 'image/png' | 'image/webp' {
  const ext = extname(p).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

async function uploadTestImage(path: string): Promise<{ mediaId: string; mimeType: string }> {
  const buffer = readFileSync(resolve(path));
  const mimeType = mimeFromPath(path);
  const r = await fetch(`${BASE}/test/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mimeType, base64: buffer.toString('base64') }),
  });
  if (!r.ok) throw new Error(`upload failed: ${r.status} ${await r.text()}`);
  const j = (await r.json()) as { mediaId: string };
  return { mediaId: j.mediaId, mimeType };
}

async function makeMessage(): Promise<unknown> {
  const id = `wamid.TEST.${randomUUID().slice(0, 8)}`;
  const ts = Math.floor(Date.now() / 1000).toString();
  if (kind === 'text') {
    const body = rest.join(' ') || 'Hi';
    return { from: FROM, id, timestamp: ts, type: 'text', text: { body } };
  }
  if (kind === 'image') {
    const path = rest[0];
    if (!path) throw new Error('Usage: test:webhook -- image <path-to-jpg> [caption...]');
    const { mediaId, mimeType } = await uploadTestImage(path);
    const caption = rest.slice(1).join(' ') || undefined;
    console.log(`uploaded ${path} as ${mediaId} (${mimeType})`);
    return {
      from: FROM,
      id,
      timestamp: ts,
      type: 'image',
      image: { id: mediaId, mime_type: mimeType, caption },
    };
  }
  if (kind === 'button' || kind === 'list') {
    const replyId = rest[0] || 'LANG_EN';
    const title = rest.slice(1).join(' ') || replyId;
    return {
      from: FROM,
      id,
      timestamp: ts,
      type: 'interactive',
      interactive: {
        type: kind === 'list' ? 'list_reply' : 'button_reply',
        ...(kind === 'list'
          ? { list_reply: { id: replyId, title } }
          : { button_reply: { id: replyId, title } }),
      },
    };
  }
  throw new Error(`Unknown kind: ${kind}`);
}

(async () => {
  const message = await makeMessage();
  const payload = {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'TEST_WABA',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15551234567', phone_number_id: PHONE_ID },
              contacts: [{ profile: { name: 'Local Tester' }, wa_id: FROM }],
              messages: [message],
            },
          },
        ],
      },
    ],
  };
  const body = JSON.stringify(payload);
  const signature = 'sha256=' + createHmac('sha256', APP_SECRET).update(body).digest('hex');

  const r = await fetch(URL_TARGET, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': signature,
    },
    body,
  });
  const text = await r.text();
  console.log(`POST ${URL_TARGET} -> ${r.status}`);
  console.log(text);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
