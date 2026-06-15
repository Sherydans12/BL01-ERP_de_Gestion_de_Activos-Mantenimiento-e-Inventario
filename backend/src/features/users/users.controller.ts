import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
  Query,
  Request,
  ParseIntPipe,
  UseInterceptors,
  UploadedFile,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { SystemPermissions } from '../auth/constants/permissions.enum';
import { extractLoginMeta } from '../auth/auth-request.util';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { AdminSetPasswordDto } from './dto/admin-set-password.dto';
import { TotpActivateDto } from './dto/totp-activate.dto';
import { TotpDisableDto } from './dto/totp-disable.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { MAX_USER_AVATAR_BYTES } from './user-avatar.constants';
import {
  avatarUploadPolicy,
  FileValidationInterceptor,
} from '../../common/storage/file-validation.interceptor';

const avatarUploadLimits = { limits: { fileSize: MAX_USER_AVATAR_BYTES } };

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /** Últimos inicios de sesión exitosos (auditoría de cuenta). */
  @Get('me/login-activity')
  getMyLoginActivity(@Req() req: any) {
    return this.usersService.getMyLoginActivity(req.user.id);
  }

  /** Perfil del usuario autenticado (sin contraseña). */
  @Get('me')
  getMe(@Req() req: any) {
    return this.usersService.getMe(req.user.id);
  }

  @Put('profile')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  updateProfile(@Req() req: any, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(req.user.id, dto);
  }

  @Post('profile/avatar')
  @UseInterceptors(
    FileInterceptor('file', avatarUploadLimits),
    new FileValidationInterceptor(avatarUploadPolicy),
  )
  uploadAvatar(
    @Req() req: any,
    @UploadedFile()
    file: { buffer: Buffer; originalname: string; mimetype: string },
  ) {
    return this.usersService.uploadAvatar(req.user.id, file);
  }

  @Post('change-password')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  changePassword(@Req() req: any, @Body() dto: ChangePasswordDto) {
    return this.usersService.changePassword(
      req.user.id,
      dto.oldPassword,
      dto.newPassword,
      extractLoginMeta(req),
    );
  }

  @Post('me/totp/begin')
  beginTotp(@Req() req: any) {
    return this.usersService.beginTotpEnrollment(req.user.id);
  }

  @Post('me/totp/activate')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  activateTotp(@Req() req: any, @Body() dto: TotpActivateDto) {
    return this.usersService.activateTotp(req.user.id, dto.code);
  }

  @Post('me/totp/disable')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  disableTotp(@Req() req: any, @Body() dto: TotpDisableDto) {
    return this.usersService.disableTotp(req.user.id, dto);
  }

  @Post('me/email-2fa/enable')
  enableEmail2fa(@Req() req: any) {
    return this.usersService.toggleEmail2fa(req.user.id, true);
  }

  @Post('me/email-2fa/disable')
  disableEmail2fa(@Req() req: any) {
    return this.usersService.toggleEmail2fa(req.user.id, false);
  }

  /** Lista compacta para participantes / supervisores en OT (operativo; sin PBAC admin). */
  @Get('assignable-for-ot')
  findAssignableForOt(@Req() req: any) {
    return this.usersService.findAssignableForOt(req.user.tenantId);
  }

  /** Sugerencias de búsqueda (nombre, email, rol) para el listado admin. */
  @Get('search-suggestions')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.ADMIN_USER_READ)
  searchSuggestions(
    @Req() req: any,
    @Query('q') q?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    const { tenantId, role } = req.user;
    return this.usersService.searchSuggestions(
      tenantId,
      role,
      q ?? '',
      limit ?? 8,
    );
  }

  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.ADMIN_USER_CREATE)
  create(@Body() body: any, @Req() req: any) {
    const requesterTenantId = req.user.tenantId;
    return this.usersService.create(body, requesterTenantId);
  }

  @Get()
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.ADMIN_USER_READ)
  findAll(
    @Req() req: any,
    @Query('page', new ParseIntPipe({ optional: true })) page: number = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit: number = 10,
    @Query('search') search?: string,
  ) {
    const { tenantId, role } = req.user;
    return this.usersService.findAll(tenantId, role, page, limit, search);
  }

  @Patch(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.ADMIN_USER_UPDATE)
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  update(@Param('id') id: string, @Body() body: UpdateUserDto, @Req() req: any) {
    const requesterTenantId = req.user.tenantId;
    const requesterRole = req.user.role;
    return this.usersService.update(
      id,
      body,
      requesterTenantId,
      requesterRole,
      req.user.id,
    );
  }

  @Delete(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.ADMIN_USER_DELETE)
  remove(@Param('id') id: string, @Req() req: any) {
    const requesterTenantId = req.user.tenantId;
    const requesterRole = req.user.role;
    return this.usersService.remove(id, requesterTenantId, requesterRole);
  }

  @Post(':id/resend-activation')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.ADMIN_USER_UPDATE)
  async resendActivation(@Param('id') id: string, @Request() req: any) {
    return this.usersService.resendActivation(
      id,
      req.user.tenantId,
      req.user.role,
    );
  }

  /** Contraseña nueva sin pedir la actual (solo otro usuario del tenant). */
  @Post(':id/set-password')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.ADMIN_USER_UPDATE)
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  adminSetPassword(
    @Param('id') id: string,
    @Body() dto: AdminSetPasswordDto,
    @Req() req: any,
  ) {
    return this.usersService.adminSetUserPassword(
      id,
      dto.newPassword,
      req.user.id,
      req.user.tenantId,
      req.user.role,
      extractLoginMeta(req),
    );
  }
}
