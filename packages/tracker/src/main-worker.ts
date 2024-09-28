import { NestFactory } from '@nestjs/core';
import { AppWorkerModule } from './app-worker.module';
import * as ecc from '@bitcoin-js/tiny-secp256k1-asmjs';
import { initEccLib } from 'bitcoinjs-lib';

async function bootstrap() {
  initEccLib(ecc);
  const app = await NestFactory.create(AppWorkerModule);
  await app.listen(process.env.WORKER_PORT || 3001);
  console.log(`tracker worker is running on: ${await app.getUrl()}`);
}

bootstrap();
