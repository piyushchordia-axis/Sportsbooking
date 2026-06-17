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
import { AuthModule } from './modules/auth/auth.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { SuperAdminModule } from './modules/super-admin/super-admin.module';
import { VenuesModule } from './modules/venues/venues.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    NotificationsModule,
    PaymentsModule,
    LedgerModule,
    AuthModule,
    SuperAdminModule,
    VenuesModule,
    BookingsModule,
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
