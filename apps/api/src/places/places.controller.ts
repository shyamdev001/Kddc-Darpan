import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import {
  CreateBranchDto,
  CreateRegionDto,
  CreateTalukaDto,
  SetPlacePlaylistDto,
  UpdateBranchDto,
  UpdateRegionDto,
  UpdateTalukaDto,
} from './place.dto';
import { PlacesService } from './places.service';

/** Regions, talukas and branches, and the playlist set at each level. GET /branches (a flat list) lives in screens. */
@Controller()
export class PlacesController {
  constructor(private readonly places: PlacesService) {}

  @Get('places')
  tree() {
    return this.places.tree();
  }

  @Put('places/playlist')
  @Roles('HO_ADMIN')
  setPlaylist(@Body() dto: SetPlacePlaylistDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.places.setPlaylist(dto.level, dto.id, dto.playlistId, user, req.ip);
  }

  @Post('regions')
  @Roles('HO_ADMIN')
  createRegion(@Body() dto: CreateRegionDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.places.createRegion(dto, user, req.ip);
  }

  @Patch('regions/:id')
  @Roles('HO_ADMIN')
  updateRegion(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRegionDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.places.updateRegion(id, dto, user, req.ip);
  }

  @Delete('regions/:id')
  @Roles('HO_ADMIN')
  @HttpCode(204)
  removeRegion(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.places.removeRegion(id, user, req.ip);
  }

  @Post('talukas')
  @Roles('HO_ADMIN')
  createTaluka(@Body() dto: CreateTalukaDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.places.createTaluka(dto, user, req.ip);
  }

  @Patch('talukas/:id')
  @Roles('HO_ADMIN')
  updateTaluka(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTalukaDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.places.updateTaluka(id, dto, user, req.ip);
  }

  @Delete('talukas/:id')
  @Roles('HO_ADMIN')
  @HttpCode(204)
  removeTaluka(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.places.removeTaluka(id, user, req.ip);
  }

  @Post('branches')
  @Roles('HO_ADMIN')
  createBranch(@Body() dto: CreateBranchDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.places.createBranch(dto, user, req.ip);
  }

  @Patch('branches/:id')
  @Roles('HO_ADMIN')
  updateBranch(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBranchDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.places.updateBranch(id, dto, user, req.ip);
  }

  @Delete('branches/:id')
  @Roles('HO_ADMIN')
  @HttpCode(204)
  removeBranch(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.places.removeBranch(id, user, req.ip);
  }
}
