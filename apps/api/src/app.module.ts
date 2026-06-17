import {
  MiddlewareConsumer,
  Module,
  NestModule,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { TenantMiddleware } from './common/tenant/tenant.middleware';
import { PrismaModule } from './prisma/prisma.module';
import { AddonsModule } from './modules/addons/addons.module';
import { AuthModule } from './modules/auth/auth.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { DiscoveryModule } from './modules/discovery/discovery.module';
import { OffersModule } from './modules/offers/offers.module';
import { OpenMatchesModule } from './modules/open-matches/open-matches.module';
import { PlayersModule } from './modules/players/players.module';
import { ReportsModule } from './modules/reports/reports.module';
import { TournamentsModule } from './modules/tournaments/tournaments.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { LoyaltyModule } from './modules/loyalty/loyalty.module';
import { MembershipsModule } from './modules/memberships/memberships.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { ReferralModule } from './modules/referral/referral.module';
import { SuperAdminModule } from './modules/super-admin/super-admin.module';
import { VenuesModule } from './modules/venues/venues.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    NotificationsModule,
    PaymentsModule,
    LedgerModule,
    LoyaltyModule,
    ReferralModule,
    MembershipsModule,
    AuthModule,
    SuperAdminModule,
    VenuesModule,
    BookingsModule,
    DiscoveryModule,
    AddonsModule,
    OffersModule,
    PlayersModule,
    OpenMatchesModule,
    TournamentsModule,
    ReportsModule,
  ],
  providers: [
    // JWT auth applied globally; routes opt out with @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Seed tenant context (AsyncLocalStorage) for every request before guards.
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
