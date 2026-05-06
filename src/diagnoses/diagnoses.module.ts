import { Module } from '@nestjs/common';
import { DiagnosesService } from './diagnoses.service';

@Module({
  providers: [DiagnosesService],
  exports: [DiagnosesService],
})
export class DiagnosesModule {}
