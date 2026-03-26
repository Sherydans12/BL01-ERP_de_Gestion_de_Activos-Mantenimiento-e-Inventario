import {
  Controller,
  Get,
  Post,
  Body,
  Put,
  Param,
  Delete,
  Query,
  UseGuards,
  Req,
  Headers,
} from '@nestjs/common';
import { WarehousesService } from './warehouses.service';
import type { CreateWarehouseDto } from './warehouses.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('warehouses')
@UseGuards(JwtAuthGuard)
export class WarehousesController {
  constructor(private readonly warehousesService: WarehousesService) {}

  @Post()
  create(@Body() dto: CreateWarehouseDto, @Req() req: any) {
    return this.warehousesService.create(dto, req.user);
  }

  @Get()
  findAll(
    @Req() req: any,
    @Headers('x-contract-id') activeContract?: string,
    @Query('contractId') contractId?: string,
  ) {
    // Si viene contractId como query param, usarlo directamente (para el formulario de OT)
    return this.warehousesService.findAll(
      req.user,
      contractId || activeContract,
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return this.warehousesService.findOne(id, req.user);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() dto: CreateWarehouseDto,
    @Req() req: any,
  ) {
    return this.warehousesService.update(id, dto, req.user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: any) {
    return this.warehousesService.remove(id, req.user);
  }
}
