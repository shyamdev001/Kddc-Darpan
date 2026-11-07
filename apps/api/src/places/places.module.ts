import { Module } from '@nestjs/common';
import { PlacesController } from './places.controller';
import { BranchImportService } from './branch-import.service';
import { PlacesService } from './places.service';

@Module({
  controllers: [PlacesController],
  providers: [PlacesService, BranchImportService],
})
export class PlacesModule {}
