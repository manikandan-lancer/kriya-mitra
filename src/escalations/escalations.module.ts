import { Module } from '@nestjs/common';
import { EscalationsService } from './escalations.service';

@Module({
  providers: [EscalationsService],
  exports: [EscalationsService],
})
export class EscalationsModule {}
