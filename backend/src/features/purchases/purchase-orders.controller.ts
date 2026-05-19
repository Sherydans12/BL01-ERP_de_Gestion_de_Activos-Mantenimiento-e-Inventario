import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  Req,
  UseGuards,
  StreamableFile,
  Header,
} from '@nestjs/common';
import { PurchaseOrdersService } from './purchase-orders.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { SystemPermissions } from '../auth/constants/permissions.enum';

@Controller('purchase-orders')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PurchaseOrdersController {
  constructor(private readonly service: PurchaseOrdersService) {}

  @Get()
  @RequirePermissions(SystemPermissions.PURCHASES_ORDER_READ)
  findAll(
    @Req() req: any,
    @Query('contractId') contractId?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') pageRaw?: string,
    @Query('pageSize') pageSizeRaw?: string,
    @Query('sort') sort?: string,
    @Query('dir') dir?: string,
    @Query('includeClosed') includeClosedRaw?: string,
  ) {
    const parseOptionalPositiveInt = (
      raw: string | undefined,
    ): number | undefined => {
      if (raw === undefined || raw === '') return undefined;
      const n = parseInt(raw, 10);
      return Number.isFinite(n) && n > 0 ? n : undefined;
    };
    return this.service.findAll(req.user.tenantId, req.user, {
      contractId,
      status,
      includeClosed: includeClosedRaw === 'true',
      search,
      page: parseOptionalPositiveInt(pageRaw),
      pageSize: parseOptionalPositiveInt(pageSizeRaw),
      sort,
      dir,
    });
  }

  /**
   * Listado de OC elegibles para abrir una recepción (SENT, ORDERED, PARTIALLY_RECEIVED; legado SENT_TO_SUPPLIER).
   * Debe declararse antes de `:id` para no capturarse como UUID.
   */
  @Get('eligible-for-receipt')
  @RequirePermissions(SystemPermissions.PURCHASES_ORDER_READ)
  findEligibleForReceipt(@Req() req: any) {
    return this.service.findEligibleForWarehouseReceipt(
      req.user.tenantId,
      req.user,
    );
  }

  @Post('from-requisition/:requisitionId')
  @RequirePermissions(SystemPermissions.PURCHASES_ORDER_CREATE_FROM_REQUISITION)
  createOrdersFromRequisition(
    @Param('requisitionId') requisitionId: string,
    @Req() req: any,
  ) {
    return this.service.createOrdersFromRequisition(requisitionId, req.user);
  }

  @Get(':id/logs')
  @RequirePermissions(SystemPermissions.PURCHASES_ORDER_READ)
  findActivityLogs(@Param('id') id: string, @Req() req: any) {
    return this.service.findActivityLogs(id, req.user.tenantId);
  }

  @Get(':id/pdf')
  @RequirePermissions(SystemPermissions.PURCHASES_ORDER_READ)
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  @Header('Pragma', 'no-cache')
  async streamPdf(
    @Param('id') id: string,
    @Req() req: any,
  ): Promise<StreamableFile> {
    const stream = await this.service.getPurchaseOrderPdfStream(
      id,
      req.user.tenantId,
    );
    return new StreamableFile(stream, {
      type: 'application/pdf',
      disposition: 'inline',
    });
  }

  @Get(':id')
  @RequirePermissions(SystemPermissions.PURCHASES_ORDER_READ)
  findById(@Param('id') id: string, @Req() req: any) {
    return this.service.findById(id, req.user.tenantId, req.user);
  }

  /** Vincular línea de OC (sin catálogo) a un artículo creado o existente. */
  @Patch(':id/items/:itemId/link-catalog')
  @RequirePermissions(SystemPermissions.PURCHASES_ORDER_LINK_CATALOG)
  linkItemToCatalog(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() body: { inventoryItemId: string },
    @Req() req: any,
  ) {
    return this.service.linkItemToCatalog(
      id,
      itemId,
      body.inventoryItemId,
      req.user,
    );
  }

  @Post()
  @RequirePermissions(SystemPermissions.PURCHASES_ORDER_CREATE_FROM_QUOTATION)
  createFromQuotation(@Body() body: { quotationId: string }, @Req() req: any) {
    return this.service.createFromQuotation(body.quotationId, req.user);
  }

  @Post(':id/approve')
  @RequirePermissions(SystemPermissions.PURCHASES_ORDER_APPROVE)
  approve(
    @Param('id') id: string,
    @Body() body: { comment?: string },
    @Req() req: any,
  ) {
    return this.service.approve(id, body.comment, req.user);
  }

  @Post(':id/sent-to-supplier')
  @RequirePermissions(SystemPermissions.PURCHASES_ORDER_SEND_TO_SUPPLIER)
  markAsSentToSupplier(@Param('id') id: string, @Req() req: any) {
    return this.service.markAsSentToSupplier(id, req.user);
  }

  @Post(':id/reject')
  @RequirePermissions(SystemPermissions.PURCHASES_ORDER_REJECT)
  reject(
    @Param('id') id: string,
    @Body() body: { reason?: string },
    @Req() req: any,
  ) {
    return this.service.reject(id, body.reason, req.user);
  }

  @Post(':id/cancel')
  @RequirePermissions(SystemPermissions.PURCHASES_ORDER_CANCEL)
  cancel(
    @Param('id') id: string,
    @Body() body: { reason?: string },
    @Req() req: any,
  ) {
    return this.service.cancel(id, body?.reason, req.user);
  }

  @Post(':id/reset')
  @RequirePermissions(SystemPermissions.PURCHASES_ORDER_RESET_DRAFT)
  resetToDraft(@Param('id') id: string, @Req() req: any) {
    return this.service.resetToDraft(id, req.user);
  }

  @Patch(':id/logistics')
  @RequirePermissions(SystemPermissions.PURCHASES_ORDER_UPDATE_LOGISTICS)
  updateLogistics(
    @Param('id') id: string,
    @Body()
    body: { deliveryAddress?: string | null; paymentTerms?: string | null },
    @Req() req: any,
  ) {
    return this.service.updateOrderLogistics(id, body, req.user);
  }

  @Patch(':id/sensitive')
  @RequirePermissions(SystemPermissions.PURCHASES_ORDER_UPDATE_SENSITIVE)
  updateSensitiveFields(
    @Param('id') id: string,
    @Body() body: { totalAmount?: number; vendorId?: string; items?: any[] },
    @Req() req: any,
  ) {
    return this.service.updateSensitiveFields(id, body, req.user);
  }

  @Post(':id/force-close')
  @RequirePermissions(SystemPermissions.PURCHASES_ORDER_FORCE_CLOSE)
  forceClose(
    @Param('id') id: string,
    @Body() body: { reason: string },
    @Req() req: any,
  ) {
    return this.service.forceClose(id, body.reason, req.user);
  }
}
