import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Body,
  Put,
  Param,
  Delete,
  Query,
  UseGuards,
  Req,
  UploadedFile,
  UseInterceptors,
  StreamableFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InventoryItemsService } from './inventory-items.service';
import type { QuickCreateItemDto } from './inventory-items.service';
import { CreateInventoryItemDto } from './dto/create-inventory-item.dto';
import { UpdateInventoryItemDto } from './dto/update-inventory-item.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { MAX_UPLOAD_FILE_BYTES } from '../../common/storage/file-upload.constants';

const attachmentFileLimits = { limits: { fileSize: MAX_UPLOAD_FILE_BYTES } };

@Controller('inventory-items')
@UseGuards(JwtAuthGuard)
export class InventoryItemsController {
  constructor(private readonly inventoryItemsService: InventoryItemsService) {}

  @Post()
  create(@Body() dto: CreateInventoryItemDto, @Req() req: any) {
    return this.inventoryItemsService.create(dto, req.user);
  }

  @Post('quick-create')
  quickCreate(@Body() dto: QuickCreateItemDto, @Req() req: any) {
    return this.inventoryItemsService.quickCreate(dto, req.user);
  }

  @Get('search')
  search(@Query('q') q: string, @Req() req: any) {
    return this.inventoryItemsService.search(req.user, q);
  }

  /** Debe declararse antes de `:id` para no capturarse como UUID. */
  @Get('picker')
  findPicker(
    @Req() req: any,
    @Query('search') search?: string,
    @Query('categoryId') categoryId?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const p = page !== undefined ? Number.parseInt(page, 10) : undefined;
    const ps =
      pageSize !== undefined ? Number.parseInt(pageSize, 10) : undefined;
    return this.inventoryItemsService.findForPicker(req.user, {
      search,
      categoryId,
      warehouseId,
      page: Number.isFinite(p) ? p : undefined,
      pageSize: Number.isFinite(ps) ? ps : undefined,
    });
  }

  @Get()
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

  /** Debe declararse antes de `:id` para no capturarse como UUID. */
  @Get(':id/attachments')
  listAttachments(@Param('id') id: string, @Req() req: any) {
    return this.inventoryItemsService.listAttachments(id, req.user);
  }

  @Post(':id/attachments')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPERVISOR', 'SUPER_ADMIN')
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
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPERVISOR', 'SUPER_ADMIN')
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
  getLedger(
    @Param('id') id: string,
    @Req() req: any,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const parseNum = (s?: string) => {
      const n = s !== undefined ? Number.parseInt(s, 10) : NaN;
      return Number.isFinite(n) ? n : undefined;
    };
    return this.inventoryItemsService.findItemLedger(id, req.user, {
      page: parseNum(page),
      pageSize: parseNum(pageSize),
    });
  }

  /**
   * Etiqueta térmica PDF con QR.
   * @param qr `url` (defecto): enlace al detalle si hay FRONTEND_URL; si no, JSON. `json`: siempre JSON.
   * @param size `100x50` (mm, defecto) o `50x25`.
   */
  @Get(':id/label')
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
  findOne(@Param('id') id: string, @Req() req: any) {
    return this.inventoryItemsService.findOne(id, req.user);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateInventoryItemDto,
    @Req() req: any,
  ) {
    return this.inventoryItemsService.update(id, dto, req.user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: any) {
    return this.inventoryItemsService.remove(id, req.user);
  }
}
