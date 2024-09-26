import { NestFactory } from '@nestjs/core';
import { AppApiModule } from './app-api.module';
import * as ecc from '@bitcoin-js/tiny-secp256k1-asmjs';
import { initEccLib } from 'bitcoinjs-lib';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  initEccLib(ecc);

  const app = await NestFactory.create(AppApiModule);
  const swaggerConfig = new DocumentBuilder()
    .setTitle('CAT Tracker API Documentation')
    .setDescription('RESTful APIs')
    .setVersion('0.1')
    .setLicense('MIT License', 'https://opensource.org/licenses/MIT')
    .setContact('CAT Protocol', 'https://catprotocol.org', '')
    .addServer(`http://127.0.0.1:${process.env.API_PORT || 3000}/api`)
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('/', app, swaggerDocument, {
    // https://stackoverflow.com/a/76095075
    customCssUrl:
      'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.0.0/swagger-ui.min.css',
    customJs: [
      'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.0.0/swagger-ui-bundle.js',
      'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.0.0/swagger-ui-standalone-preset.js',
    ],
  });

  app.setGlobalPrefix('api');
  app.enableCors();

  await app.listen(process.env.API_PORT || 3000);
  console.log(`tracker api is running on: ${await app.getUrl()}`);
}

bootstrap();
