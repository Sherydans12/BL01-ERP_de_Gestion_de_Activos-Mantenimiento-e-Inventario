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
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { SystemPermissions } from '../auth/constants/permissions.enum';

@Controller('warehouses')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class WarehousesController {
  constructor(private readonly warehousesService: WarehousesService) {}

  @Post()
  @RequirePermissions(SystemPermissions.INVENTORY_WAREHOUSE_MANAGE)
  create(@Body() dto: CreateWarehouseDto, @Req() req: any) {
    return this.warehousesService.create(dto, req.user);
  }

  @Get()
  @RequirePermissions(SystemPermissions.INVENTORY_WAREHOUSE_READ)
  findAll(
    @Req() req: any,
    @Headers('x-contract-id') activeContract?: string,
    @Query('contractId') contractId?: string,
    @Query('scope') scope?: string,
  ) {
    return this.warehousesService.findAll(
      req.user,
      contractId || activeContract,
      { scope },
    );
  }

  @Get(':id')
  @RequirePermissions(SystemPermissions.INVENTORY_WAREHOUSE_READ)
  findOne(@Param('id') id: string, @Req() req: any) {
    return this.warehousesService.findOne(id, req.user);
  }

  @Put(':id')
  @RequirePermissions(SystemPermissions.INVENTORY_WAREHOUSE_MANAGE)
  update(
    @Param('id') id: string,
    @Body() dto: CreateWarehouseDto,
    @Req() req: any,
  ) {
    return this.warehousesService.update(id, dto, req.user);
  }

  @Delete(':id')
  @RequirePermissions(SystemPermissions.INVENTORY_WAREHOUSE_MANAGE)
  remove(@Param('id') id: string, @Req() req: any) {
    return this.warehousesService.remove(id, req.user);
  }
}
