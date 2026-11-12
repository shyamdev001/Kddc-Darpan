import { MIN_PASSWORD_LENGTH, UserRole } from '@darpan/shared';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateIf } from 'class-validator';

const ROLES = Object.values(UserRole);
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const PASSWORD_MSG = `Use at least ${MIN_PASSWORD_LENGTH} characters`;

export class CreateUserDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(254)
  email!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Enter a name' })
  @MaxLength(80)
  name!: string;

  @IsIn(ROLES)
  role!: UserRole;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  regionId?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  branchId?: string | null;

  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH, { message: PASSWORD_MSG })
  @MaxLength(200)
  password!: string;
}

export class UpdateUserDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Enter a name' })
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsIn(ROLES)
  role?: UserRole;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  regionId?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  branchId?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH, { message: PASSWORD_MSG })
  @MaxLength(200)
  password!: string;
}

export class ChangeOwnPasswordDto {
  @IsString()
  @MinLength(1, { message: 'Enter your current password' })
  @MaxLength(200)
  currentPassword!: string;

  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH, { message: PASSWORD_MSG })
  @MaxLength(200)
  newPassword!: string;
}
