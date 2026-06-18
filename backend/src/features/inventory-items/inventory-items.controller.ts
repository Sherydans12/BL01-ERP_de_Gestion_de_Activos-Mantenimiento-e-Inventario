import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Put,
  Param,
  Delete,
  Query,
  UseGuards,
  Req,
  UploadedFile,
  UseInterceptors,
  StreamableFile,
  Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { InventoryItemsService } from './inventory-items.service';
import type { QuickCreateItemDto } from './dto/quick-create-item.dto';
import { CreateInventoryItemDto } from './dto/create-inventory-item.dto';
import { UpdateInventoryItemDto } from './dto/update-inventory-item.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import {
  RequireAnyPermissions,
  RequirePermissions,
} from '../auth/decorators/permissions.decorator';
import { SystemPermissions } from '../auth/constants/permissions.enum';
import { MAX_UPLOAD_FILE_BYTES } from '../../common/storage/file-upload.constants';

const attachmentFileLimits = { limits: { fileSize: MAX_UPLOAD_FILE_BYTES } };
const masterImportLimits = { limits: { fileSize: 20 * 1024 * 1024 } };

function parseImportOptions(body: any): Record<string, unknown> {
  const raw = body?.options;
  if (!raw) return {};
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  try {
    return JSON.parse(String(raw)) as Record<string, unknown>;
  } catch {
    throw new BadRequestException('options debe ser JSON valido.');
  }
}

@Controller('inventory-items')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class InventoryItemsController {
  constructor(private readonly inventoryItemsService: InventoryItemsService) {}

  @Post()
  @RequirePermissions(SystemPermissions.INVENTORY_ITEM_CREATE)
  create(@Body() dto: CreateInventoryItemDto, @Req() req: any) {
    return this.inventoryItemsService.create(dto, req.user);
  }

  @Post('quick-create')
  @RequirePermissions(SystemPermissions.INVENTORY_ITEM_CREATE)
  quickCreate(@Body() dto: QuickCreateItemDto, @Req() req: any) {
    return this.inventoryItemsService.quickCreate(dto, req.user);
  }

  @Get('search')
  @RequirePermissions(SystemPermissions.INVENTORY_ITEM_READ)
  search(@Query('q') q: string, @Req() req: any) {
    return this.inventoryItemsService.search(req.user, q);
  }

  /** Debe declararse antes de `:id` para no capturarse como UUID. */
  @Get('picker')
  @RequirePermissions(SystemPermissions.INVENTORY_ITEM_READ)
  findPicker(
    @Req() req: any,
    @Query('search') search?: string,
    @Query('categoryId') categoryId?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('onlyWithStock') onlyWithStock?: string,
    @Query('workOrderId') workOrderReturnFilterId?: string,
    @Query('fieldReentryOutstanding') fieldReentryOutstanding?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const p = page !== undefined ? Number.parseInt(page, 10) : undefined;
    const ps =
      pageSize !== undefined ? Number.parseInt(pageSize, 10) : undefined;
    const ows = String(onlyWithStock ?? '')
      .trim()
      .toLowerCase();
    const onlyWithStockInWarehouse =
      ows === '1' || ows === 'true' || ows === 'yes';
    const fre = String(fieldReentryOutstanding ?? '')
      .trim()
      .toLowerCase();
    const fieldReentryOutstandingOnly =
      fre === '1' || fre === 'true' || fre === 'yes';
    return this.inventoryItemsService.findForPicker(req.user, {
      search,
      categoryId,
      warehouseId,
      onlyWithStockInWarehouse,
      workOrderReturnFilterId,
      fieldReentryOutstanding: fieldReentryOutstandingOnly,
      page: Number.isFinite(p) ? p : undefined,
      pageSize: Number.isFinite(ps) ? ps : undefined,
    });
  }

  /** Vista previa del próximo `IN####` (no reserva correlativo). */
  @Get('next-inventory-code')
  @RequirePermissions(SystemPermissions.INVENTORY_ITEM_READ)
  peekNextInventorySku(@Req() req: any) {
    return this.inventoryItemsService.peekNextInventorySku(req.user);
  }

  @Get()
  @RequirePermissions(SystemPermissions.INVENTORY_ITEM_READ)
  findCatalog(
    @Req() req: any,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
    @Query('categoryId') categoryId?: string,
  ) {
    const parseNum = (s?: string) => {
      const n = s !== undefined ? Number.parseInt(s, 10) : NaN;
      return Number.isFinite(n) ? n : undefined;
    };
    return this.inventoryItemsService.findCatalog(req.user, {
      page: parseNum(page),
      pageSize: parseNum(pageSize),
      search,
      categoryId,
    });
  }

  @Get('export/master')
  @RequirePermissions(SystemPermissions.INVENTORY_ITEM_READ)
  async exportMasterExcel(
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const buffer =
      await this.inventoryItemsService.getInventoryMasterExcelBuffer(req.user);
    const stamp = new Date().toISOString().slice(0, 10);
    res.set(
      'Content-Disposition',
      `attachment; filename="BaseLogic_Stock_Inventario_${stamp}.xlsx"`,
    );
    return new StreamableFile(buffer, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  }

  @Post('import/validate')
  @HttpCode(HttpStatus.OK)
  @RequireAnyPermissions(
    SystemPermissions.INVENTORY_ITEM_UPDATE,
    SystemPermissions.INVENTORY_STOCK_ADJUST,
  )
  @UseInterceptors(FileInterceptor('file', masterImportLimits))
  validateMasterImport(@UploadedFile() file: any, @Req() req: any) {
    if (!file?.buffer) {
      throw new BadRequestException('Debe adjuntar un archivo Excel .xlsx.');
    }
    return this.inventoryItemsService.validateInventoryMasterImport(
      file.buffer,
      req.user,
    );
  }

  @Post('import/commit')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(SystemPermissions.INVENTORY_STOCK_ADJUST)
  @UseInterceptors(FileInterceptor('file', masterImportLimits))
  commitMasterImport(
    @UploadedFile() file: any,
    @Body() body: any,
    @Req() req: any,
  ) {
    if (!file?.buffer) {
      throw new BadRequestException('Debe adjuntar un archivo Excel .xlsx.');
    }
    return this.inventoryItemsService.commitInventoryMasterImport(
      file.buffer,
      req.user,
      parseImportOptions(body),
      file.originalname,
    );
  }

  /** Debe declararse antes de `:id` para no capturarse como UUID. */
  @Get(':id/attachments')
  @RequirePermissions(SystemPermissions.INVENTORY_ITEM_READ)
  listAttachments(@Param('id') id: string, @Req() req: any) {
    return this.inventoryItemsService.listAttachments(id, req.user);
  }

  @Post(':id/attachments')
  @RequirePermissions(SystemPermissions.INVENTORY_ITEM_UPDATE)
  @UseInterceptors(FileInterceptor('file', attachmentFileLimits))
  uploadAttachment(
    @Param('id') id: string,
    @UploadedFile() file: any,
    @Req() req: any,
  ) {
    if (!file?.buffer) {
      throw new BadRequestException('Debe adjuntar un archivo.');
    }
    return this.inventoryItemsService.addAttachment(id, file, req.user);
  }

  @Delete(':id/attachments/:attachmentId')
  @RequirePermissions(SystemPermissions.INVENTORY_ITEM_UPDATE)
  removeAttachment(
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @Req() req: any,
  ) {
    return this.inventoryItemsService.removeAttachment(
      id,
      attachmentId,
      req.user,
    );
  }

  @Get(':id/ledger')
  @RequirePermissions(SystemPermissions.INVENTORY_ITEM_READ)
  getLedger(
    @Param('id') id: string,
    @Req() req: any,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('warehouseId') warehouseId?: string,
  ) {
    const parseNum = (s?: string) => {
      const n = s !== undefined ? Number.parseInt(s, 10) : NaN;
      return Number.isFinite(n) ? n : undefined;
    };
    return this.inventoryItemsService.findItemLedger(id, req.user, {
      page: parseNum(page),
      pageSize: parseNum(pageSize),
      warehouseId: warehouseId?.trim() || undefined,
    });
  }

  /**
   * Etiqueta térmica PDF con QR.
   * @param qr `url` (defecto): enlace al detalle si hay FRONTEND_URL; si no, JSON. `json`: siempre JSON.
   * @param size `100x50` (mm, defecto) o `50x25`.
   */
  @Get(':id/label')
  @RequirePermissions(SystemPermissions.INVENTORY_ITEM_READ)
  async getItemLabel(
    @Param('id') id: string,
    @Req() req: any,
    @Query('qr') qr?: string,
    @Query('size') size?: string,
  ): Promise<StreamableFile> {
    const { stream, filename } =
      await this.inventoryItemsService.getItemLabelPdf(id, req.user, {
        qr: qr === 'json' ? 'json' : 'url',
        size: size === '50x25' ? '50x25' : '100x50',
      });
    return new StreamableFile(stream, {
      type: 'application/pdf',
      disposition: `inline; filename="${filename}"`,
    });
  }

  @Get(':id')
  @RequirePermissions(SystemPermissions.INVENTORY_ITEM_READ)
  findOne(@Param('id') id: string, @Req() req: any) {
    return this.inventoryItemsService.findOne(id, req.user);
  }

  @Put(':id')
  @RequirePermissions(SystemPermissions.INVENTORY_ITEM_UPDATE)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateInventoryItemDto,
    @Req() req: any,
  ) {
    return this.inventoryItemsService.update(id, dto, req.user);
  }

  @Delete(':id')
  @RequirePermissions(SystemPermissions.INVENTORY_ITEM_DELETE)
  remove(@Param('id') id: string, @Req() req: any) {
    return this.inventoryItemsService.remove(id, req.user);
  }
}
