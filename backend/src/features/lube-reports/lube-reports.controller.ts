import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { SystemPermissions } from '../auth/constants/permissions.enum';
import { LubeReportsService } from './lube-reports.service';
import { CreateLubeReportDto } from './dto/create-lube-report.dto';

/**
 * POST /api/lube-reports
 *
 * Seguridad en capas:
 *   1. JwtAuthGuard     — token Bearer válido y no expirado.
 *   2. PermissionsGuard — el usuario debe tener `operations:lube-report:create`
 *                         en su TenantRole.permissions (bypass automático para
 *                         ADMIN y SUPER_ADMIN).
 *   3. Servicio (ABAC)  — el tenantId se extrae SIEMPRE del JWT (req.user),
 *                         nunca del payload del cliente; la bodega y el equipo
 *                         son validados contra ese tenantId antes de cualquier
 *                         mutación de stock.
 */
@Controller('lube-reports')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class LubeReportsController {
  constructor(private readonly lubeReportsService: LubeReportsService) {}

  /**
   * Registra un despacho de lubricante desde una bodega origen (fija o virtual/camión).
   *
   * - Descuenta el stock físico del artículo en la bodega.
   * - Inyecta un movimiento `OUT / LUBE_DISPATCH` en el kardex inmutable.
   * - Actualiza el horómetro del equipo si se provee `meterReading`.
   * - Crea un `AssetCostRecord` tipo `LUBE_DISPATCH` con el costo CPP congelado.
   *
   * El `tenantId` y `userId` se obtienen del JWT — el cliente no puede inyectarlos.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(SystemPermissions.OPERATIONS_LUBE_REPORT_CREATE)
  create(@Body() dto: CreateLubeReportDto, @Req() req: any) {
    // req.user es poblado por JwtAuthGuard desde el token verificado.
    // El servicio extrae tenantId y userId exclusivamente de este objeto.
    return this.lubeReportsService.createReport(dto, req.user);
  }
}
