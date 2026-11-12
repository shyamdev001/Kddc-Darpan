import { MAX_ALERT_RECIPIENTS, OFFLINE_AFTER_CHOICES } from '@darpan/shared';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsIn, ValidateNested } from 'class-validator';
import { DisplayHoursDto } from '../schedules/schedule.dto';

const tidyEmails = ({ value }: { value: unknown }) =>
  Array.isArray(value) ? [...new Set(value.map((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v)).filter((v) => v !== ''))] : value;

export class UpdateAlertSettingsDto {
  @IsBoolean()
  enabled!: boolean;

  @IsIn(OFFLINE_AFTER_CHOICES, { message: 'Choose one of the offered times' })
  offlineAfterMin!: number;

  @IsArray()
  @Transform(tidyEmails)
  @ArrayMaxSize(MAX_ALERT_RECIPIENTS, { message: `At most ${MAX_ALERT_RECIPIENTS} email addresses` })
  @IsEmail({}, { each: true, message: 'One of the email addresses is not valid' })
  recipients!: string[];

  @ValidateNested()
  @Type(() => DisplayHoursDto)
  window!: DisplayHoursDto;
}
