import { Body, Controller, Get, HttpCode, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { PlayReport } from '@darpan/shared';
import type { Request, Response } from 'express';
import { Public } from '../auth/decorators';
import { DeviceGuard } from '../screens/device-auth';
import { PlayLogBatchDto, PlayReportQueryDto } from './reports.dto';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('plays')
  plays(@Query() q: PlayReportQueryDto): Promise<PlayReport> {
    return this.reports.report(q);
  }

  @Get('plays/export')
  async export(@Query() q: PlayReportQueryDto, @Res() res: Response) {
    const csv = await this.reports.exportCsv(q);
    res
      .set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="proof-of-play-${q.from}-to-${q.to}.csv"`,
        'Cache-Control': 'no-store',
      })
      .send(csv);
  }
}

/** The TV's hourly upload of what it showed. Authenticated by device token. */
@Public()
@Controller('devices')
export class PlayLogsController {
  constructor(private readonly reports: ReportsService) {}

  @Post('playlogs')
  @HttpCode(200)
  @UseGuards(DeviceGuard)
  upload(@Body() dto: PlayLogBatchDto, @Req() req: Request) {
    return this.reports.ingest(req.screen!.id, dto.entries);
  }
}
