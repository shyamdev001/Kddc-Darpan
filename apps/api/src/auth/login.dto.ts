import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(254)
  email: string;

  @IsString()
  @MinLength(1, { message: 'Enter your password' })
  @MaxLength(200)
  password: string;
}

/** A 6-digit code from the phone, or a recovery code like "abcd-efgh". */
export class TwoFactorCodeDto {
  @IsString()
  @Matches(/^\s*(\d{3}\s?\d{3}|[A-Za-z0-9]{4}-?[A-Za-z0-9]{4})\s*$/, { message: 'Enter the 6-digit code from your phone, or a recovery code' })
  code: string;
}

export class DisableTwoFactorDto extends TwoFactorCodeDto {
  @IsString()
  @MinLength(1, { message: 'Enter your password' })
  @MaxLength(200)
  password: string;
}
