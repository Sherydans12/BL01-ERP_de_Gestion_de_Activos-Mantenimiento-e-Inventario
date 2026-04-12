import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PurchaseRequisitionsService } from './purchase-requisitions.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('purchase-requisitions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PurchaseRequisitionsController {
  constructor(private readonly service: PurchaseRequisitionsService) {}

  @Get()
  findAll(
    @Req() req: any,
    @Query('contractId') contractId?: string,
    @Query('status') status?: string,
  ) {
    return this.service.findAll(req.user.tenantId, contractId, status);
  }

  @Get(':id')
  findById(@Param('id') id: string, @Req() req: any) {
    return this.service.findById(id, req.user.tenantId);
  }

  @Post()
  create(@Body() body: any, @Req() req: any) {
    return this.service.create(body, req.user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return this.service.update(id, body, req.user);
  }

  @Post(':id/submit')
  submit(@Param('id') id: string, @Req() req: any) {
    return this.service.submit(id, req.user);
  }

  @Post(':id/start-quoting')
  @Roles('ADMIN', 'SUPER_ADMIN', 'SUPERVISOR')
  startQuoting(@Param('id') id: string, @Req() req: any) {
    return this.service.startQuoting(id, req.user);
  }

  @Post(':id/quotations')
  @Roles('ADMIN', 'SUPER_ADMIN', 'SUPERVISOR')
  @UseInterceptors(FileInterceptor('attachment'))
  addQuotation(
    @Param('id') id: string,
    @Body() body: any,
    @UploadedFile() file: any,
    @Req() req: any,
  ) {
    const data = typeof body.data === 'string' ? JSON.parse(body.data) : body;
    return this.service.addQuotation(id, data, file, req.user);
  }

  @Post(':id/quotations/:qId/select')
  @Roles('ADMIN', 'SUPER_ADMIN', 'SUPERVISOR')
  selectQuotation(
    @Param('id') id: string,
    @Param('qId') qId: string,
    @Req() req: any,
  ) {
    return this.service.selectQuotation(id, qId, req.user);
  }
}
