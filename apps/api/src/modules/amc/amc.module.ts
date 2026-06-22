import {
  Controller,
  Injectable,
  Logger,
  Module,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { UserRole } from '@sportsbooking/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { NotificationService } from '../notifications/notification.service';
import { PrismaService } from '../../prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Send a renewal reminder when the AMC is due within this window. */
const REMINDER_WINDOW_DAYS = 7;
/** Auto-suspend once the AMC is overdue by more than this grace period. */
const GRACE_DAYS = 7;

export interface AmcRunSummary {
  /** Owner ids that received a renewal reminder this run. */
  reminded: string[];
  /** Owner ids actually suspended (production only). */
  suspended: string[];
  /**
   * Owner ids that WOULD be suspended but were left untouched because we are
   * not running in production (dry-run safety so the seeded demo owner survives
   * local testing).
   */
  wouldSuspend: string[];
}

/**
 * AMC (annual maintenance contract) lifecycle automation (PRD §3.2):
 * remind owners before their renewal date and auto-suspend owners who let the
 * contract lapse past the grace period. Cross-tenant by nature, so all reads
 * run under `withTenantBypass`.
 */
@Injectable()
export class AmcService {
  private readonly logger = new Logger(AmcService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  /** Daily cron entry point; delegates to the on-demand, testable runner. */
  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async handleCron(): Promise<void> {
    await this.runAmcCheck();
  }

  /**
   * Idempotent AMC sweep. Reminders log in any environment; suspension only
   * mutates data when NODE_ENV === 'production' — otherwise it is a dry-run.
   */
  async runAmcCheck(): Promise<AmcRunSummary> {
    const isProd = process.env.NODE_ENV === 'production';
    const now = new Date();
    const reminderCutoff = new Date(now.getTime() + REMINDER_WINDOW_DAYS * DAY_MS);
    const suspendCutoff = new Date(now.getTime() - GRACE_DAYS * DAY_MS);

    const reminded: string[] = [];
    const suspended: string[] = [];
    const wouldSuspend: string[] = [];

    const owners = await this.prisma.withTenantBypass((tx) =>
      tx.owner.findMany({
        where: {
          status: 'active',
          amcRenewalDate: { not: null },
        },
        select: {
          id: true,
          name: true,
          contactEmail: true,
          contactMobile: true,
          amcAmount: true,
          amcRenewalDate: true,
        },
      }),
    );

    for (const owner of owners) {
      const renewalDate = owner.amcRenewalDate;
      if (!renewalDate) continue;

      // Overdue past the grace period → suspend (or dry-run log).
      if (renewalDate < suspendCutoff) {
        if (isProd) {
          await this.prisma.withTenantBypass((tx) =>
            tx.owner.update({
              where: { id: owner.id },
              data: { status: 'suspended' },
            }),
          );
          suspended.push(owner.id);
          this.logger.warn(
            `AMC overdue: suspended owner ${owner.name} (${owner.id}); ` +
              `renewal was due ${renewalDate.toISOString()}`,
          );
        } else {
          wouldSuspend.push(owner.id);
          this.logger.warn(
            `[DRY-RUN] AMC overdue: WOULD suspend owner ${owner.name} ` +
              `(${owner.id}); renewal due ${renewalDate.toISOString()}. ` +
              `No change made (NODE_ENV=${process.env.NODE_ENV ?? 'undefined'}).`,
          );
        }
        continue;
      }

      // Due within the reminder window (and not yet overdue) → remind.
      if (renewalDate >= now && renewalDate <= reminderCutoff) {
        await this.sendReminder(owner);
        reminded.push(owner.id);
      }
    }

    this.logger.log(
      `AMC check complete: reminded=${reminded.length}, ` +
        `suspended=${suspended.length}, wouldSuspend=${wouldSuspend.length}`,
    );

    return { reminded, suspended, wouldSuspend };
  }

  private async sendReminder(owner: {
    id: string;
    name: string;
    contactEmail: string;
    contactMobile: string | null;
    amcAmount: unknown;
    amcRenewalDate: Date | null;
  }): Promise<void> {
    const dueOn = owner.amcRenewalDate
      ? owner.amcRenewalDate.toISOString().slice(0, 10)
      : 'soon';
    const amount = owner.amcAmount != null ? ` (₹${String(owner.amcAmount)})` : '';
    const message =
      `Reminder: your annual maintenance contract${amount} for ` +
      `${owner.name} is due for renewal on ${dueOn}. ` +
      `Please renew to avoid service suspension.`;

    // Dev uses the "log" notification driver, so these calls just log.
    const to = owner.contactMobile ?? owner.contactEmail;
    await this.notifications.sendWhatsApp(to, message);
    await this.notifications.sendSms(to, message);
  }
}

@Controller('super-admin/amc')
@UseGuards(RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class AmcController {
  constructor(private readonly amc: AmcService) {}

  /** Trigger the AMC sweep on demand (testable without waiting for the cron). */
  @Post('run')
  run(): Promise<AmcRunSummary> {
    return this.amc.runAmcCheck();
  }
}

@Module({
  controllers: [AmcController],
  providers: [AmcService],
})
export class AmcModule {}
