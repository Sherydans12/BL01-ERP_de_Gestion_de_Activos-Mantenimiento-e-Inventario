import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { CatalogsService } from './catalogs.service';
import { Prisma } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('catalogs')
@UseGuards(JwtAuthGuard) // Aseguramos que req.user exista
export class CatalogsController {
  constructor(private readonly catalogsService: CatalogsService) {}

  @Post()
  create(
    @Req() req: any,
    @Body() createCatalogDto: Prisma.CatalogItemCreateInput,
  ) {
    return this.catalogsService.create(req.user?.tenantId, createCatalogDto);
  }

  @Get('contracts') // <--- CAMBIO: de 'sites' a 'contracts'
  findAllContracts(@Req() req: any) {
    return this.catalogsService.findAllContracts(req.user?.tenantId);
  }

  @Get()
  findAll(@Req() req: any, @Query('activeOnly') activeOnly?: string) {
    const isActiveOnly = activeOnly === 'true';
    return this.catalogsService.findAll(req.user?.tenantId, isActiveOnly);
  }

  @Patch(':id')
  update(
    @Req() req: any,
    @Param('id') id: string,
    @Body() updateCatalogDto: Prisma.CatalogItemUpdateInput,
  ) {
    return this.catalogsService.update(
      req.user?.tenantId,
      id,
      updateCatalogDto,
    );
  }

  @Delete(':id')
  remove(@Req() req: any, @Param('id') id: string) {
    return this.catalogsService.remove(req.user?.tenantId, id);
  }
}
