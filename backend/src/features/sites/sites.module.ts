import { Module } from '@nestjs/common';
import { SitesService } from './sites.service';
import { SitesController } from './sites.controller';
import { SubcontractsController } from './subcontracts.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [SitesController, SubcontractsController],
  providers: [SitesService],
})
export class SitesModule {}
