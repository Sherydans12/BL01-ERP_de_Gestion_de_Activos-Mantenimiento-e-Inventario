import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { SystemPermissions } from '../auth/constants/permissions.enum';
import { InventorySuppliersService } from './inventory-suppliers.service';
import { IsString, MaxLength } from 'class-validator';

class CreateInventorySupplierDto {
  @IsString()
  @MaxLength(150)
  name: string;
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('inventory-suppliers')
export class InventorySuppliersController {
  constructor(private readonly service: InventorySuppliersService) {}

  @Get()
  @RequirePermissions(SystemPermissions.INVENTORY_SUPPLIER_READ)
  findAll(@Request() req: any) {
    return this.service.findAll(req.user.tenantId);
  }

  @Post()
  @RequirePermissions(SystemPermissions.INVENTORY_SUPPLIER_MANAGE)
  create(@Body() dto: CreateInventorySupplierDto, @Request() req: any) {
    return this.service.create(req.user.tenantId, dto.name);
  }

  @Delete(':id')
  @RequirePermissions(SystemPermissions.INVENTORY_SUPPLIER_MANAGE)
  remove(@Param('id') id: string, @Request() req: any) {
    return this.service.remove(id, req.user.tenantId);
  }
}
