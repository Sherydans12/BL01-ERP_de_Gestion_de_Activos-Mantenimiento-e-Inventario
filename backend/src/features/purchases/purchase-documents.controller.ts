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
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PurchaseDocumentsService } from './purchase-documents.service';
import type { PurchaseDocumentEntity } from '@prisma/client';
import { MAX_UPLOAD_FILE_BYTES } from '../../common/storage/file-upload.constants';
import {
  documentUploadPolicy,
  FileValidationInterceptor,
} from '../../common/storage/file-validation.interceptor';

const fileLimits = { limits: { fileSize: MAX_UPLOAD_FILE_BYTES } };

@Controller('purchase-documents')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PurchaseDocumentsController {
  constructor(private readonly service: PurchaseDocumentsService) {}

  @Get()
  @Roles(
    'ADMIN',
    'SUPERVISOR',
    'SUPER_ADMIN',
    'MECHANIC',
    'STOREKEEPER',
    'PLANNER',
  )
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
  @Roles('ADMIN', 'SUPERVISOR', 'SUPER_ADMIN')
  @UseInterceptors(
    FileInterceptor('file', fileLimits),
    new FileValidationInterceptor(documentUploadPolicy),
  )
  upload(
    @Query('entity') entity: string,
    @Query('entityId') entityId: string,
    @UploadedFile() file: { buffer: Buffer; originalname: string; mimetype: string },
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
  @Roles(
    'ADMIN',
    'SUPERVISOR',
    'SUPER_ADMIN',
    'MECHANIC',
    'STOREKEEPER',
    'PLANNER',
  )
  async download(
    @Param('id') id: string,
    @Req() req: any,
    @Res() res: Response,
  ) {
    await this.service.streamToResponse(id, req.user.tenantId, res, req.user);
  }

  @Delete(':id')
  @Roles('ADMIN', 'SUPERVISOR', 'SUPER_ADMIN')
  delete(@Param('id') id: string, @Req() req: any) {
    return this.service.delete(id, req.user.tenantId, req.user.id, req.user);
  }
}
