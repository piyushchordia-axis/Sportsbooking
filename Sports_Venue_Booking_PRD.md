# Multi-Venue Sports Booking & Facility Management Platform

### Product Requirements Document

**Version:** 2.1 — Packed v1 Scope (Web, All Roles)
**Sales Model:** One-time setup fee + Annual Maintenance Contract (AMC)
**Surface:** Web responsive, all roles
**Date:** June 2026
**Prepared by:** Enaa Creations

-----

## 1. Product Overview

This platform enables sports facility owners — turf grounds, pickleball courts, multi-sport academies, and event organizers — to list and manage venues, accept online bookings, run dynamic per-court pricing, sell memberships and add-ons, organize tournaments, host community open-matches, and build a marketable database of players.

It is sold to property owners on a one-time setup fee plus an Annual Maintenance Contract (AMC). A central Super Admin controls onboarding, configures the catalogue of supported games, and provisions each owner’s venue entitlement.

### 1.1 Goals

- Give owners a self-serve tool to manage availability, per-court pricing, and bookings across multiple properties.
- Let customers find and book slots fast — single, multiple, recurring, or as open matches.
- Drive retention and prepaid cash via session packs, loyalty credit, and referrals.
- Turn every booking into a captured player contact for WhatsApp/SMS offers.
- Make each owner’s instance feel like their own brand (white-label).

### 1.2 Scope Summary (v1)

|Included in v1                                           |Deferred                          |
|---------------------------------------------------------|----------------------------------|
|All three roles + venue-scoped staff logins              |Native mobile apps                |
|Per-court dynamic pricing, multi-slot & recurring booking|Per-booking commission billing    |
|Memberships (session packs) + loyalty + referral         |White-label subdomains            |
|Open matches with player profiles + skill level          |Live scoring / streaming          |
|Add-on sales (rental, café, coaching)                    |Standalone coach-management module|
|Tournaments (solo + team), offers, white-label theming   |Automated coach payouts           |

-----

## 2. User Roles & Hierarchy

|Role                      |Who They Are                        |Core Responsibilities                                                                                      |
|--------------------------|------------------------------------|-----------------------------------------------------------------------------------------------------------|
|**Super Admin**           |Platform owner (you)                |Configure games, onboard owners, set venue entitlement, manage AMC, oversight, white-label provisioning.   |
|**Property Owner (Admin)**|Paying customer — academy/turf owner|Manage venues, per-court pricing, blocking, memberships, offers, add-ons, tournaments, player CRM, reports.|
|**Staff / Manager**       |Owner’s on-ground team              |Day-to-day bookings, manual/walk-in bookings, check-ins, open-match oversight — scoped to assigned venues. |
|**Customer (Player)**     |End user / sports enthusiast        |Browse & book (single/multi/recurring), join open matches, buy packs, earn loyalty, join tournaments.      |

### 2.1 Authentication

- **Customer:** OTP (mobile) only.
- **Owner & Staff:** email/password with role-based access control (RBAC).
- **Staff scoping:** each staff login is restricted to the venue(s) the owner assigns.

### 2.2 Entitlement Model (Sales Setup)

During Super Admin setup each owner is provisioned with:

- **Allowed games:** subset of the global game catalogue they may operate.
- **Venue quota:** a free-form maximum number of venues the Super Admin types in per account.
- **Feature flags:** toggle tournaments, memberships, loyalty, open matches, add-ons per account.
- **Branding:** logo and colour theme applied across the owner’s instance (white-label).

-----

## 3. Super Admin Module

### 3.1 Game Catalogue Configuration

|Attribute          |Description                                               |
|-------------------|----------------------------------------------------------|
|Game name & icon   |e.g. Pickleball, Box Cricket, Turf Football, Badminton.   |
|Slot granularity   |Default booking duration (30 / 60 / 90 min).              |
|Bookable-unit label|Court, Turf, Lane, or Net.                                |
|Capacity           |Min/max players per unit — drives open-match & team logic.|
|Operating template |Default open/close hours a venue can override.            |

### 3.2 Owner Onboarding

1. Create the owner account with business & contact details.
1. Assign allowed games, venue quota (free-form), and feature flags.
1. Upload owner branding (logo, colour theme) for white-label.
1. Record commercial terms: one-time setup fee, AMC amount, renewal date.
1. Activate; owner receives credentials to configure venues.

### 3.3 Oversight

- Directory of owners, venues, and AMC/subscription status.
- AMC renewal reminders; suspend on non-renewal.
- Platform-wide aggregate booking & revenue analytics (read-only).

-----

## 4. Property Owner (Admin) Module

The core operational surface. An owner may hold multiple properties; screens are scoped by a property selector, with a consolidated cross-venue dashboard.

### 4.1 Multi-Property Management

- Create venues up to the assigned quota.
- Each venue: name, geo, photos, contact, supported game(s), and one or more bookable units (courts/turfs).
- Consolidated dashboard across all owned properties with per-venue drill-down.

### 4.2 Dynamic Pricing Engine (Per Court)

Pricing is rule-based and set **per individual bookable unit** — each court/turf can be priced independently. The most specific applicable rule wins at booking time.

|Dimension       |Example                      |Behaviour                            |
|----------------|-----------------------------|-------------------------------------|
|Base price      |₹800 / hour                  |Default rate for that specific unit. |
|Day-of-week     |Weekday vs Weekend           |Weekends higher.                     |
|Time-of-day band|Morning / Afternoon / Evening|Afternoons cheaper, evenings premium.|
|Date override   |Festival / holiday           |Special rate on specific dates.      |
|Duration        |Multi-hour                   |Optional tiered discount.            |


> **Note:** Owners configure a weekly price grid (day × time band) per court, so the customer always sees the resolved price before confirming.

### 4.3 Availability & Slot Blocking

- Block slots for maintenance, private events, or personal use — single, range, or recurring.
- Blocked slots vanish from the customer calendar instantly.
- Owners/staff can create manual (walk-in/offline) bookings that occupy slots.
- **Pay-at-venue no-shows:** owner sets a flat no-show penalty fee applied to the customer when a pay-at-venue booking is missed.

### 4.4 Memberships & Packages

Owners sell session-count packs (e.g. 10 plays) that load into the customer’s ledger and are debited per booking.

- **Pack definition:** name, number of sessions, price, validity/expiry, applicable venues & courts.
- **Pricing behaviour (per pack):** owner chooses whether the pack is flat-rate (ignores dynamic price) or discounts the dynamic price by a set %.
- **Ledger:** every pack purchase, debit, refund, and expiry is recorded in a unified customer ledger.
- **Expiry:** owner sets expiry behaviour per pack — forfeit unused sessions, roll over on new purchase, or no expiry.
- **Cancellation:** a cancelled pack-booking returns the session credit, not cash.

### 4.5 Loyalty & Referral

- **Loyalty points:** earned per booking/spend and redeemable as booking credit (drawn from the same ledger).
- **Referral:** each player gets a referral code; reward credit is released only after the referred player’s first paid booking.
- **Owner control:** earn rate, redemption value, and referral reward amount are owner-configurable, starting from a platform default the owner can override.

### 4.6 Add-on Sales

A per-venue catalogue of extras attached to a booking at checkout. Coaching is handled here as a simple add-on (no separate coach module in v1).

- Equipment rental (rackets, balls, shoes), café items, and coaching sessions.
- Each add-on: name, price, optional stock count, applicable venue.
- Add-ons appear as line items on the booking and in revenue reports.

### 4.7 Tournaments

- Create: game, venue, format (knockout / league / round-robin), dates, capacity, entry fee.
- **Registration:** solo or team, with a per-player or per-team fee.
- Online entry & fee collection; participant list, basic fixtures, results.
- Participants auto-added to the player database.

### 4.8 Offers & Promotions

- Percentage or flat discounts, promo codes, validity window, applicable venues/games.
- Target offers to player segments (lapsed, weekend regulars, etc.).
- Auto-apply or code redemption at checkout.

### 4.9 Player Database & Marketing

- Every booking, pack purchase, and tournament entry captures name + mobile into the owner’s CRM.
- Manual add, including bulk add of multiple players.
- Segment/filter (frequency, last visit, game, venue) and pitch offers via WhatsApp + SMS.

> **Compliance:** Contact capture and outreach must include consent capture and opt-out, per India’s DPDP Act.

### 4.10 Branding (White-label)

- Owner logo and colour theme applied across their instance in v1.
- Theming is token-based and architected so per-owner subdomains can be added later without rework.

### 4.11 Reports

- Bookings, revenue, occupancy %, peak-hour analysis — per venue and consolidated.
- Membership sales, ledger liability (outstanding sessions), loyalty & referral activity.
- Add-on revenue, offer redemption, tournament performance, player growth & repeat-rate.

-----

## 5. Customer (Player) Module

### 5.1 Profile

- Lightweight profile: name, mobile, preferred games, and self-rated skill level (powers open-match matching).
- Wallet/ledger view: session packs, loyalty points, referral credit, history.

### 5.2 Discovery & Booking

- Search venues by game, location, date, price.
- Live availability calendar with resolved per-court dynamic pricing.
- **Multi-slot & recurring:** book multiple slots or a repeating schedule in one cart.
- **Payment:** prepay online (Razorpay) or choose pay-at-venue; packs/points applied as credit.
- Apply promo codes and auto-applied targeted offers.
- Book across multiple properties from one account.

### 5.3 Open Matches / Find Players

Solves the “I have 2 players, need 4” problem — strong for pickleball and box cricket.

- **Host:** a player books a slot and opens spare spots as an open match.
- **Payment:** the host pays the full slot; joiners repay the host their share. The owner decides per venue whether repayment is in-app informational only or settled through the ledger.
- **Joining:** players request to join and the host approves each request.
- Skill level shown on profiles to help hosts pick compatible players.

### 5.4 Account & History

- Upcoming & past bookings; cancellation per the owner’s chosen policy template.
- Tournament registrations & status; saved venues; offers inbox.

-----

## 6. Key Workflows

### 6.1 Booking Flow

1. Select venue → game → court → date.
1. Calendar loads with resolved per-court prices.
1. Add one or more slots (or a recurring series) to cart; add add-ons.
1. Apply pack/points/offer; total recalculated.
1. Prepay or choose pay-at-venue → booking confirmed → slot locked → player captured.

### 6.2 Open-Match Flow

1. Host books a slot and marks spare spots open with required skill range.
1. Other players request to join; host approves.
1. Joiners repay the host their share; match roster fills.

### 6.3 Membership Purchase & Use

1. Customer buys a session pack → ledger credited.
1. At booking, pack is selected → flat-rate or %-discount applied per pack config → session debited.
1. Cancellation returns the session credit to the ledger.

### 6.4 Owner Onboarding Flow

1. Super Admin creates owner; assigns games, quota, flags, branding, AMC terms.
1. Owner logs in, creates venues within quota.
1. Owner sets courts, per-court price grids, packs, add-ons, operating hours.
1. Venue goes live and becomes discoverable.

-----

## 7. Non-Functional Requirements

|Area            |Requirement                                                                                        |
|----------------|---------------------------------------------------------------------------------------------------|
|Concurrency     |Slot locking must prevent double-booking under concurrent requests.                                |
|Ledger integrity|Wallet/pack/points must use an append-only transaction ledger; balances derived, never overwritten.|
|Performance     |Calendar + price resolution under 1s for a venue/day view.                                         |
|Multi-tenancy   |Strict isolation; an owner sees only their venues, players, and ledgers.                           |
|Payments        |Razorpay; idempotent confirmation; pay-at-venue tracked as a distinct settlement state.            |
|Notifications   |WhatsApp + SMS for confirmation, reminders, offers, and open-match updates.                        |
|Security        |RBAC; OTP customer login; audit log on admin actions; venue-scoped staff access.                   |
|Data protection |Consent capture + opt-out; DPDP-aligned handling of mobile numbers.                                |
|Theming         |Token-based white-label; per-owner branding without code changes; subdomain-ready.                 |
|Responsive      |Web responsive across desktop and mobile browsers.                                                 |

-----

## 8. Technical Stack & Data Model

- **Frontend:** React + Vite, responsive web for all roles, token-based theming.
- **Backend:** Node.js (Express/NestJS), REST API.
- **Database:** PostgreSQL, multi-tenant (tenant = owner).
- **Payments:** Razorpay.
- **Messaging:** WhatsApp Business API + SMS gateway.
- **Auth:** OTP for customers; email/password + RBAC for admins/staff.

### 8.1 Core Data Entities

|Entity        |Key Fields                                                                                                                |
|--------------|--------------------------------------------------------------------------------------------------------------------------|
|Owner (Tenant)|name, allowed_games[], venue_quota, feature_flags, branding, AMC_terms, status                                            |
|StaffUser     |owner_id, assigned_venue_ids[], role                                                                                      |
|Venue         |owner_id, name, geo, game(s), operating_hours, photos                                                                     |
|BookableUnit  |venue_id, name, capacity                                                                                                  |
|PricingRule   |unit_id, day_type, time_band, date_override, duration_tier, price                                                         |
|Slot/Block    |unit_id, datetime, status (open/booked/blocked)                                                                           |
|Booking       |customer_id, slots[], addons[], amount, pay_mode (prepay/at_venue), pack_id, offer_id, payment_status, no_show_fee_applied|
|MembershipPack|owner_id, sessions, price, validity, expiry_mode (forfeit/rollover/none), pricing_mode (flat/discount%), scope            |
|LedgerTxn     |customer_id, owner_id, type (pack_buy/debit/points_earn/points_redeem/refund), amount, balance_after, ref                 |
|Referral      |referrer_id, referee_id, status, reward_released_on_first_paid                                                            |
|OpenMatch     |booking_id, host_id, open_spots, skill_range, join_requests[], repayment_mode (info/ledger), status                       |
|PlayerProfile |customer_id, name, mobile, games[], skill_level, consent                                                                  |
|Addon         |venue_id, name, type (rental/cafe/coaching), price, stock                                                                 |
|VenueSettings |venue_id, cancellation_template, no_show_fee, loyalty_earn_rate, loyalty_redeem_value, open_match_repayment_mode          |
|Tournament    |venue_id, format, dates, reg_type (solo/team), fee_basis (per_player/per_team), fee, participants[]                       |
|Offer         |owner_id, type, value, code, validity, segment                                                                            |

-----

## 9. Delivery Phasing

v1 is packed, but sequenced so the heaviest modules don’t block launch. White-label theming is baked in throughout.

|Stage      |Scope                                                                                                                                               |Outcome                    |
|-----------|----------------------------------------------------------------------------------------------------------------------------------------------------|---------------------------|
|**Stage 1**|Super Admin setup, owner onboarding, venues, per-court pricing, single/multi/recurring booking, prepay + pay-at-venue, staff logins, player capture.|Bookable, sellable core.   |
|**Stage 2**|Membership packs + loyalty + referral on a unified ledger.                                                                                          |Prepaid cash & retention.  |
|**Stage 3**|Add-on sales (rental/café/coaching), offers & promo engine.                                                                                         |Higher revenue per booking.|
|**Stage 4**|Open matches + player profiles/skill level.                                                                                                         |Community engagement.      |
|**Stage 5**|Tournaments (solo + team), consolidated reports.                                                                                                    |Events & insight.          |

### Resolved configuration decisions

- Pack expiry — owner sets per pack (forfeit / rollover / none).
- Pay-at-venue no-shows — flat owner-set penalty fee.
- Open-match repayment — owner sets per venue (in-app informational or ledger-settled).
- Loyalty earn rate & redemption value — platform default, owner-overridable.

### Remaining items to confirm during build

- No-show fee collection for pay-at-venue — charged via saved payment method or tracked as dues?
- Recurring-booking price lock — lock price at series creation or resolve per occurrence?
- Tournament refunds — allowed after registration closes, and to what extent?