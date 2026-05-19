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
  UseInterceptors,
  UploadedFile,
  UsePipes,
  ValidationPipe,
  StreamableFile,
  Header,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PurchaseRequisitionsService } from './purchase-requisitions.service';
import { SaveLineAwardsDto } from './dto/line-awards.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import {
  RequireAnyPermissions,
  RequirePermissions,
} from '../auth/decorators/permissions.decorator';
import { SystemPermissions } from '../auth/constants/permissions.enum';
import { MAX_UPLOAD_FILE_BYTES } from '../../common/storage/file-upload.constants';
import {
  documentUploadPolicy,
  FileValidationInterceptor,
} from '../../common/storage/file-validation.interceptor';

const quotationAttachmentLimits = {
  limits: { fileSize: MAX_UPLOAD_FILE_BYTES },
};

@Controller('purchase-requisitions')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PurchaseRequisitionsController {
  constructor(private readonly service: PurchaseRequisitionsService) {}

  @Get()
  @RequirePermissions(SystemPermissions.PURCHASES_REQUISITION_READ)
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

  @Get(':id/logs')
  @RequirePermissions(SystemPermissions.PURCHASES_REQUISITION_READ)
  findActivityLogs(@Param('id') id: string, @Req() req: any) {
    return this.service.findActivityLogs(id, req.user.tenantId);
  }

  @Get(':id/pdf')
  @RequirePermissions(SystemPermissions.PURCHASES_REQUISITION_READ)
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  @Header('Pragma', 'no-cache')
  async streamRequisitionPdf(
    @Param('id') id: string,
    @Req() req: any,
  ): Promise<StreamableFile> {
    const stream = await this.service.getRequisitionPdfStream(
      id,
      req.user.tenantId,
      req.user,
    );
    return new StreamableFile(stream, {
      type: 'application/pdf',
      disposition: 'inline',
    });
  }

  @Get(':id')
  @RequirePermissions(SystemPermissions.PURCHASES_REQUISITION_READ)
  findById(@Param('id') id: string, @Req() req: any) {
    return this.service.findById(id, req.user.tenantId, req.user);
  }

  @Post()
  @RequirePermissions(SystemPermissions.PURCHASES_REQUISITION_CREATE)
  create(@Body() body: any, @Req() req: any) {
    return this.service.create(body, req.user);
  }

  @Patch(':id')
  @RequireAnyPermissions(
    SystemPermissions.PURCHASES_REQUISITION_UPDATE_OWN,
    SystemPermissions.PURCHASES_REQUISITION_UPDATE_PURCHASING,
    SystemPermissions.PURCHASES_REQUISITION_UPDATE_ASSET_LINK,
  )
  update(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return this.service.update(id, body, req.user);
  }

  @Post(':id/submit')
  @RequirePermissions(SystemPermissions.PURCHASES_REQUISITION_SUBMIT)
  submit(@Param('id') id: string, @Req() req: any) {
    return this.service.submit(id, req.user);
  }

  @Post(':id/cancel')
  @RequirePermissions(SystemPermissions.PURCHASES_REQUISITION_CANCEL)
  cancel(
    @Param('id') id: string,
    @Body() body: { reason?: string },
    @Req() req: any,
  ) {
    return this.service.cancel(id, body?.reason, req.user);
  }

  @Post(':id/duplicate')
  @RequirePermissions(SystemPermissions.PURCHASES_REQUISITION_DUPLICATE)
  duplicate(@Param('id') id: string, @Req() req: any) {
    return this.service.duplicate(id, req.user);
  }

  @Post(':id/start-quoting')
  @RequirePermissions(SystemPermissions.PURCHASES_REQUISITION_START_QUOTING)
  startQuoting(@Param('id') id: string, @Req() req: any) {
    return this.service.startQuoting(id, req.user);
  }

  @Post(':id/quotations')
  @RequirePermissions(SystemPermissions.PURCHASES_REQUISITION_MANAGE_QUOTATIONS)
  @UseInterceptors(
    FileInterceptor('attachment', quotationAttachmentLimits),
    new FileValidationInterceptor(documentUploadPolicy),
  )
  addQuotation(
    @Param('id') id: string,
    @Body() body: any,
    @UploadedFile() file: any,
    @Req() req: any,
  ) {
    const data = typeof body.data === 'string' ? JSON.parse(body.data) : body;
    return this.service.addQuotation(id, data, file, req.user);
  }

  @Post(':id/quotations/:qId/select')
  @RequirePermissions(SystemPermissions.PURCHASES_REQUISITION_MANAGE_QUOTATIONS)
  selectQuotation(
    @Param('id') id: string,
    @Param('qId') qId: string,
    @Req() req: any,
  ) {
    return this.service.selectQuotation(id, qId, req.user);
  }

  @Post(':id/line-awards')
  @RequirePermissions(SystemPermissions.PURCHASES_REQUISITION_AWARD_LINES)
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  saveLineAwards(
    @Param('id') id: string,
    @Body() body: SaveLineAwardsDto,
    @Req() req: any,
  ) {
    return this.service.saveLineAwards(id, body, req.user);
  }
}
