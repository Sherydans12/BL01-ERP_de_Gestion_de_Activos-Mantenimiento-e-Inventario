import { IsString, Length } from 'class-validator';

export class PurgeTenantDomainDto {
  /** Debe coincidir exactamente con `Tenant.code` (código corto de la empresa). */
  @IsString()
  @Length(1, 20)
  confirmTenantCode!: string;
}
