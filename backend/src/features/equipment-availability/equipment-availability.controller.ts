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
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import {
  RequirePermissions,
  RequireAnyPermissions,
} from '../auth/decorators/permissions.decorator';
import { SystemPermissions } from '../auth/constants/permissions.enum';
import { EquipmentAvailabilityService } from './equipment-availability.service';
import type { ListAvailabilityQuery } from './equipment-availability.service';
import { CreateEquipmentAvailabilityDto } from './dto/create-equipment-availability.dto';
import { UnreportedQueryDto } from './dto/unreported-query.dto';
import { ExportAvailabilityQueryDto } from './dto/export-availability-query.dto';
import { ImportAvailabilityCommitDto } from './dto/import-availability-commit.dto';
import { ShiftBoardQueryDto } from './dto/shift-board-query.dto';
import { BatchCreateAvailabilityDto } from './dto/batch-create-availability.dto';

/** Multer limit for Excel import: 5 MB is more than enough for any fleet template. */
const EXCEL_IMPORT_LIMITS = { limits: { fileSize: 5 * 1024 * 1024 } };

/**
 * API del Módulo de Disponibilidad Operativa Diaria.
 *
 * Seguridad en capas:
 *   1. JwtAuthGuard     — Bearer token válido y no expirado.
 *   2. PermissionsGuard — PBAC: cada endpoint requiere su permiso OPERATIONS_AVAILABILITY_*.
 *                         ADMIN y SUPER_ADMIN tienen bypass automático.
 *   3. Servicio (ABAC)  — tenantId extraído SIEMPRE del JWT; el equipo se valida
 *                         contra ese tenantId antes de cualquier escritura.
 *
 * Orden de rutas (crítico para NestJS):
 *   Rutas estáticas específicas deben ir ANTES de los parámetros dinámicos (:id)
 *   para que NestJS no interprete "unreported", "export", etc. como UUIDs.
 */
@Controller('equipment-availability')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class EquipmentAvailabilityController {
  constructor(
    private readonly availabilityService: EquipmentAvailabilityService,
  ) {}

  // ─── Static GET routes (must precede :id) ────────────────────────────────

  /**
   * GET /api/equipment-availability/shift-board
   *
   * Tablero del turno: KPIs + filas reportadas/pendientes/excluidas (paginado).
   */
  @Get('shift-board')
  @RequirePermissions(SystemPermissions.OPERATIONS_AVAILABILITY_MONITOR)
  getShiftBoard(@Req() req: any, @Query() query: ShiftBoardQueryDto) {
    return this.availabilityService.getShiftBoard(req.user, query);
  }

  /**
   * GET /api/equipment-availability/unreported
   *
   * Equipos activos sin reporte en el turno consultado (paginado).
   */
  @Get('unreported')
  @RequireAnyPermissions(
    SystemPermissions.OPERATIONS_AVAILABILITY_MONITOR,
    SystemPermissions.OPERATIONS_AVAILABILITY_CREATE,
  )
  findUnreported(@Req() req: any, @Query() query: UnreportedQueryDto) {
    return this.availabilityService.findUnreported(req.user, query);
  }

  /**
   * GET /api/equipment-availability/export?reportDate=YYYY-MM-DD&shift=DAY|NIGHT
   *
   * Genera y descarga la plantilla Excel (.xlsx) para el turno indicado.
   *
   * La plantilla incluye toda la flota operativa en el alcance del usuario,
   * pre-rellenando Estado/Horómetro/Observaciones para equipos ya reportados.
   * La hoja de datos queda protegida con dropdowns de Excel para el Estado.
   *
   * Requiere `operations:availability:create` — solo supervisores que pueden
   * reportar tienen acceso a la herramienta de carga masiva.
   */
  @Get('export')
  @RequirePermissions(SystemPermissions.OPERATIONS_AVAILABILITY_CREATE)
  async exportTemplate(
    @Query() query: ExportAvailabilityQueryDto,
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const data = await this.availabilityService.exportTemplate(query, req.user);
    const shiftLabel = query.shift === 'DAY' ? 'DIA' : 'NOCHE';
    const filename = `disponibilidad-${shiftLabel}-${query.reportDate}.xlsx`;
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    return new StreamableFile(data, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  }

  // ─── Static POST routes (import flow) ────────────────────────────────────

  /**
   * POST /api/equipment-availability/import/validate
   *
   * Fase 1 de la importación: parsea el .xlsx, valida cada fila contra la DB
   * y retorna un JSON de previsualización (dry-run, sin escrituras).
   *
   * El contexto del turno (reportDate, shift, tenantId) se extrae de la hoja
   * `_info` embebida en la plantilla exportada por este mismo sistema.
   *
   * Form field: `file` (multipart/form-data, .xlsx, máx 5 MB).
   */
  @Post('import/validate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(SystemPermissions.OPERATIONS_AVAILABILITY_CREATE)
  @UseInterceptors(FileInterceptor('file', EXCEL_IMPORT_LIMITS))
  async validateImport(@UploadedFile() file: any, @Req() req: any) {
    if (!file?.buffer) {
      throw new BadRequestException(
        'Debe adjuntar el archivo Excel (.xlsx) generado desde el sistema.',
      );
    }
    return this.availabilityService.validateImport(file.buffer, req.user);
  }

  /**
   * POST /api/equipment-availability/batch
   *
   * Creación masiva desde formulario web — éxito parcial por fila.
   */
  @Post('batch')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(SystemPermissions.OPERATIONS_AVAILABILITY_CREATE)
  batchCreate(@Body() dto: BatchCreateAvailabilityDto, @Req() req: any) {
    return this.availabilityService.batchCreate(dto, req.user);
  }

  /**
   * POST /api/equipment-availability/import/commit
   *
   * Fase 2 de la importación: persiste las filas validadas en la DB.
   *
   * El frontend envía el array de filas con action === 'CREATE' | 'UPDATE'
   * (las filas 'ERROR' y 'SKIP' deben excluirse antes de llamar a este endpoint).
   *
   * Política de éxito parcial: un error en una fila no cancela el lote completo.
   * Retorna { committed, errors } con el detalle de cualquier fila fallida.
   */
  @Post('import/commit')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(SystemPermissions.OPERATIONS_AVAILABILITY_CREATE)
  commitImport(@Body() dto: ImportAvailabilityCommitDto, @Req() req: any) {
    return this.availabilityService.commitImport(dto, req.user);
  }

  // ─── Generic routes ───────────────────────────────────────────────────────

  /**
   * GET /api/equipment-availability
   * Historial paginado. Filtros: equipmentId, shift, dateFrom, dateTo.
   */
  @Get()
  @RequirePermissions(SystemPermissions.OPERATIONS_AVAILABILITY_READ)
  findAll(@Req() req: any, @Query() query: ListAvailabilityQuery) {
    return this.availabilityService.findAll(req.user, query);
  }

  /**
   * GET /api/equipment-availability/:id
   * Detalle de un reporte específico (validado por tenantId del JWT).
   */
  @Get(':id')
  @RequirePermissions(SystemPermissions.OPERATIONS_AVAILABILITY_READ)
  findOne(@Param('id') id: string, @Req() req: any) {
    return this.availabilityService.findOne(id, req.user);
  }

  /**
   * POST /api/equipment-availability
   * Registra el estado del equipo para el turno actual (formulario individual).
   * Requiere `operations:availability:create` (supervisor de turno).
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(SystemPermissions.OPERATIONS_AVAILABILITY_CREATE)
  create(@Body() dto: CreateEquipmentAvailabilityDto, @Req() req: any) {
    return this.availabilityService.create(dto, req.user);
  }
}
