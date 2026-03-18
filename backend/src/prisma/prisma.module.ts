import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global() // <-- Esto hace que Prisma esté disponible en todo NestJS
@Module({
  providers: [PrismaService],
  exports: [PrismaService], // <-- Lo exportamos para usarlo en otros servicios
})
export class PrismaModule {}
