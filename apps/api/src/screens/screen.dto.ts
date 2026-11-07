import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().normalize('NFC') : value);
const ORIENTATIONS = ['LANDSCAPE', 'PORTRAIT'] as const;

export class RegisterDeviceDto {
  @IsString()
  @MinLength(4)
  @MaxLength(128)
  hardwareId!: string;

  @IsString()
  @MaxLength(120)
  model!: string;

  @IsString()
  @MaxLength(60)
  osVersion!: string;

  @IsString()
  @Matches(/^\d{2,5}x\d{2,5}$/, { message: 'resolution must look like 1920x1080' })
  resolution!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  appVersion?: string;
}

export class ClaimScreenDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.replace(/\s/g, '') : value))
  @Matches(/^\d{6}$/, { message: 'Enter the 6-digit code shown on the TV' })
  pairingCode!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Give the screen a name' })
  @MaxLength(80)
  name!: string;

  @IsUUID()
  branchId!: string;

  @IsOptional()
  @IsIn(ORIENTATIONS)
  orientation?: (typeof ORIENTATIONS)[number];

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  playlistId?: string | null;
}

export class UpdateScreenDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Give the screen a name' })
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsIn(ORIENTATIONS)
  orientation?: (typeof ORIENTATIONS)[number];
}

export class SetPlaylistDto {
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  playlistId!: string | null;
}

