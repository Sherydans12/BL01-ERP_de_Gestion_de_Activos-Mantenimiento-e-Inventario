import './init-timezone';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const configService = app.get(ConfigService);

  const uploadLogger = new Logger('Storage');
  const storageDriver = (
    configService.get<string>('STORAGE_DRIVER') || 'local'
  ).toLowerCase();
  const uploadPathCfg = configService.get<string>('UPLOAD_PATH') || './uploads';
  if (storageDriver === 'local') {
    const abs = path.isAbsolute(uploadPathCfg)
      ? uploadPathCfg
      : path.join(process.cwd(), uploadPathCfg);
    try {
      fs.mkdirSync(abs, { recursive: true });
      fs.accessSync(abs, fs.constants.W_OK);
    } catch {
      uploadLogger.warn(
        `UPLOAD_PATH "${abs}" no es escribible o no pudo crearse. ` +
          `Adjuntos (hasta 20 MB) pueden fallar. Revise permisos y que el volumen Docker monte esta ruta ` +
          `(p. ej. UPLOAD_PATH=/uploads y volumen nombrado en /uploads). STORAGE_DRIVER=${storageDriver}.`,
      );
    }
    app.useStaticAssets(abs, { prefix: '/uploads/' });
  }

  if (configService.get<string>('TRUST_PROXY') === '1') {
    const expressApp = app.getHttpAdapter().getInstance();
    expressApp.set('trust proxy', 1);
  }

  app.setGlobalPrefix('api');

  const frontendUrl =
    configService.get<string>('FRONTEND_URL') || 'http://localhost:4200';

  app.enableCors({
    origin: frontendUrl,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'x-contract-id',
      'X-Contract-Id',
    ],
    exposedHeaders: ['Authorization'],
    credentials: true,
    maxAge: 86400,
  });

  const port = configService.get<number>('PORT') || 3000;

  await app.listen(port, '0.0.0.0');
}
bootstrap();
