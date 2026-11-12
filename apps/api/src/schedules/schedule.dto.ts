import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { BRIGHTNESS_MIN, DATE_RE, TIME_RE, type PlaylistSource } from '@darpan/shared';

const LEVELS: PlaylistSource[] = ['ALL', 'REGION', 'TALUKA', 'BRANCH', 'SCREEN'];

export class TimeSlotDto {
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  days!: number[];

  @ValidateIf((_o, v) => v !== null)
  @Matches(TIME_RE, { message: 'Times look like 09:30' })
  start!: string | null;

  @ValidateIf((_o, v) => v !== null)
  @Matches(TIME_RE, { message: 'Times look like 09:30' })
  end!: string | null;

  @ValidateIf((_o, v) => v !== null)
  @Matches(DATE_RE, { message: 'Dates look like 2026-11-07' })
  fromDate!: string | null;

  @ValidateIf((_o, v) => v !== null)
  @Matches(DATE_RE, { message: 'Dates look like 2026-11-07' })
  toDate!: string | null;
}

export class CreateScheduleDto {
  @IsIn(LEVELS)
  level!: PlaylistSource;

  @ValidateIf((o: CreateScheduleDto) => o.level !== 'ALL')
  @IsUUID()
  targetId?: string;

  @IsUUID()
  playlistId!: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Add at least one time' })
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => TimeSlotDto)
  slots!: TimeSlotDto[];
}

export class UpdateScheduleDto {
  @IsUUID()
  playlistId!: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Add at least one time' })
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => TimeSlotDto)
  slots!: TimeSlotDto[];
}

export class DisplayHoursDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Choose at least one day' })
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  days!: number[];

  @IsString()
  @Matches(TIME_RE, { message: 'Times look like 09:30' })
  on!: string;

  @IsString()
  @Matches(TIME_RE, { message: 'Times look like 09:30' })
  off!: string;

  @IsArray()
  @ArrayMaxSize(5)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(5, { each: true })
  closedSaturdays!: number[];

  @IsOptional()
  @IsInt({ message: 'Brightness is a whole number' })
  @Min(BRIGHTNESS_MIN, { message: `Brightness is at least ${BRIGHTNESS_MIN}%` })
  @Max(100, { message: 'Brightness is at most 100%' })
  brightness?: number | null;
}

export class SetDisplayHoursDto {
  @IsIn(LEVELS)
  level!: PlaylistSource;

  @ValidateIf((o: SetDisplayHoursDto) => o.level !== 'ALL')
  @IsUUID()
  targetId?: string;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @ValidateNested()
  @Type(() => DisplayHoursDto)
  hours!: DisplayHoursDto | null;
}
