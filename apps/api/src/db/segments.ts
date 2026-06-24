import { and, eq, isNotNull } from 'drizzle-orm';
import type { DbTx } from './index';
import { bookings, ownerCustomers } from './schema';

/**
 * The marketing segments a customer falls into for one owner (PRD §4.9). This is
 * the SINGLE source of truth, shared by offer scoping (bookings.service's
 * resolveOffer) and the customer offers inbox (offers.module), so the two can
 * never drift — a code-scoped offer applies exactly where the inbox advertises it.
 *
 *   new      — no bookings yet with this owner (incl. brand-new, no CRM link)
 *   lapsed   — last visit was more than 60 days ago
 *   regulars — 5 or more bookings
 *   members  — has booked on a membership pack with this owner
 */
export async function customerSegments(
  tx: DbTx,
  ownerId: string,
  customerId: string,
): Promise<string[]> {
  const segments: string[] = [];

  const link = await tx.query.ownerCustomers.findFirst({
    where: and(
      eq(ownerCustomers.ownerId, ownerId),
      eq(ownerCustomers.customerId, customerId),
    ),
  });
  const bookingCount = link?.bookingCount ?? 0;

  if (bookingCount === 0) {
    segments.push('new');
  } else {
    const cutoff = new Date(Date.now() - 60 * 24 * 3600 * 1000);
    if (link && link.lastVisitAt < cutoff) segments.push('lapsed');
    if (bookingCount >= 5) segments.push('regulars');
  }

  // Member = has at least one booking that redeemed a membership pack.
  const packBooking = await tx.query.bookings.findFirst({
    where: and(
      eq(bookings.ownerId, ownerId),
      eq(bookings.customerId, customerId),
      isNotNull(bookings.packId),
    ),
    columns: { id: true },
  });
  if (packBooking) segments.push('members');

  return segments;
}
