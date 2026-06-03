import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { SystemPermissions } from '../auth/constants/permissions.enum';
import { FaultReportsService } from './fault-reports.service';
import type { ListFaultReportsQuery } from './fault-reports.service';
import { CreateFaultReportDto } from './dto/create-fault-report.dto';

/**
 * API del Módulo de Registro de Fallas.
 *
 * Seguridad en capas:
 *   1. JwtAuthGuard     — Bearer token válido y no expirado.
 *   2. PermissionsGuard — PBAC por endpoint: READ / CREATE / MANAGE.
 *                         ADMIN y SUPER_ADMIN tienen bypass automático.
 *   3. Servicio (ABAC)  — tenantId extraído SIEMPRE del JWT; el equipo
 *                         se valida contra ese tenantId en la transacción.
 */
@Controller('fault-reports')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class FaultReportsController {
  constructor(private readonly faultReportsService: FaultReportsService) {}

  /**
   * POST /api/fault-reports
   *
   * Registra un evento de falla en terreno.
   * - Falla ALTA → OT NO_PROGRAMADA_REACTIVA + isOperational=false.
   * - Falla MEDIA → OT NO_PROGRAMADA_CORRECTIVA.
   * - Falla BAJA  → solo reporte (estado OPEN).
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(SystemPermissions.OPERATIONS_FAULT_REPORT_CREATE)
  create(@Body() dto: CreateFaultReportDto, @Req() req: any) {
    return this.faultReportsService.create(dto, req.user);
  }

  /**
   * GET /api/fault-reports
   *
   * Listado paginado con filtros opcionales:
   * equipmentId, criticality, status, dateFrom, dateTo.
   */
  @Get()
  @RequirePermissions(SystemPermissions.OPERATIONS_FAULT_REPORT_READ)
  findAll(@Req() req: any, @Query() query: ListFaultReportsQuery) {
    return this.faultReportsService.findAll(req.user, query);
  }

  /**
   * GET /api/fault-reports/:id
   *
   * Detalle completo de un reporte (valida tenantId del JWT).
   */
  @Get(':id')
  @RequirePermissions(SystemPermissions.OPERATIONS_FAULT_REPORT_READ)
  findOne(@Param('id') id: string, @Req() req: any) {
    return this.faultReportsService.findOne(id, req.user);
  }

  /**
   * POST /api/fault-reports/:id/create-work-order
   *
   * Escala manualmente un reporte BAJA a una OT correctiva.
   * Solo aplica a reportes en estado OPEN con criticality=LOW.
   * Requiere permiso MANAGE (planificador / supervisor).
   */
  @Post(':id/create-work-order')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(SystemPermissions.OPERATIONS_FAULT_REPORT_MANAGE)
  createWorkOrder(@Param('id') id: string, @Req() req: any) {
    return this.faultReportsService.createWorkOrderFromReport(id, req.user);
  }
}
