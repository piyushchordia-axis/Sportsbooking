import {
  Controller,
  Get,
  Injectable,
  Module,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@sportsbooking/shared';
import { randomUUID } from 'node:crypto';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import {
  CurrentUser,
  RequestUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { DbService } from '../../db/db.service';
import { notifications } from '../../db/schema';

/** Allowed in-app notification kinds (mirrors the NotificationType enum). */
type NotificationFeedType =
  | 'booking_created'
  | 'booking_cancelled'
  | 'tournament_registration'
  | 'open_match_join'
  | 'amc_reminder'
  | 'general';

/** Payload for writing a new in-app notification for an owner. */
interface NewNotification {
  type: NotificationFeedType;
  title: string;
  body?: string | null;
  link?: string | null;
}

/** A single notification as returned to the bell feed. */
interface NotificationFeedItem {
  id: string;
  type: NotificationFeedType;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

/** The bell feed response: most-recent items plus the unread count. */
interface NotificationFeedList {
  items: NotificationFeedItem[];
  unread: number;
}

/** Map a stored notification row to the feed-item shape (owner + customer feeds). */
function toFeedItem(r: {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: Date | null;
  createdAt: Date;
}): NotificationFeedItem {
  return {
    id: r.id,
    type: r.type as NotificationFeedType,
    title: r.title,
    body: r.body ?? null,
    link: r.link ?? null,
    readAt: r.readAt ? r.readAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  };
}

/**
 * In-app notification feed (the owner/staff "bell"). This is distinct from the
 * outbound {@link NotificationService} (SMS/WhatsApp) — this service only reads
 * and writes the `notifications` table that backs the in-app feed.
 */
@Injectable()
export class NotificationFeedService {
  constructor(private readonly db: DbService) {}

  /**
   * Best-effort write of an in-app notification for a specific owner. Callers
   * (other modules) invoke this as a side effect of their own work, so it must
   * NEVER throw: a feed write failing can't be allowed to fail the booking /
   * registration / etc. that triggered it. Errors are swallowed.
   */
  async createForOwner(ownerId: string, n: NewNotification): Promise<void> {
    if (!ownerId) return;
    try {
      await this.db.withTenantId(ownerId, async (tx) => {
        await tx.insert(notifications).values({
          id: randomUUID(),
          ownerId,
          type: n.type,
          title: n.title,
          body: n.body ?? null,
          link: n.link ?? null,
        });
      });
    } catch {
      // Best-effort only: never propagate.
    }
  }

  /**
   * Best-effort write of an in-app notification for a specific CUSTOMER (the
   * player bell). Same never-throw contract as createForOwner. Customers carry
   * no owner context, so this writes under bypass with customerId set (ownerId
   * null) — the recipient is exactly one of the two.
   */
  async createForCustomer(customerId: string, n: NewNotification): Promise<void> {
    if (!customerId) return;
    try {
      await this.db.withTenantBypass(async (tx) => {
        await tx.insert(notifications).values({
          id: randomUUID(),
          ownerId: null,
          customerId,
          type: n.type,
          title: n.title,
          body: n.body ?? null,
          link: n.link ?? null,
        });
      });
    } catch {
      // Best-effort only: never propagate.
    }
  }

  /**
   * The customer's own notifications (newest first, capped at 30) + unread count.
   * Customers carry no owner context, so this runs under bypass with an explicit
   * customerId filter (the guard) — mirroring saved-venues / wallet.
   */
  listForCustomer(customerId: string): Promise<NotificationFeedList> {
    return this.db.withTenantBypass(async (tx) => {
      const rows = await tx.query.notifications.findMany({
        where: eq(notifications.customerId, customerId),
        orderBy: desc(notifications.createdAt),
        limit: 30,
      });
      const unreadRow = await tx
        .select({ value: count() })
        .from(notifications)
        .where(
          and(
            eq(notifications.customerId, customerId),
            isNull(notifications.readAt),
          ),
        );
      return {
        items: rows.map(toFeedItem),
        unread: Number(unreadRow[0]?.value ?? 0),
      };
    });
  }

  /** Mark one of the customer's notifications read (matched by id + customerId). */
  markReadForCustomer(customerId: string, id: string): Promise<void> {
    return this.db.withTenantBypass(async (tx) => {
      await tx
        .update(notifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(notifications.id, id),
            eq(notifications.customerId, customerId),
          ),
        );
    });
  }

  /** Mark all of the customer's currently-unread notifications read. */
  markAllReadForCustomer(customerId: string): Promise<void> {
    return this.db.withTenantBypass(async (tx) => {
      await tx
        .update(notifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(notifications.customerId, customerId),
            isNull(notifications.readAt),
          ),
        );
    });
  }

  /**
   * The owner's most-recent notifications (newest first, capped at 30) plus a
   * count of unread (readAt IS NULL) rows. Tenant-scoped via the request
   * context, so owner/staff only ever see their own tenant's feed.
   */
  list(user: RequestUser): Promise<NotificationFeedList> {
    // Explicit ownerId filter — RLS is not forced in prod, so withTenant alone
    // would return every tenant's notifications and a platform-wide unread count.
    const ownerId = user.ownerId!;
    return this.db.withTenant(async (tx) => {
      const rows = await tx.query.notifications.findMany({
        where: eq(notifications.ownerId, ownerId),
        orderBy: desc(notifications.createdAt),
        limit: 30,
      });

      const unreadRow = await tx
        .select({ value: count() })
        .from(notifications)
        .where(
          and(
            eq(notifications.ownerId, ownerId),
            isNull(notifications.readAt),
          ),
        );
      const unread = Number(unreadRow[0]?.value ?? 0);
      return { items: rows.map(toFeedItem), unread };
    });
  }

  /**
   * Mark a single notification read. Scoped to the caller's tenant (and matched
   * by id) so an owner can never flip another tenant's notification.
   */
  markRead(user: RequestUser, id: string): Promise<void> {
    return this.db.withTenant(async (tx) => {
      const ownerId = user.ownerId;
      await tx
        .update(notifications)
        .set({ readAt: new Date() })
        .where(
          ownerId
            ? and(
                eq(notifications.id, id),
                eq(notifications.ownerId, ownerId),
              )
            : eq(notifications.id, id),
        );
    });
  }

  /** Mark all of the owner's currently-unread notifications as read. */
  markAllRead(user: RequestUser): Promise<void> {
    return this.db.withTenant(async (tx) => {
      const ownerId = user.ownerId;
      await tx
        .update(notifications)
        .set({ readAt: new Date() })
        .where(
          ownerId
            ? and(
                eq(notifications.ownerId, ownerId),
                isNull(notifications.readAt),
              )
            : isNull(notifications.readAt),
        );
    });
  }
}

@Controller()
export class NotificationFeedController {
  constructor(private readonly feed: NotificationFeedService) {}

  /** Owner/staff in-app bell feed (recent items + unread count). */
  @Get('notifications')
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  list(@CurrentUser() user: RequestUser) {
    return this.feed.list(user);
  }

  /** Mark a single notification read. */
  @Post('notifications/:id/read')
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  markRead(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.feed.markRead(user, id);
  }

  /** Mark every unread notification read. */
  @Post('notifications/read-all')
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  markAllRead(@CurrentUser() user: RequestUser) {
    return this.feed.markAllRead(user);
  }
}

/** Player-facing in-app bell (customer). Separate from the owner/staff feed. */
@Controller('me/notifications')
export class MeNotificationsController {
  constructor(private readonly feed: NotificationFeedService) {}

  @Get()
  @UseGuards(RolesGuard)
  @Roles(UserRole.CUSTOMER)
  list(@CurrentUser() user: RequestUser) {
    return this.feed.listForCustomer(user.id);
  }

  @Post(':id/read')
  @UseGuards(RolesGuard)
  @Roles(UserRole.CUSTOMER)
  markRead(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.feed.markReadForCustomer(user.id, id);
  }

  @Post('read-all')
  @UseGuards(RolesGuard)
  @Roles(UserRole.CUSTOMER)
  markAllRead(@CurrentUser() user: RequestUser) {
    return this.feed.markAllReadForCustomer(user.id);
  }
}

@Module({
  controllers: [NotificationFeedController, MeNotificationsController],
  providers: [NotificationFeedService],
  // Exported so other modules can inject it to write feed entries best-effort.
  exports: [NotificationFeedService],
})
export class NotificationFeedModule {}
