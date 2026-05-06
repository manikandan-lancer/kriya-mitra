import { Module, forwardRef } from '@nestjs/common';
import { OrchestratorService } from './orchestrator.service';
import { FarmersModule } from '../farmers/farmers.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { DiagnosesModule } from '../diagnoses/diagnoses.module';
import { RecommendationsModule } from '../recommendations/recommendations.module';
import { EscalationsModule } from '../escalations/escalations.module';
import { DealersModule } from '../dealers/dealers.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [
    FarmersModule,
    ConversationsModule,
    DiagnosesModule,
    RecommendationsModule,
    EscalationsModule,
    DealersModule,
    forwardRef(() => WhatsappModule),
  ],
  providers: [OrchestratorService],
  exports: [OrchestratorService],
})
export class OrchestratorModule {}
