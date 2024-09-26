import { Module } from '@nestjs/common';
import { HealthCheckController } from './healthCheck.controller';
import { CommonModule } from '../../services/common/common.module';

@Module({
  imports: [CommonModule],
  providers: [],
  controllers: [HealthCheckController],
})
export class HealthCheckModule {}
