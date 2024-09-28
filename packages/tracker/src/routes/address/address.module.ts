import { Module } from '@nestjs/common';
import { AddressService } from './address.service';
import { AddressController } from './address.controller';
import { TokenModule } from '../token/token.module';
import { CommonModule } from '../../services/common/common.module';

@Module({
  imports: [TokenModule, CommonModule],
  providers: [AddressService],
  controllers: [AddressController],
})
export class AddressModule {}
