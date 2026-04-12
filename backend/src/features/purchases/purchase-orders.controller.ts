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
} from '@nestjs/common';
import { PurchaseOrdersService } from './purchase-orders.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('purchase-orders')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PurchaseOrdersController {
  constructor(private readonly service: PurchaseOrdersService) {}

  @Get()
  findAll(@Req() req: any, @Query('status') status?: string) {
    return this.service.findAll(req.user.tenantId, status);
  }

  @Get(':id/logs')
  findActivityLogs(@Param('id') id: string, @Req() req: any) {
    return this.service.findActivityLogs(id, req.user.tenantId);
  }

  @Get(':id/pdf')
  @Roles('ADMIN', 'SUPER_ADMIN', 'SUPERVISOR')
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
  findById(@Param('id') id: string, @Req() req: any) {
    return this.service.findById(id, req.user.tenantId);
  }

  @Post()
  @Roles('ADMIN', 'SUPER_ADMIN', 'SUPERVISOR')
  createFromQuotation(@Body() body: { quotationId: string }, @Req() req: any) {
    return this.service.createFromQuotation(body.quotationId, req.user);
  }

  @Post(':id/approve')
  approve(
    @Param('id') id: string,
    @Body() body: { comment?: string },
    @Req() req: any,
  ) {
    return this.service.approve(id, body.comment, req.user);
  }

  @Post(':id/reject')
  @Roles('ADMIN', 'SUPER_ADMIN')
  reject(
    @Param('id') id: string,
    @Body() body: { reason?: string },
    @Req() req: any,
  ) {
    return this.service.reject(id, body.reason, req.user);
  }

  @Post(':id/reset')
  @Roles('ADMIN', 'SUPER_ADMIN')
  resetToDraft(@Param('id') id: string, @Req() req: any) {
    return this.service.resetToDraft(id, req.user);
  }

  @Patch(':id/sensitive')
  @Roles('ADMIN', 'SUPER_ADMIN', 'SUPERVISOR')
  updateSensitiveFields(
    @Param('id') id: string,
    @Body() body: { totalAmount?: number; vendorId?: string; items?: any[] },
    @Req() req: any,
  ) {
    return this.service.updateSensitiveFields(id, body, req.user);
  }

  @Post(':id/force-close')
  @Roles('ADMIN', 'SUPER_ADMIN')
  forceClose(
    @Param('id') id: string,
    @Body() body: { reason: string },
    @Req() req: any,
  ) {
    return this.service.forceClose(id, body.reason, req.user);
  }
}
