/**
 * Domain enums shared across API and web. Mirror the Prisma enums so the
 * client and server speak the same language (PRD §8.1).
 */

export enum UserRole {
  SUPER_ADMIN = 'super_admin',
  OWNER = 'owner',
  STAFF = 'staff',
  CUSTOMER = 'customer',
}

export enum OwnerStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  PENDING = 'pending',
}

/** Bookable-unit label configured per game (PRD §3.1). */
export enum UnitLabel {
  COURT = 'court',
  TURF = 'turf',
  LANE = 'lane',
  NET = 'net',
}

export enum SlotStatus {
  OPEN = 'open',
  BOOKED = 'booked',
  BLOCKED = 'blocked',
}

export enum DayType {
  WEEKDAY = 'weekday',
  WEEKEND = 'weekend',
}

export enum TimeBand {
  MORNING = 'morning',
  AFTERNOON = 'afternoon',
  EVENING = 'evening',
}

export enum PayMode {
  PREPAY = 'prepay',
  AT_VENUE = 'at_venue',
}

export enum PaymentStatus {
  PENDING = 'pending',
  PAID = 'paid',
  /** pay-at-venue, not yet settled on the ground */
  AWAITING_VENUE_SETTLEMENT = 'awaiting_venue_settlement',
  SETTLED_AT_VENUE = 'settled_at_venue',
  REFUNDED = 'refunded',
  FAILED = 'failed',
}

export enum BookingStatus {
  CONFIRMED = 'confirmed',
  CANCELLED = 'cancelled',
  COMPLETED = 'completed',
  NO_SHOW = 'no_show',
}

/** MembershipPack expiry behaviour (PRD §4.4). */
export enum PackExpiryMode {
  FORFEIT = 'forfeit',
  ROLLOVER = 'rollover',
  NONE = 'none',
}

/** MembershipPack pricing behaviour (PRD §4.4). */
export enum PackPricingMode {
  FLAT = 'flat',
  DISCOUNT = 'discount',
}

/** Append-only ledger transaction types (PRD §7, §8.1). */
export enum LedgerTxnType {
  PACK_BUY = 'pack_buy',
  PACK_DEBIT = 'pack_debit',
  PACK_REFUND = 'pack_refund',
  POINTS_EARN = 'points_earn',
  POINTS_REDEEM = 'points_redeem',
  REFERRAL_REWARD = 'referral_reward',
  NO_SHOW_FEE = 'no_show_fee',
  CASH_REFUND = 'cash_refund',
  OPEN_MATCH_SETTLE = 'open_match_settle',
}

export enum ReferralStatus {
  PENDING = 'pending',
  REWARDED = 'rewarded',
  EXPIRED = 'expired',
}

export enum OpenMatchStatus {
  OPEN = 'open',
  FULL = 'full',
  CANCELLED = 'cancelled',
  COMPLETED = 'completed',
}

export enum OpenMatchRepaymentMode {
  INFO = 'info',
  LEDGER = 'ledger',
}

export enum JoinRequestStatus {
  REQUESTED = 'requested',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

export enum AddonType {
  RENTAL = 'rental',
  CAFE = 'cafe',
  COACHING = 'coaching',
}

export enum TournamentFormat {
  KNOCKOUT = 'knockout',
  LEAGUE = 'league',
  ROUND_ROBIN = 'round_robin',
}

export enum RegistrationType {
  SOLO = 'solo',
  TEAM = 'team',
}

export enum FeeBasis {
  PER_PLAYER = 'per_player',
  PER_TEAM = 'per_team',
}

export enum OfferType {
  PERCENT = 'percent',
  FLAT = 'flat',
}

export enum SkillLevel {
  BEGINNER = 'beginner',
  INTERMEDIATE = 'advanced_beginner',
  ADVANCED = 'advanced',
  PRO = 'pro',
}

/** Per-account feature toggles set by Super Admin (PRD §2.2). */
export enum FeatureFlag {
  TOURNAMENTS = 'tournaments',
  MEMBERSHIPS = 'memberships',
  LOYALTY = 'loyalty',
  OPEN_MATCHES = 'open_matches',
  ADDONS = 'addons',
}
