import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { SystemPermissions } from '../auth/constants/permissions.enum';
import { PurchaseDocumentsService } from './purchase-documents.service';
import type { PurchaseDocumentEntity } from '@prisma/client';
import { MAX_UPLOAD_FILE_BYTES } from '../../common/storage/file-upload.constants';
import {
  documentUploadPolicy,
  FileValidationInterceptor,
} from '../../common/storage/file-validation.interceptor';

const fileLimits = { limits: { fileSize: MAX_UPLOAD_FILE_BYTES } };

@Controller('purchase-documents')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PurchaseDocumentsController {
  constructor(private readonly service: PurchaseDocumentsService) {}

  @Get()
  @RequirePermissions(SystemPermissions.PURCHASES_DOCUMENT_READ)
  list(
    @Query('entity') entity: string,
    @Query('entityId') entityId: string,
    @Req() req: any,
  ) {
    return this.service.list(
      req.user.tenantId,
      entity as PurchaseDocumentEntity,
      entityId,
      req.user,
    );
  }

  @Post()
  @RequirePermissions(SystemPermissions.PURCHASES_DOCUMENT_MANAGE)
  @UseInterceptors(
    FileInterceptor('file', fileLimits),
    new FileValidationInterceptor(documentUploadPolicy),
  )
  upload(
    @Query('entity') entity: string,
    @Query('entityId') entityId: string,
    @UploadedFile()
    file: { buffer: Buffer; originalname: string; mimetype: string },
    @Req() req: any,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Archivo requerido');
    }
    return this.service.upload(
      req.user.tenantId,
      req.user.id,
      entity as PurchaseDocumentEntity,
      entityId,
      {
        buffer: file.buffer,
        originalname: file.originalname,
        mimetype: file.mimetype,
      },
      req.user,
    );
  }

  @Get(':id/file')
  @RequirePermissions(SystemPermissions.PURCHASES_DOCUMENT_READ)
  async download(
    @Param('id') id: string,
    @Req() req: any,
    @Res() res: Response,
  ) {
    await this.service.streamToResponse(id, req.user.tenantId, res, req.user);
  }

  @Delete(':id')
  @RequirePermissions(SystemPermissions.PURCHASES_DOCUMENT_MANAGE)
  delete(@Param('id') id: string, @Req() req: any) {
    return this.service.delete(id, req.user.tenantId, req.user.id, req.user);
  }
}
