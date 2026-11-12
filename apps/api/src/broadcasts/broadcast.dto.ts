import { BROADCAST_KINDS, BROADCAST_MESSAGE_MAX, BROADCAST_TITLE_MAX, type BroadcastKind, type PlaylistSource } from '@darpan/shared';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateIf } from 'class-validator';

const LEVELS: PlaylistSource[] = ['ALL', 'REGION', 'TALUKA', 'BRANCH', 'SCREEN'];

export class StartBroadcastDto {
  @IsIn(BROADCAST_KINDS)
  kind!: BroadcastKind;

  @IsIn(LEVELS)
  level!: PlaylistSource;

  @ValidateIf((o: StartBroadcastDto) => o.level !== 'ALL')
  @IsUUID('all', { message: 'Choose where to show it' })
  targetId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(BROADCAST_TITLE_MAX, { message: `Keep the heading under ${BROADCAST_TITLE_MAX} characters` })
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(BROADCAST_MESSAGE_MAX, { message: `Keep the message under ${BROADCAST_MESSAGE_MAX} characters` })
  message?: string;

  @ValidateIf((o: StartBroadcastDto) => o.kind === 'MEDIA')
  @IsUUID('all', { message: 'Choose a poster or video' })
  mediaId?: string;

  @ValidateIf((o: StartBroadcastDto) => o.kind === 'LINK')
  @IsString({ message: 'Paste the link' })
  @MaxLength(2000)
  url?: string;

  @IsOptional()
  @IsBoolean()
  muted?: boolean;

  /** Up to a week. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(7 * 24 * 60)
  durationMin?: number;
}
