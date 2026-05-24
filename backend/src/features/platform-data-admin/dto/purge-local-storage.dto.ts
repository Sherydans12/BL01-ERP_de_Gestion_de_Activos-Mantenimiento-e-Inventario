import { IsString, MinLength } from 'class-validator';

export class PurgeLocalStorageDto {
  @IsString()
  @MinLength(1)
  confirmPhrase!: string;
}
