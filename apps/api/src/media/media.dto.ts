import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class ListMediaQuery {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @IsIn(['IMAGE', 'VIDEO'])
  type?: 'IMAGE' | 'VIDEO';

  @IsOptional()
  @IsIn(['UPLOADED', 'PROCESSING', 'READY', 'FAILED'])
  status?: 'UPLOADED' | 'PROCESSING' | 'READY' | 'FAILED';
}

export class UpdateMediaDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.normalize('NFC').replace(/\s+/g, ' ').trim() : value))
  @MinLength(1, { message: 'Name cannot be empty' })
  @MaxLength(200)
  displayName?: string;

  /** ISO date-time, or null to clear. */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsISO8601({ strict: true }, { message: 'Start date must be a valid date' })
  startDate?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsISO8601({ strict: true }, { message: 'End date must be a valid date' })
  endDate?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags?: string[];
}
