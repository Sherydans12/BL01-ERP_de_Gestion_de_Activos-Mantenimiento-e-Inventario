import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);

  // Prefijo global para todas las rutas
  app.setGlobalPrefix('api');

  // Habilitar CORS de forma segura para producción
  const frontendUrl =
    configService.get('FRONTEND_URL') || 'http://localhost:4200';
  app.enableCors({
    origin: frontendUrl,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });
  const port = configService.get('PORT') || 3000;

  await app.listen(port);
}
bootstrap();
