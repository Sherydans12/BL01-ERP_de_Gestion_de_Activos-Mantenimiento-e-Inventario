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
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { SystemPermissions } from '../auth/constants/permissions.enum';
import { assertUserHasContractAccess } from './purchase-contract-access.util';
import { PurchaseDocumentsService } from './purchase-documents.service';
import { MAX_UPLOAD_FILE_BYTES } from '../../common/storage/file-upload.constants';
import {
  documentUploadPolicy,
  FileValidationInterceptor,
} from '../../common/storage/file-validation.interceptor';

const invoiceFileLimits = { limits: { fileSize: MAX_UPLOAD_FILE_BYTES } };

@Controller('purchase-invoices')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PurchaseInvoicesController {
  constructor(
    private readonly service: PurchaseInvoicesService,
    private readonly documents: PurchaseDocumentsService,
  ) {}

  /**
   * Listado global por tenant. Query opcionales: `status`, `contractId`,
   * `dueDateFrom`, `dueDateTo`, `search`, `page`, `pageSize`, `sort`, `dir`.
   * Respuesta: `{ data, total, page, pageSize }`.
   * Sin `status` se listan todos los estados; sin `contractId` el alcance depende del rol
   * (ADMIN/SUPER_ADMIN: todos los contratos; resto: contratos permitidos en el JWT).
   */
  @Get()
  @RequirePermissions(SystemPermissions.PURCHASES_INVOICE_READ)
  findAll(
    @Req() req: any,
    @Query('status') status?: string,
    @Query('contractId') contractId?: string,
    @Query('dueDateFrom') dueDateFrom?: string,
    @Query('dueDateTo') dueDateTo?: string,
    @Query('search') search?: string,
    @Query('page') pageRaw?: string,
    @Query('pageSize') pageSizeRaw?: string,
    @Query('sort') sort?: string,
    @Query('dir') dir?: string,
  ) {
    const st = status?.trim();
    const cid = contractId?.trim();
    if (cid) {
      assertUserHasContractAccess(req.user, cid);
    }
    const parseOptionalPositiveInt = (
      raw: string | undefined,
    ): number | undefined => {
      if (raw === undefined || raw === '') return undefined;
      const n = parseInt(raw, 10);
      return Number.isFinite(n) && n > 0 ? n : undefined;
    };
    return this.service.findAll(req.user, {
      status: st || undefined,
      contractId: cid || undefined,
      dueDateFrom,
      dueDateTo,
      search,
      page: parseOptionalPositiveInt(pageRaw),
      pageSize: parseOptionalPositiveInt(pageSizeRaw),
      sort,
      dir,
    });
  }

  /**
   * Calendario de pagos: totales por día de vencimiento (facturas MATCHED o DISCREPANCY pendientes de pago).
   */
  @Get('payment-calendar')
  @RequirePermissions(SystemPermissions.PURCHASES_INVOICE_READ)
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
  @RequirePermissions(SystemPermissions.PURCHASES_INVOICE_READ)
  findById(@Param('id') id: string, @Req() req: any) {
    return this.service.findByIdForApi(id, req.user);
  }

  @Post()
  @RequirePermissions(SystemPermissions.PURCHASES_INVOICE_CREATE)
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
    @UploadedFile()
    file:
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
  @RequirePermissions(SystemPermissions.PURCHASES_INVOICE_UPDATE)
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
    @UploadedFile()
    file:
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
  @RequirePermissions(SystemPermissions.PURCHASES_INVOICE_VALIDATE)
  validate(@Param('id') id: string, @Req() req: any) {
    return this.service.validateInvoiceMatch(
      id,
      req.user.tenantId,
      req.user.id,
    );
  }

  /** Excepción manual 3-way (short shipment). PBAC: `purchases:invoice:overrule`. */
  @Post(':id/three-way-match/overrule')
  @RequirePermissions(SystemPermissions.PURCHASES_INVOICE_OVERRULE)
  overruleThreeWayMatch(
    @Param('id') id: string,
    @Body() body: { notes?: string },
    @Req() req: any,
  ) {
    return this.service.overruleThreeWayMatch(id, body?.notes ?? '', req.user);
  }

  @Post(':id/mark-paid')
  @RequirePermissions(SystemPermissions.PURCHASES_INVOICE_MARK_PAID)
  markPaid(@Param('id') id: string, @Req() req: any) {
    return this.service.markPaid(id, req.user);
  }

  /** Registra pago con referencia y fecha efectiva (paidAt). */
  @Post(':id/pay')
  @RequirePermissions(SystemPermissions.PURCHASES_INVOICE_MARK_PAID)
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
  @RequirePermissions(SystemPermissions.PURCHASES_INVOICE_DELETE)
  remove(@Param('id') id: string, @Req() req: any) {
    return this.service.remove(id, req.user);
  }
}
