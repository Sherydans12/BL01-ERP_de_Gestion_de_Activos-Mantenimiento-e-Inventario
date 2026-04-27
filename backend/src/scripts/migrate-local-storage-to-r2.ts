import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { StorageMigrationService } from '../common/storage/storage-migration.service';

async function bootstrap() {
  const logger = new Logger('StorageMigrationScript');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const migration = app.get(StorageMigrationService);
    const summary = await migration.run();
    logger.log(
      `Resumen final -> migrados: ${summary.migrated}, errores: ${summary.errors}, ya en R2: ${summary.alreadyInR2}`,
    );
    process.exitCode = summary.errors > 0 ? 2 : 0;
  } catch (error) {
    logger.error(
      `Ejecución fallida: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void bootstrap();
