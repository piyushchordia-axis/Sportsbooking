import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { UserRole } from '@sportsbooking/shared';
import { and, count, desc, eq, type SQL } from 'drizzle-orm';
import { Roles } from '../../common/decorators/roles.decorator';
import { DbService } from '../../db/db.service';
import { auditLogs, users } from '../../db/schema';

/** A single audit-trail entry, enriched with the actor's name. */
interface AuditLogItem {
  id: string;
  actorId: string;
  actorName: string | null;
  actorRole: string;
  action: string;
  entity: string;
  entityId: string | null;
  metadata: unknown;
  createdAt: Date;
}

interface AuditLogPage {
  items: AuditLogItem[];
  total: number;
  page: number;
  pageSize: number;
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/**
 * Read side of the audit trail (PRD §4.x oversight). The global
 * AuditInterceptor writes a row per management mutation; this lists them back to
 * the owner, tenant-scoped by RLS (an owner sees only their org's actions).
 */
@Injectable()
export class AuditLogService {
  constructor(private readonly db: DbService) {}

  async list(filter: {
    action?: string;
    entity?: string;
    page?: number;
    pageSize?: number;
  }): Promise<AuditLogPage> {
    const page = Math.max(1, Number(filter.page) || 1);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Number(filter.pageSize) || DEFAULT_PAGE_SIZE),
    );

    const conds: SQL[] = [];
    if (filter.action) conds.push(eq(auditLogs.action, filter.action));
    if (filter.entity) conds.push(eq(auditLogs.entity, filter.entity));
    const where = conds.length ? and(...conds) : undefined;

    return this.db.withTenant(async (tx) => {
      const items = await tx
        .select({
          id: auditLogs.id,
          actorId: auditLogs.actorId,
          actorName: users.name,
          actorRole: auditLogs.actorRole,
          action: auditLogs.action,
          entity: auditLogs.entity,
          entityId: auditLogs.entityId,
          metadata: auditLogs.metadata,
          createdAt: auditLogs.createdAt,
        })
        .from(auditLogs)
        .leftJoin(users, eq(users.id, auditLogs.actorId))
        .where(where)
        .orderBy(desc(auditLogs.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      const total = (
        await tx.select({ c: count() }).from(auditLogs).where(where)
      )[0].c;

      return { items: items as AuditLogItem[], total, page, pageSize };
    });
  }

  /** Distinct entity labels present in the owner's log, for the filter dropdown. */
  async entities(): Promise<string[]> {
    return this.db.withTenant(async (tx) => {
      const rows = await tx
        .selectDistinct({ entity: auditLogs.entity })
        .from(auditLogs)
        .orderBy(auditLogs.entity);
      return rows.map((r) => r.entity);
    });
  }
}

@Controller('audit-logs')
export class AuditLogController {
  constructor(private readonly audit: AuditLogService) {}

  /** Owner oversight: the org's audit trail, filterable + paginated. */
  @Roles(UserRole.OWNER)
  @Get()
  list(
    @Query('action') action?: string,
    @Query('entity') entity?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<AuditLogPage> {
    return this.audit.list({
      action,
      entity,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  /** Distinct entity labels for the filter dropdown. */
  @Roles(UserRole.OWNER)
  @Get('entities')
  entities(): Promise<string[]> {
    return this.audit.entities();
  }
}

@Module({
  controllers: [AuditLogController],
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditLogModule {}
