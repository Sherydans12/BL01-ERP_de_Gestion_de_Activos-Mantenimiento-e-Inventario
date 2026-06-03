import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  UseGuards,
  Req,
  UseInterceptors,
  UploadedFile,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { TenantConfigService } from './tenant-config.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { SystemPermissions } from '../auth/constants/permissions.enum';
import { UpdateTenantConfigDto } from './dto/update-tenant-config.dto';
import { UpdateTenantOperationalConfigDto } from './dto/update-tenant-operational-config.dto';
import {
  tenantLogoUploadPolicy,
  FileValidationInterceptor,
} from '../../common/storage/file-validation.interceptor';

const tenantLogoUploadLimits = {
  limits: { fileSize: tenantLogoUploadPolicy.maxBytes },
};

@Controller('tenant-config')
@UseGuards(JwtAuthGuard)
export class TenantConfigController {
  constructor(private readonly tenantConfigService: TenantConfigService) {}

  /** Branding y datos de tenant para layout (todos los autenticados). */
  @Get()
  getTenantConfig(@Req() req: any) {
    return this.tenantConfigService.getTenantConfig(req.user.tenantId);
  }

  @Post('logo')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.ADMIN_TENANT_CONFIG_UPDATE)
  @UseInterceptors(
    FileInterceptor('file', tenantLogoUploadLimits),
    new FileValidationInterceptor(tenantLogoUploadPolicy),
  )
  uploadTenantLogo(
    @Req() req: any,
    @UploadedFile()
    file: { buffer: Buffer; originalname: string; mimetype: string },
  ) {
    return this.tenantConfigService.uploadTenantLogo(req.user.tenantId, file);
  }

  @Post('logo-light')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.ADMIN_TENANT_CONFIG_UPDATE)
  @UseInterceptors(
    FileInterceptor('file', tenantLogoUploadLimits),
    new FileValidationInterceptor(tenantLogoUploadPolicy),
  )
  uploadTenantLogoLight(
    @Req() req: any,
    @UploadedFile()
    file: { buffer: Buffer; originalname: string; mimetype: string },
  ) {
    return this.tenantConfigService.uploadTenantLogoLight(
      req.user.tenantId,
      file,
    );
  }

  @Post('pdf-logo')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.ADMIN_TENANT_CONFIG_UPDATE)
  @UseInterceptors(
    FileInterceptor('file', tenantLogoUploadLimits),
    new FileValidationInterceptor(tenantLogoUploadPolicy),
  )
  uploadTenantPdfLogo(
    @Req() req: any,
    @UploadedFile()
    file: { buffer: Buffer; originalname: string; mimetype: string },
  ) {
    return this.tenantConfigService.uploadTenantPdfLogo(
      req.user.tenantId,
      file,
    );
  }

  @Patch()
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.ADMIN_TENANT_CONFIG_UPDATE)
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
    }),
  )
  updateTenantConfig(
    @Req() req: any,
    @Body() updateTenantConfigDto: UpdateTenantConfigDto,
  ) {
    return this.tenantConfigService.updateTenantConfig(
      req.user.tenantId,
      updateTenantConfigDto,
    );
  }

  /** Actualiza la configuración de turnos del tenant (ADMIN). */
  @Patch('operational')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.ADMIN_TENANT_CONFIG_UPDATE)
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
    }),
  )
  updateOperationalConfig(
    @Req() req: any,
    @Body() dto: UpdateTenantOperationalConfigDto,
  ) {
    return this.tenantConfigService.upsertOperationalConfig(req.user.tenantId, dto);
  }
}
