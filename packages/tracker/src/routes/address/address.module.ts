import { Module } from '@nestjs/common';
import { AddressService } from './address.service';
import { AddressController } from './address.controller';
import { TokenModule } from '../token/token.module';
import { BlockModule } from '../../services/block/block.module';

@Module({
  imports: [TokenModule, BlockModule],
  providers: [AddressService],
  controllers: [AddressController],
})
export class AddressModule {}
