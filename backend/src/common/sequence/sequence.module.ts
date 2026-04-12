import { Global, Module } from '@nestjs/common';
import { SequenceService } from './sequence.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [SequenceService],
  exports: [SequenceService],
})
export class SequenceModule {}
