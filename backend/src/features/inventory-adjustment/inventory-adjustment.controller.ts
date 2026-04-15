import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import type { CreateInventoryAdjustmentDto } from './inventory-adjustment.service';
import { InventoryAdjustmentService } from './inventory-adjustment.service';

@Controller('inventory-adjustments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InventoryAdjustmentController {
  constructor(
    private readonly inventoryAdjustmentService: InventoryAdjustmentService,
  ) {}

  @Post()
  @Roles('ADMIN', 'SUPERVISOR', 'SUPER_ADMIN')
  create(@Body() dto: CreateInventoryAdjustmentDto, @Req() req: any) {
    return this.inventoryAdjustmentService.create(dto, req.user);
  }
}
