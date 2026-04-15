import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { WarehouseBinsService } from './warehouse-bins.service';
import type { CreateWarehouseBinDto } from './warehouse-bins.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('warehouses/:warehouseId/bins')
@UseGuards(JwtAuthGuard)
export class WarehouseBinsController {
  constructor(private readonly binsService: WarehouseBinsService) {}

  @Post()
  create(
    @Param('warehouseId') warehouseId: string,
    @Body() dto: CreateWarehouseBinDto,
    @Req() req: any,
  ) {
    return this.binsService.create(warehouseId, dto, req.user);
  }

  @Get()
  findAll(@Param('warehouseId') warehouseId: string, @Req() req: any) {
    return this.binsService.findAll(warehouseId, req.user);
  }

  @Get(':binId')
  findOne(
    @Param('warehouseId') warehouseId: string,
    @Param('binId') binId: string,
    @Req() req: any,
  ) {
    return this.binsService.findOne(warehouseId, binId, req.user);
  }

  @Put(':binId')
  update(
    @Param('warehouseId') warehouseId: string,
    @Param('binId') binId: string,
    @Body() dto: CreateWarehouseBinDto,
    @Req() req: any,
  ) {
    return this.binsService.update(warehouseId, binId, dto, req.user);
  }

  @Delete(':binId')
  remove(
    @Param('warehouseId') warehouseId: string,
    @Param('binId') binId: string,
    @Req() req: any,
  ) {
    return this.binsService.remove(warehouseId, binId, req.user);
  }
}
