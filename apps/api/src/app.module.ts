import {
  MiddlewareConsumer,
  Module,
  NestModule,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { TenantMiddleware } from './common/tenant/tenant.middleware';
import { DbModule } from './db/db.module';
import { AddonsModule } from './modules/addons/addons.module';
import { AmcModule } from './modules/amc/amc.module';
import { AuthModule } from './modules/auth/auth.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { DiscoveryModule } from './modules/discovery/discovery.module';
import { OffersModule } from './modules/offers/offers.module';
import { OpenMatchesModule } from './modules/open-matches/open-matches.module';
import { OwnerSettingsModule } from './modules/owner-settings/owner-settings.module';
import { PlayersModule } from './modules/players/players.module';
import { ReportsModule } from './modules/reports/reports.module';
import { TournamentsModule } from './modules/tournaments/tournaments.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { LoyaltyModule } from './modules/loyalty/loyalty.module';
import { MembershipsModule } from './modules/memberships/memberships.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { NotificationFeedModule } from './modules/notification-feed/notification-feed.module';
import { RemindersModule } from './modules/notifications/reminders.module';
import { SearchModule } from './modules/search/search.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { ReferralModule } from './modules/referral/referral.module';
import { StaffModule } from './modules/staff/staff.module';
import { SuperAdminModule } from './modules/super-admin/super-admin.module';
import { VenuesModule } from './modules/venues/venues.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    DbModule,
    NotificationsModule,
    RemindersModule,
    PaymentsModule,
    LedgerModule,
    LoyaltyModule,
    ReferralModule,
    MembershipsModule,
    AuthModule,
    StaffModule,
    SuperAdminModule,
    VenuesModule,
    BookingsModule,
    DiscoveryModule,
    AddonsModule,
    OffersModule,
    PlayersModule,
    OwnerSettingsModule,
    OpenMatchesModule,
    TournamentsModule,
    ReportsModule,
    AmcModule,
    NotificationFeedModule,
    SearchModule,
  ],
  providers: [
    // JWT auth applied globally; routes opt out with @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Role enforcement applied globally AFTER JwtAuthGuard. RolesGuard returns
    // true when no @Roles() metadata is present, so @Public/no-role routes still
    // pass; @Roles() routes are enforced even without a per-route @UseGuards.
    { provide: APP_GUARD, useClass: RolesGuard },
    // Best-effort append-only audit logging for management mutations.
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Seed tenant context (AsyncLocalStorage) for every request before guards.
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
