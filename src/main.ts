import 'reflect-metadata';
import 'dotenv/config'; // Loads .env into process.env BEFORE config validation runs.
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { json, raw } from 'express';
import { AppModule } from './app.module';
import { loadConfig } from './config';

async function bootstrap() {
  const cfg = loadConfig();

  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug'],
  });

  // The WhatsApp signature is computed over the raw request body, so we keep
  // the original bytes for /webhooks/* and use a JSON parser for everything else.
  app.use('/webhooks', raw({ type: 'application/json', limit: '5mb' }));
  app.use(json({ limit: '2mb' }));

  app.enableShutdownHooks();

  // Bind to '::' (IPv6 unspecified, dual-stack) so ngrok hitting [::1] resolves.
  // On Windows, Node's default `listen(port)` sometimes binds to IPv4 only; '::' forces
  // both IPv6 and IPv4-mapped, which is what tunnels (ngrok, cloudflared) expect.
  await app.listen(cfg.PORT, '::');
  new Logger('Bootstrap').log(`Kriya Mitra backend listening on :${cfg.PORT}`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal startup error:', err);
  process.exit(1);
});
