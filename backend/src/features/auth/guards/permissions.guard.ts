import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  PERMISSIONS_ANY_KEY,
  PERMISSIONS_KEY,
} from '../decorators/permissions.decorator';

function hasGlobalRoleBypass(role: unknown): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMIN';
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredAll = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    const requiredAny = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_ANY_KEY,
      [context.getHandler(), context.getClass()],
    );

    const needsAll = Boolean(requiredAll?.length);
    const needsAny = Boolean(requiredAny?.length);
    if (!needsAll && !needsAny) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    if (hasGlobalRoleBypass(user?.role)) {
      return true;
    }

    const granted: string[] = Array.isArray(user?.permissions)
      ? user.permissions
      : [];

    if (needsAll) {
      const hasAll = requiredAll!.every((p) => granted.includes(p));
      if (!hasAll) {
        throw new ForbiddenException(
          'No tienes permisos suficientes para esta acción.',
        );
      }
    }

    if (needsAny) {
      const hasOne = requiredAny!.some((p) => granted.includes(p));
      if (!hasOne) {
        throw new ForbiddenException(
          'No tienes permisos suficientes para esta acción.',
        );
      }
    }

    return true;
  }
}
