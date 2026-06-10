import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { SystemPermissions } from '../auth/constants/permissions.enum';
import {
  PurchaseCreditNotesService,
  CreateCreditNoteDto,
} from './purchase-credit-notes.service';

@Controller('purchase-credit-notes')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PurchaseCreditNotesController {
  constructor(private readonly service: PurchaseCreditNotesService) {}

  /**
   * Lista notas de crédito de una OC.
   * GET /purchase-credit-notes?purchaseOrderId=<uuid>
   */
  @Get()
  @RequirePermissions(SystemPermissions.PURCHASES_CREDIT_NOTE_MANAGE)
  findByOrder(
    @Query('purchaseOrderId') purchaseOrderId: string,
    @Req() req: any,
  ) {
    return this.service.findByPurchaseOrder(purchaseOrderId, req.user);
  }

  /**
   * Registra una nota de crédito y re-dispara 3-way match en todas las facturas de la OC.
   * POST /purchase-credit-notes
   */
  @Post()
  @RequirePermissions(SystemPermissions.PURCHASES_CREDIT_NOTE_MANAGE)
  create(@Body() body: CreateCreditNoteDto, @Req() req: any) {
    return this.service.create(body, req.user);
  }

  /**
   * Elimina una nota de crédito y re-valida el 3-way match.
   * DELETE /purchase-credit-notes/:id
   */
  @Delete(':id')
  @RequirePermissions(SystemPermissions.PURCHASES_CREDIT_NOTE_MANAGE)
  remove(@Param('id') id: string, @Req() req: any) {
    return this.service.remove(id, req.user);
  }
}
