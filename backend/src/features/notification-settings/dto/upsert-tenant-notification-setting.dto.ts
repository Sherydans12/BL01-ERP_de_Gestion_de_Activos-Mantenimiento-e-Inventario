import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpsertTenantNotificationSettingDto {
  @IsString()
  @MaxLength(100)
  eventKey: string;

  @IsBoolean()
  enabled: boolean;

  /** Correos adicionales que siempre reciben CC cuando el evento se despacha por EMAIL. */
  @IsOptional()
  @IsArray()
  @IsEmail({}, { each: true })
  ccEmails?: string[];
}
