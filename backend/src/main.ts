import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);

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
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposedHeaders: ['Authorization'],
    credentials: true,
    maxAge: 86400,
  });

  const port = configService.get<number>('PORT') || 3000;

  await app.listen(port, '0.0.0.0');
}
bootstrap();
