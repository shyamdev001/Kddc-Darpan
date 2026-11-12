import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { CreateUserDto, ResetPasswordDto, UpdateUserDto } from './users.dto';
import { UsersService } from './users.service';

/** Accounts are managed by super admins only (Roles always lets SUPER_ADMIN through). */
@Controller('users')
@Roles('SUPER_ADMIN')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list() {
    return this.users.overview();
  }

  @Post()
  create(@Body() dto: CreateUserDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.users.create(dto, user, req.ip);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.users.update(id, dto, user, req.ip);
  }

  @Put(':id/password')
  resetPassword(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ResetPasswordDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.users.resetPassword(id, dto.password, user, req.ip);
  }
}
