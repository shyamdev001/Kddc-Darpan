import { IMAGE_SEC_MAX, IMAGE_SEC_MIN, MAX_PLAYLIST_ITEMS } from '@darpan/shared';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

const tidy = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.normalize('NFC').replace(/\s+/g, ' ').trim() : value;

export class CreatePlaylistDto {
  @IsString()
  @Transform(tidy)
  @MinLength(1, { message: 'Give the playlist a name' })
  @MaxLength(120)
  name: string;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @Transform(tidy)
  @MaxLength(500)
  description?: string | null;

  @IsOptional()
  @IsInt()
  @Min(IMAGE_SEC_MIN, { message: `Posters must show for at least ${IMAGE_SEC_MIN} seconds` })
  @Max(IMAGE_SEC_MAX, { message: `Posters can show for at most ${IMAGE_SEC_MAX} seconds` })
  defaultImageSec?: number;
}

export class PlaylistItemInput {
  @IsUUID()
  mediaId: string;

  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(IMAGE_SEC_MIN)
  @Max(IMAGE_SEC_MAX)
  durationSec: number | null;
}

export class UpdatePlaylistDto {
  @IsOptional()
  @IsString()
  @Transform(tidy)
  @MinLength(1, { message: 'Give the playlist a name' })
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @Transform(tidy)
  @MaxLength(500)
  description?: string | null;

  @IsOptional()
  @IsInt()
  @Min(IMAGE_SEC_MIN)
  @Max(IMAGE_SEC_MAX)
  defaultImageSec?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_PLAYLIST_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => PlaylistItemInput)
  items?: PlaylistItemInput[];
}
