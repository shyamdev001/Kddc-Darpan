import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IMPORT_MAX_ROWS, type PlaceLevel } from '@darpan/shared';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').normalize('NFC') : value);
/** Empty text means "no value". */
const trimOrNull = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const v = value.trim().normalize('NFC');
  return v === '' ? null : v;
};
const LEVELS: PlaceLevel[] = ['ALL', 'REGION', 'TALUKA', 'BRANCH'];

export class CreateRegionDto {
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Enter a region name' })
  @MaxLength(80)
  name!: string;
}

export class UpdateRegionDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Enter a region name' })
  @MaxLength(80)
  name?: string;
}

export class CreateTalukaDto {
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Enter a taluka name' })
  @MaxLength(80)
  name!: string;

  @IsUUID()
  regionId!: string;
}

export class UpdateTalukaDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Enter a taluka name' })
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsUUID()
  regionId?: string;
}

export class CreateBranchDto {
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Enter a branch name' })
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    const v = trimOrNull({ value });
    return typeof v === 'string' ? v.toUpperCase() : v;
  })
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @Matches(/^[A-Z0-9-]{1,20}$/, { message: 'Branch code can use letters, digits and dashes (up to 20)' })
  code?: string | null;

  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(300)
  address?: string | null;

  @IsUUID()
  talukaId!: string;
}

export class UpdateBranchDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Enter a branch name' })
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    const v = trimOrNull({ value });
    return typeof v === 'string' ? v.toUpperCase() : v;
  })
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @Matches(/^[A-Z0-9-]{1,20}$/, { message: 'Branch code can use letters, digits and dashes (up to 20)' })
  code?: string | null;

  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(300)
  address?: string | null;

  @IsOptional()
  @IsUUID()
  talukaId?: string;
}

export class SetPlacePlaylistDto {
  @IsIn(LEVELS)
  level!: PlaceLevel;

  @ValidateIf((o: SetPlacePlaylistDto) => o.level !== 'ALL')
  @IsUUID()
  id?: string;

  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  playlistId!: string | null;
}

/** One pasted row. Kept loose on purpose: the import service checks each row and reports problems per line. */
export class ImportBranchRowDto {
  @IsInt()
  @Min(1)
  line!: number;

  @IsString()
  @MaxLength(500)
  region!: string;

  @IsString()
  @MaxLength(500)
  taluka!: string;

  @IsString()
  @MaxLength(500)
  name!: string;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(500)
  code?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(1000)
  address?: string | null;
}

export class ImportBranchesDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'There are no rows to import' })
  @ArrayMaxSize(IMPORT_MAX_ROWS, { message: `Import at most ${IMPORT_MAX_ROWS} branches at a time` })
  @ValidateNested({ each: true })
  @Type(() => ImportBranchRowDto)
  rows!: ImportBranchRowDto[];

  @IsBoolean()
  dryRun!: boolean;
}
