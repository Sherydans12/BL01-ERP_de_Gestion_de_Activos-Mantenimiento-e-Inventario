import { IsBoolean, IsOptional, IsString, Matches } from 'class-validator';

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const TIME_MSG = 'El horario debe tener formato HH:mm (24h), ej: 08:00';

export class UpdateTenantOperationalConfigDto {
  /** Habilitar o deshabilitar el Turno Noche para este tenant. */
  @IsBoolean()
  @IsOptional()
  hasNightShift?: boolean;

  /** Hora de inicio del Turno Día en formato HH:mm (24h), ej: "06:00". */
  @IsString()
  @IsOptional()
  @Matches(TIME_REGEX, { message: TIME_MSG })
  dayShiftStartTime?: string;

  /** Hora de inicio del Turno Noche en formato HH:mm (24h), ej: "18:00". */
  @IsString()
  @IsOptional()
  @Matches(TIME_REGEX, { message: TIME_MSG })
  nightShiftStartTime?: string;
}
