import { IsOptional, IsUUID } from 'class-validator';

export class DeleteTenantRoleDto {
  @IsOptional()
  @IsUUID()
  replacementRoleId?: string;
}
