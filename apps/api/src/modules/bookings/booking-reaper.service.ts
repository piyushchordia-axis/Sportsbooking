import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BookingStatus, PayMode, PaymentStatus } from '@sportsbooking/shared';
import { and, eq, isNull, lt } from 'drizzle-orm';
import { DbService } from '../../db/db.service';
import { bookings as bookingsTable, slots as slotsTable } from '../../db/schema';

const MINUTE_MS = 60 * 1000;
/**
 * BOOK-3: how long an abandoned PREPAY booking may hold its slots before the
 * reaper releases them. Slot rows are inserted BEFORE payment (createOccurrence),
 * so a customer who opens Razorpay and walks away would otherwise hold the court
 * forever. 15 minutes is comfortably longer than a Razorpay checkout session.
 */
const STALE_PENDING_GRACE_MINUTES = 15;

export interface ReaperRunSummary {
  /** Booking ids cancelled (slots released) this run. */
  reaped: string[];
}

/**
 * BOOK-3: stale-PENDING reaper. A PREPAY booking whose payment never completed
 * (paymentStatus still 'pending', no razorpayPaymentId) keeps its occupying slot
 * rows indefinitely, blocking other customers. This cron sweeps such bookings
 * older than the grace window and cancels them: status → 'cancelled' and the
 * occupying slot rows are deleted (the exact slot-release done by cancel()).
 *
 * No money was ever captured (razorpayPaymentId IS NULL), so this intentionally
 * does NOT issue a refund and does NOT run loyalty/referral — it is a pure
 * release of an abandoned hold. Cross-tenant by nature, so the discovery read
 * runs under `withTenantBypass`; each release runs in the booking's own tenant
 * scope (mirroring cancel()).
 *
 * Dev/prod-safe by construction: the whole sweep is wrapped in try/catch and
 * never throws, and only PENDING/unpaid PREPAY bookings past the grace window
 * are touched.
 */
@Injectable()
export class BookingReaperService {
  private readonly logger = new Logger(BookingReaperService.name);

  constructor(private readonly db: DbService) {}

  /** Runs every 5 minutes; delegates to the on-demand, testable runner. */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleCron(): Promise<void> {
    await this.runReaperSweep();
  }

  /**
   * Idempotent-enough sweep: find abandoned PREPAY bookings (pending, unpaid,
   * older than the grace window) and release them. Each release is best-effort
   * and the whole method is guarded so it never throws out of the cron.
   */
  async runReaperSweep(): Promise<ReaperRunSummary> {
    const reaped: string[] = [];

    try {
      const cutoff = new Date(Date.now() - STALE_PENDING_GRACE_MINUTES * MINUTE_MS);

      // Abandoned PREPAY holds: prepay, still pending, never captured a payment,
      // created before the grace cutoff. Cross-tenant read under bypass.
      const stale = await this.db.withTenantBypass((tx) =>
        tx.query.bookings.findMany({
          where: and(
            eq(bookingsTable.payMode, PayMode.PREPAY),
            eq(bookingsTable.paymentStatus, PaymentStatus.PENDING),
            isNull(bookingsTable.razorpayPaymentId),
            lt(bookingsTable.createdAt, cutoff),
          ),
          columns: { id: true, ownerId: true, createdAt: true },
        }),
      );

      for (const booking of stale) {
        try {
          // Release in the booking's own tenant scope (mirrors cancel()): drop
          // the occupying slot rows, then mark the booking cancelled.
          await this.db.withTenantId(booking.ownerId, async (tx) => {
            await tx
              .delete(slotsTable)
              .where(eq(slotsTable.bookingId, booking.id));
            await tx
              .update(bookingsTable)
              .set({ status: BookingStatus.CANCELLED })
              .where(eq(bookingsTable.id, booking.id));
          });
          reaped.push(booking.id);
          this.logger.log(
            `Reaped abandoned PREPAY booking ${booking.id} ` +
              `(created ${booking.createdAt.toISOString()}, ` +
              `grace ${STALE_PENDING_GRACE_MINUTES}m): cancelled and slots released.`,
          );
        } catch (err) {
          // One booking's failure must not abort the rest of the sweep.
          this.logger.warn(
            `Reaper failed for booking ${booking.id}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }

      this.logger.log(`Booking reaper sweep complete: reaped=${reaped.length}`);
    } catch (err) {
      // Never throw out of the cron — log and move on.
      this.logger.error(
        `Booking reaper sweep failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return { reaped };
  }
}
