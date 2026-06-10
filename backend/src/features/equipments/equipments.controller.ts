import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  BadRequestException,
  HttpCode,
  HttpStatus,
  Param,
  Query,
  UseGuards,
  Req,
  Headers,
  Header,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { EquipmentsService } from './equipments.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { SystemPermissions } from '../auth/constants/permissions.enum';
import { BulkSyncMeterReadingsDto } from './dto/bulk-sync-meter-readings.dto';

const MASTER_IMPORT_LIMITS = { limits: { fileSize: 20 * 1024 * 1024 } };

function parseImportOptions(body: any): Record<string, unknown> {
  const raw = body?.options;
  if (!raw) return {};
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  try {
    return JSON.parse(String(raw)) as Record<string, unknown>;
  } catch {
    throw new BadRequestException('options debe ser JSON valido.');
  }
}

@Controller('equipments')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class EquipmentsController {
  constructor(private readonly equipmentsService: EquipmentsService) {}

  @Post()
  @RequirePermissions(SystemPermissions.OPERATIONS_EQUIPMENT_CREATE)
  create(
    @Body() createEquipmentDto: any,
    @Req() req: any,
    @Headers('x-site-id') siteId?: string,
    @Headers('x-contract-id') contractId?: string,
  ) {
    const activeContract = contractId || siteId;
    return this.equipmentsService.create(
      req.user,
      createEquipmentDto,
      activeContract,
    );
  }

  @Get()
  @RequirePermissions(SystemPermissions.OPERATIONS_EQUIPMENT_READ)
  findAll(
    @Req() req: any,
    @Headers('x-site-id') siteId?: string,
    @Headers('x-contract-id') contractId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('type') type?: string,
    @Query('brand') brand?: string,
    @Query('search') search?: string,
  ) {
    const activeContract = contractId || siteId;
    return this.equipmentsService.findAll(req.user, activeContract, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      type,
      brand,
      search,
    });
  }

  /** Listado compacto para captura masiva de horómetro (debe ir antes de `@Get(':id')`). */
  @Get('meter-capture-board')
  @RequirePermissions(SystemPermissions.OPERATIONS_METER_READING_READ)
  getMeterCaptureBoard(
    @Req() req: any,
    @Headers('x-site-id') siteId?: string,
    @Headers('x-contract-id') contractId?: string,
    @Query('type') type?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
  ) {
    const activeContract = contractId || siteId;
    return this.equipmentsService.findMeterCaptureBoard(
      req.user,
      activeContract,
      {
        type,
        search,
        limit: limit ? Number(limit) : undefined,
      },
    );
  }

  @Get('export/master')
  @RequirePermissions(SystemPermissions.OPERATIONS_EQUIPMENT_READ)
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  @Header('Pragma', 'no-cache')
  async exportMasterExcel(
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
    @Headers('x-site-id') siteId?: string,
    @Headers('x-contract-id') contractId?: string,
  ): Promise<StreamableFile> {
    const activeContract = contractId || siteId;
    const buffer = await this.equipmentsService.getFleetMasterExcelBuffer(
      req.user,
      activeContract,
    );
    const stamp = new Date().toISOString().slice(0, 10);
    res.set(
      'Content-Disposition',
      `attachment; filename="BaseLogic_Maestro_Flota_${stamp}.xlsx"`,
    );
    return new StreamableFile(buffer, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  }

  @Post('import/validate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(SystemPermissions.OPERATIONS_EQUIPMENT_UPDATE)
  @UseInterceptors(FileInterceptor('file', MASTER_IMPORT_LIMITS))
  validateMasterImport(
    @UploadedFile() file: any,
    @Req() req: any,
    @Headers('x-site-id') siteId?: string,
    @Headers('x-contract-id') contractId?: string,
  ) {
    if (!file?.buffer) {
      throw new BadRequestException('Debe adjuntar un archivo Excel .xlsx.');
    }
    const activeContract = contractId || siteId;
    return this.equipmentsService.validateFleetMasterImport(
      file.buffer,
      req.user,
      activeContract,
    );
  }

  @Post('import/commit')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(SystemPermissions.OPERATIONS_EQUIPMENT_UPDATE)
  @UseInterceptors(FileInterceptor('file', MASTER_IMPORT_LIMITS))
  commitMasterImport(
    @UploadedFile() file: any,
    @Body() body: any,
    @Req() req: any,
    @Headers('x-site-id') siteId?: string,
    @Headers('x-contract-id') contractId?: string,
  ) {
    if (!file?.buffer) {
      throw new BadRequestException('Debe adjuntar un archivo Excel .xlsx.');
    }
    const activeContract = contractId || siteId;
    return this.equipmentsService.commitFleetMasterImport(
      file.buffer,
      req.user,
      parseImportOptions(body),
      activeContract,
    );
  }

  /** Actualización masiva de lecturas en una sola transacción de base de datos. */
  @Post('meter-readings/bulk-sync')
  @RequirePermissions(SystemPermissions.OPERATIONS_METER_READING_CREATE)
  bulkSyncMeterReadings(
    @Req() req: any,
    @Body() body: BulkSyncMeterReadingsDto,
    @Headers('x-site-id') siteId?: string,
    @Headers('x-contract-id') contractId?: string,
  ) {
    const activeContract = contractId || siteId;
    return this.equipmentsService.bulkSyncMeterReadings(
      req.user,
      activeContract,
      body,
    );
  }

  @Get(':id/analytics')
  @RequirePermissions(SystemPermissions.OPERATIONS_EQUIPMENT_READ)
  getAnalytics(
    @Param('id') id: string,
    @Req() req: any,
    @Headers('x-site-id') siteId?: string,
    @Headers('x-contract-id') contractId?: string,
  ) {
    const activeContract = contractId || siteId;
    return this.equipmentsService.getAnalytics(req.user, id, activeContract);
  }

  @Get(':id/resume-pdf')
  @RequirePermissions(SystemPermissions.OPERATIONS_EQUIPMENT_READ)
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  @Header('Pragma', 'no-cache')
  async streamResumePdf(
    @Param('id') id: string,
    @Req() req: any,
    @Headers('x-site-id') siteId?: string,
    @Headers('x-contract-id') contractId?: string,
  ): Promise<StreamableFile> {
    const activeContract = contractId || siteId;
    const stream = await this.equipmentsService.getEquipmentResumePdfStream(
      req.user,
      id,
      activeContract,
    );
    return new StreamableFile(stream, {
      type: 'application/pdf',
      disposition: 'inline',
    });
  }

  @Get(':id/meter-snapshot')
  @RequirePermissions(SystemPermissions.OPERATIONS_METER_READING_READ)
  getMeterSnapshot(
    @Param('id') id: string,
    @Req() req: any,
    @Headers('x-site-id') siteId?: string,
    @Headers('x-contract-id') contractId?: string,
  ) {
    const activeContract = contractId || siteId;
    return this.equipmentsService.getMeterSnapshot(
      req.user,
      id,
      activeContract,
    );
  }

  @Get(':id')
  @RequirePermissions(SystemPermissions.OPERATIONS_EQUIPMENT_READ)
  findOne(
    @Param('id') id: string,
    @Req() req: any,
    @Headers('x-site-id') siteId?: string,
    @Headers('x-contract-id') contractId?: string,
  ) {
    const activeContract = contractId || siteId;
    return this.equipmentsService.findOne(req.user, id, activeContract);
  }

  @Put(':id')
  @RequirePermissions(SystemPermissions.OPERATIONS_EQUIPMENT_UPDATE)
  update(
    @Param('id') id: string,
    @Body() updateEquipmentDto: any,
    @Req() req: any,
    @Headers('x-site-id') siteId?: string,
    @Headers('x-contract-id') contractId?: string,
  ) {
    const activeContract = contractId || siteId;
    return this.equipmentsService.update(
      req.user,
      id,
      updateEquipmentDto,
      activeContract,
    );
  }

  @Delete(':id')
  @RequirePermissions(SystemPermissions.OPERATIONS_EQUIPMENT_DELETE)
  remove(
    @Param('id') id: string,
    @Req() req: any,
    @Headers('x-site-id') siteId?: string,
    @Headers('x-contract-id') contractId?: string,
  ) {
    const activeContract = contractId || siteId;
    return this.equipmentsService.remove(req.user, id, activeContract);
  }
}
