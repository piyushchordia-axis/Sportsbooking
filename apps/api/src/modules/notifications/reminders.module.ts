import { Injectable, Logger, Module } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BookingStatus } from '@sportsbooking/shared';
import { asc, eq } from 'drizzle-orm';
import { DbService } from '../../db/db.service';
import { bookings as bookingsTable, slots as slotsTable } from '../../db/schema';
import { NotificationService } from './notification.service';

const HOUR_MS = 60 * 60 * 1000;
/** Remind a customer when their booking starts within this window. */
const REMINDER_WINDOW_HOURS = 24;

export interface ReminderRunSummary {
  /** Booking ids a reminder was sent for this run. */
  reminded: string[];
  /** Booking ids skipped because no customer mobile was on file. */
  skipped: string[];
}

/**
 * PRD-9: upcoming-booking reminders. A daily cron finds CONFIRMED bookings
 * whose first slot starts within the next ~24h and nudges the customer on
 * their own mobile (WhatsApp + SMS). Cross-tenant by nature, so reads run
 * under `withTenantBypass`.
 *
 * Dev-safe by construction:
 *  - the whole sweep is wrapped in try/catch and never throws (a failure can
 *    never crash the scheduler / app),
 *  - only bookings inside the window are touched, so it is not spammy: dev seed
 *    data far in the past/future is naturally excluded, and the dev "log"
 *    notification driver just logs instead of hitting a gateway.
 */
@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    private readonly db: DbService,
    private readonly notifications: NotificationService,
  ) {}

  /** Daily cron entry point; delegates to the on-demand, testable runner. */
  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async handleCron(): Promise<void> {
    await this.runReminderSweep();
  }

  /**
   * Idempotent-enough reminder sweep (a simple window query): find confirmed
   * bookings starting within the next REMINDER_WINDOW_HOURS and message the
   * customer. Production-safe: every delivery is best-effort and the whole
   * method is guarded so it never throws.
   */
  async runReminderSweep(): Promise<ReminderRunSummary> {
    const reminded: string[] = [];
    const skipped: string[] = [];

    try {
      const now = new Date();
      const windowEnd = new Date(now.getTime() + REMINDER_WINDOW_HOURS * HOUR_MS);

      // Confirmed bookings whose FIRST upcoming slot falls inside the window.
      // We match on the occupying slot rows (a booking can span several slots);
      // an in-window slot is enough to surface a booking whose play time is
      // imminent. Past slots (startsAt < now) are excluded so we never remind
      // about a session that already started. The relational query builder
      // can't filter on a `many` relation, so we load confirmed bookings with
      // their slots and keep those with at least one slot inside the window.
      const allConfirmed = await this.db.withTenantBypass((tx) =>
        tx.query.bookings.findMany({
          where: eq(bookingsTable.status, BookingStatus.CONFIRMED),
          with: {
            slots: { orderBy: asc(slotsTable.startsAt) },
            venue: { columns: { name: true } },
            user: { columns: { mobile: true } },
          },
        }),
      );

      const bookings = allConfirmed.filter((b) =>
        b.slots.some((s) => s.startsAt >= now && s.startsAt <= windowEnd),
      );

      for (const booking of bookings) {
        try {
          const mobile = booking.user?.mobile?.trim();
          if (!mobile) {
            skipped.push(booking.id);
            continue;
          }

          const firstUpcoming = booking.slots.find(
            (s) => s.startsAt >= now,
          );
          const when = firstUpcoming
            ? firstUpcoming.startsAt.toISOString()
            : 'soon';
          const venueName = booking.venue?.name ?? 'the venue';
          const message =
            `Reminder: your booking at ${venueName} starts at ${when}. ` +
            `We look forward to seeing you!`;

          // Dev uses the "log" notification driver, so these just log.
          await this.notifications.sendWhatsApp(mobile, message);
          await this.notifications.sendSms(mobile, message);
          reminded.push(booking.id);
        } catch (err) {
          // One booking's failure must not abort the rest of the sweep.
          this.logger.warn(
            `Reminder failed for booking ${booking.id}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }

      this.logger.log(
        `Booking reminder sweep complete: reminded=${reminded.length}, ` +
          `skipped=${skipped.length}`,
      );
    } catch (err) {
      // Never throw out of the cron — log and move on.
      this.logger.error(
        `Booking reminder sweep failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return { reminded, skipped };
  }
}

@Module({
  providers: [RemindersService],
})
export class RemindersModule {}
