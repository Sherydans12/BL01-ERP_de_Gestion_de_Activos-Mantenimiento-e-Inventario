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
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PurchaseRequisitionsService } from './purchase-requisitions.service';
import { SaveLineAwardsDto } from './dto/line-awards.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { MAX_UPLOAD_FILE_BYTES } from '../../common/storage/file-upload.constants';
import {
  documentUploadPolicy,
  FileValidationInterceptor,
} from '../../common/storage/file-validation.interceptor';

const quotationAttachmentLimits = { limits: { fileSize: MAX_UPLOAD_FILE_BYTES } };

@Controller('purchase-requisitions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PurchaseRequisitionsController {
  constructor(private readonly service: PurchaseRequisitionsService) {}

  @Get()
  findAll(
    @Req() req: any,
    @Query('contractId') contractId?: string,
    @Query('status') status?: string,
  ) {
    return this.service.findAll(
      req.user.tenantId,
      contractId,
      status,
      req.user,
    );
  }

  /** Historial de auditoría del requerimiento. Debe declararse antes de `GET :id`. */
  @Get(':id/logs')
  @Roles('ADMIN', 'SUPER_ADMIN', 'SUPERVISOR')
  findActivityLogs(@Param('id') id: string, @Req() req: any) {
    return this.service.findActivityLogs(id, req.user.tenantId);
  }

  @Get(':id')
  findById(@Param('id') id: string, @Req() req: any) {
    return this.service.findById(id, req.user.tenantId, req.user);
  }

  @Post()
  create(@Body() body: any, @Req() req: any) {
    return this.service.create(body, req.user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return this.service.update(id, body, req.user);
  }

  @Post(':id/submit')
  submit(@Param('id') id: string, @Req() req: any) {
    return this.service.submit(id, req.user);
  }

  @Post(':id/cancel')
  @Roles('ADMIN', 'SUPER_ADMIN', 'SUPERVISOR')
  cancel(
    @Param('id') id: string,
    @Body() body: { reason?: string },
    @Req() req: any,
  ) {
    return this.service.cancel(id, body?.reason, req.user);
  }

  @Post(':id/duplicate')
  duplicate(@Param('id') id: string, @Req() req: any) {
    return this.service.duplicate(id, req.user);
  }

  @Post(':id/start-quoting')
  @Roles('ADMIN', 'SUPER_ADMIN', 'SUPERVISOR')
  startQuoting(@Param('id') id: string, @Req() req: any) {
    return this.service.startQuoting(id, req.user);
  }

  @Post(':id/quotations')
  @Roles('ADMIN', 'SUPER_ADMIN', 'SUPERVISOR')
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
  @Roles('ADMIN', 'SUPER_ADMIN', 'SUPERVISOR')
  selectQuotation(
    @Param('id') id: string,
    @Param('qId') qId: string,
    @Req() req: any,
  ) {
    return this.service.selectQuotation(id, qId, req.user);
  }

  @Post(':id/line-awards')
  @Roles('ADMIN', 'SUPER_ADMIN', 'SUPERVISOR')
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
