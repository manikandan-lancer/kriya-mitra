import { Module, forwardRef } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { WhatsappClientService } from './whatsapp-client.service';
import { TestMediaService } from './test-media.service';
import { TestMediaController } from './test-media.controller';
import { OrchestratorModule } from '../orchestrator/orchestrator.module';

@Module({
  imports: [forwardRef(() => OrchestratorModule)],
  controllers: [WebhookController, TestMediaController],
  providers: [WhatsappClientService, TestMediaService],
  exports: [WhatsappClientService],
})
export class WhatsappModule {}
