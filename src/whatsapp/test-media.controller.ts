import { Body, Controller, ForbiddenException, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { TestMediaService } from './test-media.service';

const UploadSchema = z.object({
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  base64: z.string().min(10),
});

@Controller('test/media')
export class TestMediaController {
  constructor(
    private readonly testMedia: TestMediaService,
    private readonly config: ConfigService,
  ) {}

  /** Upload an image for local testing. Returns a synthetic mediaId starting with TEST_. */
  @Post()
  upload(@Body() raw: unknown): { mediaId: string } {
    if (this.config.get<string>('NODE_ENV') === 'production') {
      throw new ForbiddenException('test endpoints disabled in production');
    }
    const body = UploadSchema.parse(raw);
    const id = `TEST_${randomUUID()}`;
    this.testMedia.put(id, Buffer.from(body.base64, 'base64'), body.mimeType);
    return { mediaId: id };
  }
}
