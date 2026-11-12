import { MAX_PLAYLOG_BATCH } from '@darpan/shared';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsISO8601, IsOptional, IsUUID, Matches, Max, Min, ValidateNested } from 'class-validator';

export class PlayLogEntryDto {
  @IsUUID()
  mediaId!: string;

  @IsISO8601({ strict: true })
  startedAt!: string;

  @IsInt()
  @Min(0)
  @Max(24 * 3_600_000)
  durationMs!: number;
}

export class PlayLogBatchDto {
  @IsArray()
  @ArrayMaxSize(MAX_PLAYLOG_BATCH)
  @ValidateNested({ each: true })
  @Type(() => PlayLogEntryDto)
  entries!: PlayLogEntryDto[];
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class PlayReportQueryDto {
  @Matches(DAY, { message: 'from must be a date like 2026-11-01' })
  from!: string;

  @Matches(DAY, { message: 'to must be a date like 2026-11-30' })
  to!: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsUUID()
  screenId?: string;

  @IsOptional()
  @IsUUID()
  mediaId?: string;
}
