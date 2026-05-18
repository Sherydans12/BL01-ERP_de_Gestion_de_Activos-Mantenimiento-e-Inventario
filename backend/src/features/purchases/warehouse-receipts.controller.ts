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
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('warehouse-receipts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WarehouseReceiptsController {
  constructor(private readonly service: WarehouseReceiptsService) {}

  @Get()
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
  findById(@Param('id') id: string, @Req() req: any) {
    return this.service.findById(id, req.user.tenantId);
  }

  @Post()
  @Roles('ADMIN', 'SUPERVISOR', 'SUPER_ADMIN')
  create(
    @Body() body: { purchaseOrderId: string; warehouseId: string },
    @Req() req: any,
  ) {
    return this.service.create(body, req.user);
  }

  @Patch(':id/items')
  @Roles('ADMIN', 'SUPERVISOR', 'SUPER_ADMIN')
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
  @Roles('ADMIN', 'SUPERVISOR', 'SUPER_ADMIN')
  confirm(@Param('id') id: string, @Req() req: any) {
    return this.service.confirm(id, req.user);
  }
}
