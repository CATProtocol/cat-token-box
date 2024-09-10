import { Module } from '@nestjs/common';
import { HealthCheckController } from './healthCheck.controller';
import { BlockModule } from '../../services/block/block.module';

@Module({
  imports: [BlockModule],
  providers: [],
  controllers: [HealthCheckController],
})
export class HealthCheckModule {}
