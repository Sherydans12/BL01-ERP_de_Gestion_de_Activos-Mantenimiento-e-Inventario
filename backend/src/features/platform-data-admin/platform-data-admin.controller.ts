import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PurgeTenantDomainDto } from './dto/purge-tenant-domain.dto';
import { PurgeLocalStorageDto } from './dto/purge-local-storage.dto';
import { CreateTenantDto } from './dto/create-tenant.dto';
import {
  PlatformDataAdminService,
  PURGE_DOMAINS,
  PurgeDomain,
} from './platform-data-admin.service';

@Controller('super-admin/platform')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
export class PlatformDataAdminController {
  constructor(private readonly platformData: PlatformDataAdminService) {}

  @Get('tenants')
  listTenants() {
    return this.platformData.listTenants();
  }

  @Get('local-storage')
  localStorageSummary() {
    return this.platformData.getLocalStorageSummary();
  }

  @Post('local-storage/purge')
  @HttpCode(200)
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  purgeLocalStorage(@Body() dto: PurgeLocalStorageDto) {
    return this.platformData.purgeLocalStorage(dto.confirmPhrase);
  }

  @Post('tenants')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  createTenant(@Body() dto: CreateTenantDto) {
    return this.platformData.createTenant(dto);
  }

  @Get('tenants/:tenantId/data-summary')
  dataSummary(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    return this.platformData.getTenantDataSummary(tenantId);
  }

  @Post('tenants/:tenantId/purge/:domain')
  @HttpCode(200)
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  purge(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('domain') domainParam: string,
    @Body() dto: PurgeTenantDomainDto,
  ) {
    const domain = domainParam as PurgeDomain;
    if (!PURGE_DOMAINS.includes(domain)) {
      throw new BadRequestException(
        `Dominio inválido. Use: ${PURGE_DOMAINS.join(', ')}`,
      );
    }
    return this.platformData.purgeDomain(tenantId, domain, dto.confirmTenantCode);
  }
}
