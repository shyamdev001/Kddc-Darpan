import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';

import { KIOSK_PIN_PATTERN, KIOSK_RELEASE_ACTIONS, REMOTE_COMMANDS, type KioskReleaseAction, type RemoteCommandType } from '@darpan/shared';

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

export class ReplaceScreenDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.replace(/\s/g, '') : value))
  @Matches(/^\d{6}$/, { message: 'Enter the 6-digit code shown on the TV' })
  pairingCode!: string;
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


export class SendCommandDto {
  @IsIn(REMOTE_COMMANDS, { message: 'Unknown command' })
  type!: RemoteCommandType;

  /** "volume" only. */
  @ValidateIf((o: SendCommandDto) => o.type === 'volume')
  @IsInt({ message: 'Volume must be a whole number from 0 to 100' })
  @Min(0, { message: 'Volume must be a whole number from 0 to 100' })
  @Max(100, { message: 'Volume must be a whole number from 0 to 100' })
  level?: number;
}

export class KioskReleaseDto {
  @IsIn(KIOSK_RELEASE_ACTIONS, { message: 'Choose exit or removeOwner' })
  action!: KioskReleaseAction;

  @IsString()
  @MinLength(6)
  @MaxLength(40)
  code!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(120)
  confirmName!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(300)
  reason!: string;
}

export class SetKioskPinDto {
  /** null (or left out) removes the PIN. */
  @IsOptional()
  @IsString()
  @Matches(KIOSK_PIN_PATTERN, { message: 'The PIN must be 6 to 12 digits.' })
  pin?: string | null;

  @IsString()
  @MinLength(6)
  @MaxLength(40)
  code!: string;
}
