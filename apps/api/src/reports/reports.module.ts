import { Module } from '@nestjs/common';
import { PlayLogsController, ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  controllers: [ReportsController, PlayLogsController],
  providers: [ReportsService],
})
export class ReportsModule {}
