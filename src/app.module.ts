import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from './db/db.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { OrchestratorModule } from './orchestrator/orchestrator.module';
import { AiModule } from './ai/ai.module';
import { FarmersModule } from './farmers/farmers.module';
import { ConversationsModule } from './conversations/conversations.module';
import { ProductsModule } from './products/products.module';
import { RecommendationsModule } from './recommendations/recommendations.module';
import { DiagnosesModule } from './diagnoses/diagnoses.module';
import { EscalationsModule } from './escalations/escalations.module';
import { DealersModule } from './dealers/dealers.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DbModule,
    AiModule,
    WhatsappModule,
    FarmersModule,
    ConversationsModule,
    DiagnosesModule,
    ProductsModule,
    RecommendationsModule,
    DealersModule,
    EscalationsModule,
    OrchestratorModule,
  ],
})
export class AppModule {}
