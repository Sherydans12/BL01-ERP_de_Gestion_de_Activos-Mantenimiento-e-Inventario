import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { SystemPermissions } from '../auth/constants/permissions.enum';
import { FaultReportsService } from './fault-reports.service';
import type { ListFaultReportsQuery } from './fault-reports.service';
import { CreateFaultReportDto } from './dto/create-fault-report.dto';

/** Multer limita el tamaño en el borde (10 MB = límite de adjuntos de falla). */
const FR_ATTACHMENT_FILE_LIMITS = { limits: { fileSize: 10 * 1024 * 1024 } };

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

  /**
   * POST /api/fault-reports/:id/attachments
   *
   * Adjunta evidencia multimedia (foto/video) a un reporte de falla existente.
   *
   * Reglas de negocio (validadas en servicio):
   *   - MIME: image/jpeg | image/png | image/webp | video/mp4.
   *   - Tamaño máximo: 10 MB (multer + doble validación en servicio).
   *   - Límite: 3 adjuntos por reporte.
   *
   * Form field name: `file`.
   */
  @Post(':id/attachments')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(SystemPermissions.OPERATIONS_FAULT_REPORT_CREATE)
  @UseInterceptors(FileInterceptor('file', FR_ATTACHMENT_FILE_LIMITS))
  uploadAttachment(
    @Param('id') id: string,
    @UploadedFile() file: any,
    @Req() req: any,
  ) {
    if (!file?.buffer) {
      throw new BadRequestException('Debe adjuntar un archivo.');
    }
    return this.faultReportsService.uploadAttachment(id, file, req.user);
  }
}
