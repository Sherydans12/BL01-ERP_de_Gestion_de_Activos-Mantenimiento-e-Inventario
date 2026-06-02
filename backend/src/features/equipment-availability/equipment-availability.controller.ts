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
import { EquipmentAvailabilityService } from './equipment-availability.service';
import type { ListAvailabilityQuery } from './equipment-availability.service';
import { CreateEquipmentAvailabilityDto } from './dto/create-equipment-availability.dto';
import { UnreportedQueryDto } from './dto/unreported-query.dto';

/**
 * API del Módulo de Disponibilidad Operativa Diaria.
 *
 * Seguridad en capas:
 *   1. JwtAuthGuard     — Bearer token válido y no expirado.
 *   2. PermissionsGuard — PBAC: cada endpoint requiere su permiso OPERATIONS_AVAILABILITY_*.
 *                         ADMIN y SUPER_ADMIN tienen bypass automático.
 *   3. Servicio (ABAC)  — tenantId extraído SIEMPRE del JWT; el equipo se valida
 *                         contra ese tenantId antes de cualquier escritura.
 */
@Controller('equipment-availability')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class EquipmentAvailabilityController {
  constructor(
    private readonly availabilityService: EquipmentAvailabilityService,
  ) {}

  /**
   * GET /api/equipment-availability/unreported
   *
   * Panel de alerta: equipos activos sin reporte en el turno consultado.
   * Requiere `operations:availability:monitor` (rol gerencial / admin).
   *
   * IMPORTANTE: este @Get('unreported') debe ir ANTES de @Get(':id')
   * para que NestJS no intente interpretar "unreported" como un UUID.
   */
  @Get('unreported')
  @RequirePermissions(SystemPermissions.OPERATIONS_AVAILABILITY_MONITOR)
  findUnreported(@Req() req: any, @Query() query: UnreportedQueryDto) {
    return this.availabilityService.findUnreported(req.user, query);
  }

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
   * Registra el estado del equipo para el turno actual.
   * Requiere `operations:availability:create` (supervisor de turno).
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(SystemPermissions.OPERATIONS_AVAILABILITY_CREATE)
  create(@Body() dto: CreateEquipmentAvailabilityDto, @Req() req: any) {
    return this.availabilityService.create(dto, req.user);
  }
}
