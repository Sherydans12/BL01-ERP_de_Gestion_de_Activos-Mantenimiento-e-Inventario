import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Req,
  Query,
  UseGuards,
} from '@nestjs/common';
import { WarehouseReceiptsService } from './warehouse-receipts.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { SystemPermissions } from '../auth/constants/permissions.enum';

@Controller('warehouse-receipts')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class WarehouseReceiptsController {
  constructor(private readonly service: WarehouseReceiptsService) {}

  @Get()
  @RequirePermissions(SystemPermissions.PURCHASES_RECEIPT_READ)
  findAll(
    @Req() req: any,
    @Query('search') search?: string,
    @Query('page') pageRaw?: string,
    @Query('pageSize') pageSizeRaw?: string,
    @Query('sort') sort?: string,
    @Query('dir') dir?: string,
  ) {
    const parseOptionalPositiveInt = (
      raw: string | undefined,
    ): number | undefined => {
      if (raw === undefined || raw === '') return undefined;
      const n = parseInt(raw, 10);
      return Number.isFinite(n) && n > 0 ? n : undefined;
    };
    return this.service.findAll(req.user.tenantId, req.user, {
      search,
      page: parseOptionalPositiveInt(pageRaw),
      pageSize: parseOptionalPositiveInt(pageSizeRaw),
      sort,
      dir,
    });
  }

  @Get(':id')
  @RequirePermissions(SystemPermissions.PURCHASES_RECEIPT_READ)
  findById(@Param('id') id: string, @Req() req: any) {
    return this.service.findById(id, req.user.tenantId);
  }

  @Get(':id/logs')
  @RequirePermissions(SystemPermissions.PURCHASES_RECEIPT_READ)
  findLogs(@Param('id') id: string, @Req() req: any) {
    return this.service.findLogs(id, req.user.tenantId);
  }

  @Post()
  @RequirePermissions(SystemPermissions.PURCHASES_RECEIPT_CREATE)
  create(
    @Body() body: { purchaseOrderId: string; warehouseId: string },
    @Req() req: any,
  ) {
    return this.service.create(body, req.user);
  }

  @Patch(':id/items')
  @RequirePermissions(SystemPermissions.PURCHASES_RECEIPT_REGISTER)
  updateItems(
    @Param('id') id: string,
    @Body()
    body: {
      items: Array<{
        id: string;
        quantityReceived: number;
        observations?: string;
      }>;
    },
    @Req() req: any,
  ) {
    return this.service.updateItems(id, body.items, req.user);
  }

  @Post(':id/confirm')
  @RequirePermissions(SystemPermissions.PURCHASES_RECEIPT_REGISTER)
  confirm(@Param('id') id: string, @Req() req: any) {
    return this.service.confirm(id, req.user);
  }
}
