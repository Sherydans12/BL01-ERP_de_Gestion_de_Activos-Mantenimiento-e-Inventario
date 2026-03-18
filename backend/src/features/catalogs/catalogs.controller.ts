import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import { CatalogsService } from './catalogs.service';
import { Prisma } from '@prisma/client';

@Controller('api/catalogs') // <-- http://localhost:3000/api/catalogs
export class CatalogsController {
  constructor(private readonly catalogsService: CatalogsService) {}

  @Post()
  create(@Body() createCatalogDto: Prisma.CatalogItemCreateInput) {
    return this.catalogsService.create(createCatalogDto);
  }

  @Get()
  findAll(@Query('activeOnly') activeOnly?: string) {
    const isActiveOnly = activeOnly === 'true';
    return this.catalogsService.findAll(isActiveOnly);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateCatalogDto: Prisma.CatalogItemUpdateInput,
  ) {
    return this.catalogsService.update(id, updateCatalogDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.catalogsService.remove(id);
  }
}
