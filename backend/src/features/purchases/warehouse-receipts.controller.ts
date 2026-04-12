import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import { WarehouseReceiptsService } from './warehouse-receipts.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

@Controller('warehouse-receipts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WarehouseReceiptsController {
  constructor(private readonly service: WarehouseReceiptsService) {}

  @Get()
  findAll(@Req() req: any) {
    return this.service.findAll(req.user.tenantId);
  }

  @Get(':id')
  findById(@Param('id') id: string, @Req() req: any) {
    return this.service.findById(id, req.user.tenantId);
  }

  @Post()
  create(
    @Body() body: { purchaseOrderId: string; warehouseId: string },
    @Req() req: any,
  ) {
    return this.service.create(body, req.user);
  }

  @Patch(':id/items')
  updateItems(
    @Param('id') id: string,
    @Body() body: { items: Array<{ id: string; quantityReceived: number; observations?: string }> },
    @Req() req: any,
  ) {
    return this.service.updateItems(id, body.items, req.user);
  }

  @Post(':id/confirm')
  confirm(@Param('id') id: string, @Req() req: any) {
    return this.service.confirm(id, req.user);
  }
}
