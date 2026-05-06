import { Injectable } from '@nestjs/common';

/**
 * In-memory cache for local-only test images. Lets the test-webhook script
 * upload a photo from disk and reference it in a synthetic webhook payload via
 * a TEST_<uuid> media id. Cleared on server restart.
 *
 * Used ONLY in non-production. The WhatsappClientService.downloadMedia method
 * checks this cache first when the media id starts with "TEST_".
 */
@Injectable()
export class TestMediaService {
  private readonly cache = new Map<string, { buffer: Buffer; mimeType: string }>();

  put(id: string, buffer: Buffer, mimeType: string): void {
    this.cache.set(id, { buffer, mimeType });
  }

  get(id: string): { buffer: Buffer; mimeType: string } | null {
    return this.cache.get(id) ?? null;
  }
}
