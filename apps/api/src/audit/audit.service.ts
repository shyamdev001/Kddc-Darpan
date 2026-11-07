import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  userId: string | null;
  action: string; // e.g. "auth.login", "media.upload", "playlist.update"
  entityType: string;
  entityId?: string | null;
  details?: Prisma.InputJsonValue;
  ipAddress?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Writes an AuditLog row. Never throws: a failed audit write must not break the action. */
  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: entry.userId,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          details: entry.details,
          ipAddress: entry.ipAddress,
        },
      });
    } catch (err) {
      this.logger.error(`Failed to write audit log for ${entry.action}`, err as Error);
    }
  }
}
