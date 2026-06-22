-- Tournament entry-fee payment references (BUG-3).
-- Adds Razorpay order/payment id and an idempotency key to tournament
-- participants so a refund can be issued against the real captured payment id
-- (mirroring bookings.razorpayPaymentId) instead of the participant id, and so
-- concurrent/retried registrations by the same captain can be de-duplicated.
--
-- Hand-written to match prisma/schema.prisma exactly. Apply ONCE forward.
-- All columns are nullable, so this is safe on existing rows (no default
-- backfill, no table rewrite, no data loss).

ALTER TABLE "tournament_participants" ADD COLUMN "razorpayOrderId" TEXT;
ALTER TABLE "tournament_participants" ADD COLUMN "razorpayPaymentId" TEXT;
ALTER TABLE "tournament_participants" ADD COLUMN "idempotencyKey" TEXT;
