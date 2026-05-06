import { Module } from '@nestjs/common';
import { FarmersService } from './farmers.service';

@Module({
  providers: [FarmersService],
  exports: [FarmersService],
})
export class FarmersModule {}
