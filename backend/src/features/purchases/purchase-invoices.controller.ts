import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PurchaseInvoicesService } from './purchase-invoices.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { assertUserHasContractAccess } from './purchase-contract-access.util';
import { PurchaseDocumentsService } from './purchase-documents.service';
import { MAX_UPLOAD_FILE_BYTES } from '../../common/storage/file-upload.constants';
import {
  documentUploadPolicy,
  FileValidationInterceptor,
} from '../../common/storage/file-validation.interceptor';

const invoiceFileLimits = { limits: { fileSize: MAX_UPLOAD_FILE_BYTES } };

@Controller('purchase-invoices')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PurchaseInvoicesController {
  constructor(
    private readonly service: PurchaseInvoicesService,
    private readonly documents: PurchaseDocumentsService,
  ) {}

  /**
   * Listado global por tenant. Query opcionales: `status`, `contractId`.
   * Sin `status` se listan todos los estados; sin `contractId` el alcance depende del rol
   * (ADMIN/SUPER_ADMIN: todos los contratos; resto: contratos permitidos en el JWT).
   */
  @Get()
  @Roles('ADMIN', 'SUPERVISOR', 'SUPER_ADMIN')
  findAll(
    @Req() req: any,
    @Query('status') status?: string,
    @Query('contractId') contractId?: string,
    @Query('dueDateFrom') dueDateFrom?: string,
    @Query('dueDateTo') dueDateTo?: string,
  ) {
    const st = status?.trim();
    const cid = contractId?.trim();
    if (cid) {
      assertUserHasContractAccess(req.user, cid);
    }
    return this.service.findAll(
      req.user,
      st || undefined,
      cid || undefined,
      dueDateFrom,
      dueDateTo,
    );
  }

  /**
   * Calendario de pagos: totales por día de vencimiento (facturas MATCHED o DISCREPANCY pendientes de pago).
   */
  @Get('payment-calendar')
  @Roles('ADMIN', 'SUPERVISOR', 'SUPER_ADMIN')
  getPaymentCalendar(
    @Req() req: any,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('contractId') contractId: string,
  ) {
    const cid = contractId?.trim();
    if (!cid) {
      throw new BadRequestException('El parámetro contractId es obligatorio.');
    }
    assertUserHasContractAccess(req.user, cid);
    return this.service.getPaymentCalendar(req.user, from, to, cid);
  }

  @Get(':id')
  findById(@Param('id') id: string, @Req() req: any) {
    return this.service.findByIdForApi(id, req.user);
  }

  @Post()
  @Roles('ADMIN', 'SUPERVISOR', 'SUPER_ADMIN')
  @UseInterceptors(
    FileInterceptor('pdf', invoiceFileLimits),
    new FileValidationInterceptor(documentUploadPolicy),
  )
  async create(
    @Body()
    body: {
      purchaseOrderId: string;
      vendorId: string;
      invoiceNumber: string;
      emissionDate: string;
      /** ISO date; si se omite, vencimiento = emisión + 30 días. */
      dueDate?: string;
      totalAmount: string | number;
      netAmount?: string | number | null;
      taxAmount?: string | number | null;
      pdfUrl?: string;
    },
    @UploadedFile() file:
      | { buffer: Buffer; originalname: string; mimetype: string }
      | undefined,
    @Req() req: any,
  ) {
    let pdfUrl: string | null | undefined = body.pdfUrl;
    if (file) {
      pdfUrl = null;
    }
    const total =
      typeof body.totalAmount === 'string'
        ? parseFloat(body.totalAmount)
        : body.totalAmount;
    const net =
      body.netAmount === undefined ||
      body.netAmount === null ||
      body.netAmount === ''
        ? undefined
        : typeof body.netAmount === 'string'
          ? parseFloat(body.netAmount)
          : body.netAmount;
    const tax =
      body.taxAmount === undefined ||
      body.taxAmount === null ||
      body.taxAmount === ''
        ? undefined
        : typeof body.taxAmount === 'string'
          ? parseFloat(body.taxAmount)
          : body.taxAmount;
    const created = await this.service.create(
      {
        purchaseOrderId: body.purchaseOrderId,
        vendorId: body.vendorId,
        invoiceNumber: body.invoiceNumber,
        emissionDate: body.emissionDate,
        dueDate: body.dueDate,
        totalAmount: total,
        netAmount: net !== undefined && !Number.isNaN(net) ? net : null,
        taxAmount: tax !== undefined && !Number.isNaN(tax) ? tax : null,
        pdfUrl: pdfUrl ?? null,
      },
      req.user,
    );
    if (file?.buffer?.length) {
      await this.documents.upload(
        req.user.tenantId,
        req.user.id,
        'PURCHASE_INVOICE',
        created.id,
        {
          buffer: file.buffer,
          originalname: file.originalname,
          mimetype: file.mimetype,
        },
        req.user,
      );
      return this.service.findByIdForApi(created.id, req.user);
    }
    return created;
  }

  @Patch(':id')
  @Roles('ADMIN', 'SUPERVISOR', 'SUPER_ADMIN')
  @UseInterceptors(
    FileInterceptor('pdf', invoiceFileLimits),
    new FileValidationInterceptor(documentUploadPolicy),
  )
  async update(
    @Param('id') id: string,
    @Body()
    body: {
      invoiceNumber?: string;
      emissionDate?: string;
      dueDate?: string | null;
      totalAmount?: string | number;
      netAmount?: string | number | null;
      taxAmount?: string | number | null;
      pdfUrl?: string | null;
    },
    @UploadedFile() file:
      | { buffer: Buffer; originalname: string; mimetype: string }
      | undefined,
    @Req() req: any,
  ) {
    let pdfUrl: string | null | undefined = body.pdfUrl;
    if (file) {
      pdfUrl = null;
    }
    const total =
      body.totalAmount !== undefined
        ? typeof body.totalAmount === 'string'
          ? parseFloat(body.totalAmount)
          : body.totalAmount
        : undefined;
    const net =
      body.netAmount === undefined
        ? undefined
        : body.netAmount === null || body.netAmount === ''
          ? null
          : typeof body.netAmount === 'string'
            ? parseFloat(body.netAmount)
            : body.netAmount;
    const tax =
      body.taxAmount === undefined
        ? undefined
        : body.taxAmount === null || body.taxAmount === ''
          ? null
          : typeof body.taxAmount === 'string'
            ? parseFloat(body.taxAmount)
            : body.taxAmount;
    const updated = await this.service.update(
      id,
      {
        invoiceNumber: body.invoiceNumber,
        emissionDate: body.emissionDate,
        dueDate: body.dueDate,
        totalAmount: total,
        netAmount: net,
        taxAmount: tax,
        pdfUrl,
      },
      req.user,
    );
    if (file?.buffer?.length) {
      await this.documents.upload(
        req.user.tenantId,
        req.user.id,
        'PURCHASE_INVOICE',
        id,
        {
          buffer: file.buffer,
          originalname: file.originalname,
          mimetype: file.mimetype,
        },
        req.user,
      );
      return this.service.findByIdForApi(id, req.user);
    }
    return updated;
  }

  @Post(':id/validate')
  @Roles('ADMIN', 'SUPERVISOR', 'SUPER_ADMIN')
  validate(@Param('id') id: string, @Req() req: any) {
    return this.service.validateInvoiceMatch(
      id,
      req.user.tenantId,
      req.user.id,
    );
  }

  @Post(':id/mark-paid')
  @Roles('ADMIN', 'SUPERVISOR', 'SUPER_ADMIN')
  markPaid(@Param('id') id: string, @Req() req: any) {
    return this.service.markPaid(id, req.user);
  }

  /** Registra pago con referencia y fecha efectiva (paidAt). */
  @Post(':id/pay')
  @Roles('ADMIN', 'SUPERVISOR', 'SUPER_ADMIN')
  pay(
    @Param('id') id: string,
    @Body() body: { paymentReference: string },
    @Req() req: any,
  ) {
    return this.service.recordPayment(
      id,
      body?.paymentReference ?? '',
      req.user,
    );
  }

  /** Elimina factura no pagada (auditoría previa obligatoria en servicio). */
  @Delete(':id')
  @Roles('ADMIN', 'SUPERVISOR', 'SUPER_ADMIN')
  remove(@Param('id') id: string, @Req() req: any) {
    return this.service.remove(id, req.user);
  }
}
