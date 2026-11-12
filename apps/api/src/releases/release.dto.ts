import { RELEASE_STAGES, type ReleaseStage } from '@darpan/shared';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class UploadReleaseDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class UpdateReleaseDto {
  @IsOptional()
  @IsIn(RELEASE_STAGES)
  stage?: ReleaseStage;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}

export class SetTestScreensDto {
  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID('all', { each: true })
  screenIds!: string[];
}
