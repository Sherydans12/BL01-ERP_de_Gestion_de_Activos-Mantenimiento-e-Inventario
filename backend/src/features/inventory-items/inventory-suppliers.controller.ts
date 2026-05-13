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
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { InventorySuppliersService } from './inventory-suppliers.service';
import { IsString, MaxLength } from 'class-validator';

class CreateInventorySupplierDto {
  @IsString()
  @MaxLength(150)
  name: string;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('inventory-suppliers')
export class InventorySuppliersController {
  constructor(private readonly service: InventorySuppliersService) {}

  @Get()
  @Roles('ADMIN', 'SUPERVISOR', 'MECHANIC', 'SUPER_ADMIN')
  findAll(@Request() req: any) {
    return this.service.findAll(req.user.tenantId);
  }

  @Post()
  @Roles('ADMIN', 'SUPERVISOR', 'SUPER_ADMIN')
  create(@Body() dto: CreateInventorySupplierDto, @Request() req: any) {
    return this.service.create(req.user.tenantId, dto.name);
  }

  @Delete(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  remove(@Param('id') id: string, @Request() req: any) {
    return this.service.remove(id, req.user.tenantId);
  }
}
