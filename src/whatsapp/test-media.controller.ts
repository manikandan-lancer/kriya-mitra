import { Body, Controller, Post } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { TestMediaService } from './test-media.service';

const UploadSchema = z.object({
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  base64: z.string().min(10),
});

@Controller('test/media')
export class TestMediaController {
  constructor(private readonly testMedia: TestMediaService) {}

  /**
   * Upload an image for testing. Returns a synthetic mediaId starting with TEST_
   * which the WhatsApp client recognises as a cache lookup instead of a Meta
   * media fetch. Risk profile: in-memory only (lost on restart), unguessable
   * UUIDs. Acceptable for prototype use. For production, gate with a shared
   * secret header.
   */
  @Post()
  upload(@Body() raw: unknown): { mediaId: string } {
    const body = UploadSchema.parse(raw);
    const id = `TEST_${randomUUID()}`;
    this.testMedia.put(id, Buffer.from(body.base64, 'base64'), body.mimeType);
    return { mediaId: id };
  }
}
