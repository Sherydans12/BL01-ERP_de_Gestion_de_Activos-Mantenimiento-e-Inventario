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
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UpdateTenantConfigDto } from './dto/update-tenant-config.dto';
import {
  tenantLogoUploadPolicy,
  FileValidationInterceptor,
} from '../../common/storage/file-validation.interceptor';

const tenantLogoUploadLimits = {
  limits: { fileSize: tenantLogoUploadPolicy.maxBytes },
};

@Controller('tenant-config')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TenantConfigController {
  constructor(private readonly tenantConfigService: TenantConfigService) {}

  @Get()
  getTenantConfig(@Req() req: any) {
    return this.tenantConfigService.getTenantConfig(req.user.tenantId);
  }

  @Post('logo')
  @Roles('ADMIN', 'SUPER_ADMIN')
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

  @Patch()
  @Roles('ADMIN', 'SUPER_ADMIN')
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
}
