import {
  IsString,
  IsOptional,
  IsEnum,
  IsArray,
  MaxLength,
} from 'class-validator';
import { UserRole } from '@prisma/client';

export class CreateTenantRoleDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  description?: string;

  @IsEnum(UserRole)
  baseRole: UserRole;

  @IsArray()
  @IsString({ each: true })
  routes: string[];
}
