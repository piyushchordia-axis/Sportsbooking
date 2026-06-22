import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  PlayerSummary,
  SkillLevel,
  UserRole,
} from '@sportsbooking/shared';
import { Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import {
  CurrentUser,
  RequestUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { NotificationService } from '../notifications/notification.service';
import { PrismaService } from '../../prisma/prisma.service';

class UpdateProfileDto {
  @IsOptional() @IsEnum(SkillLevel) skillLevel?: SkillLevel;
  @IsOptional() @IsArray() @IsString({ each: true }) games?: string[];
}

class CreateCustomerDto {
  @IsString() name!: string;
  @IsString() mobile!: string;
  @IsBoolean() consent!: boolean;
}

class BulkAddDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateCustomerDto)
  customers!: CreateCustomerDto[];
}

/** DPDP consent / opt-out write for a single owner CRM link. */
class UpdateConsentDto {
  @IsOptional() @IsBoolean() optedOut?: boolean;
  @IsOptional() @IsBoolean() consent?: boolean;
}

/**
 * Owner marketing broadcast (PRD §4.9). `segment` reuses the same CRM list
 * filter (all / lapsed / regulars); `message` is the body fanned out over
 * SMS + WhatsApp to consented, non-opted-out contacts.
 */
class BroadcastDto {
  @IsOptional() @IsString() segment?: string;
  @IsString() message!: string;
}

/** Outcome of a marketing broadcast: consented contacts reached vs skipped. */
interface BroadcastResult {
  sent: number;
  skipped: number;
}

/** Per-row outcome for a bulk CRM add. */
interface BulkAddRowResult {
  mobile: string;
  ok: boolean;
  customerId?: string;
  error?: string;
}

interface BulkAddResult {
  results: BulkAddRowResult[];
  added: number;
  failed: number;
}

/**
 * Player profiles & CRM (PRD §4.9, §5.1). Skill level powers open-match
 * matching; the per-owner CRM supports segment/filter for marketing.
 */
@Injectable()
export class PlayersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * Customer updates their (per-owner) profile — skill level / games.
   *
   * The path `ownerId` is caller-supplied and must NOT be trusted: it is
   * validated against the JWT before it scopes any tenant write (SEC-11).
   *   - OWNER/STAFF may only target their own tenant (path === user.ownerId).
   *   - CUSTOMER (global, no JWT ownerId) may only edit a profile at an owner
   *     they are actually linked to (an OwnerCustomer row exists for the pair).
   * Anything else 403/404s rather than feeding an unvalidated path param into
   * withTenantId.
   */
  async updateProfile(
    user: RequestUser,
    ownerId: string,
    dto: UpdateProfileDto,
  ) {
    if (!ownerId) throw new BadRequestException('ownerId is required');

    // Owners/staff carry their tenant in the JWT — they may only touch it.
    if (user.role === UserRole.OWNER || user.role === UserRole.STAFF) {
      if (user.ownerId !== ownerId) {
        throw new ForbiddenException('Cannot edit profile for another tenant');
      }
    }

    const customerId = user.id;

    return this.prisma.withTenantId(ownerId, async (tx) => {
      // Customers may only edit their profile at an owner they are linked to.
      // The link lookup is tenant-scoped, so it also confirms (and never
      // leaks) cross-tenant membership.
      const link = await tx.ownerCustomer.findUnique({
        where: { ownerId_customerId: { ownerId, customerId } },
      });
      if (!link) {
        throw new NotFoundException('No profile for this owner');
      }

      return tx.playerProfile.update({
        where: { ownerId_customerId: { ownerId, customerId } },
        data: { skillLevel: dto.skillLevel, games: dto.games },
      });
    });
  }

  /** Owner CRM directory with simple frequency/recency segmentation. */
  list(user: RequestUser, segment?: string): Promise<PlayerSummary[]> {
    return this.prisma.withTenant(async (tx) => {
      const links = await tx.ownerCustomer.findMany({
        orderBy: { lastVisitAt: 'desc' },
      });
      const cutoff = new Date(Date.now() - 60 * 24 * 3600 * 1000);
      const filtered = links.filter((l) => {
        if (segment === 'lapsed') return l.lastVisitAt < cutoff;
        if (segment === 'regulars') return l.bookingCount >= 5;
        return true;
      });

      // Enrich with name + mobile. Prefer the per-owner player profile; fall
      // back to the (global) user record for any legacy CRM link without one.
      const customerIds = filtered.map((l) => l.customerId);
      const [profiles, users] = await Promise.all([
        tx.playerProfile.findMany({
          where: { customerId: { in: customerIds } },
        }),
        tx.user.findMany({ where: { id: { in: customerIds } } }),
      ]);
      const profileById = new Map(profiles.map((p) => [p.customerId, p]));
      const userById = new Map(users.map((u) => [u.id, u]));

      return filtered.map((l) => {
        const profile = profileById.get(l.customerId);
        const u = userById.get(l.customerId);
        return {
          customerId: l.customerId,
          name: profile?.name ?? u?.name ?? null,
          mobile: profile?.mobile ?? u?.mobile ?? null,
          bookingCount: l.bookingCount,
          lastVisitAt: l.lastVisitAt.toISOString(),
          consent: l.consent,
          optedOut: l.optedOut,
        };
      });
    });
  }

  /**
   * Owner/staff add a customer to their CRM directly (PRD §4.9). Find or create
   * the global user by mobile, then upsert the owner's CRM link + player
   * profile. Mirrors the auto-capture done on booking, minus a booking.
   */
  async addCustomer(
    user: RequestUser,
    dto: CreateCustomerDto,
  ): Promise<PlayerSummary> {
    const ownerId = user.ownerId;
    if (!ownerId) throw new BadRequestException('No tenant context');

    return this.prisma.withTenantId(ownerId, async (tx) => {
      let customer = await tx.user.findUnique({
        where: { mobile: dto.mobile },
      });
      if (!customer) {
        customer = await tx.user.create({
          data: { role: 'customer', name: dto.name, mobile: dto.mobile },
        });
      }

      const link = await tx.ownerCustomer.upsert({
        where: { ownerId_customerId: { ownerId, customerId: customer.id } },
        create: {
          ownerId,
          customerId: customer.id,
          consent: dto.consent,
          lastVisitAt: new Date(),
        },
        update: { consent: dto.consent },
      });

      const profile = await tx.playerProfile.upsert({
        where: { ownerId_customerId: { ownerId, customerId: customer.id } },
        create: {
          ownerId,
          customerId: customer.id,
          name: dto.name,
          mobile: dto.mobile,
          consent: dto.consent,
        },
        update: { name: dto.name, mobile: dto.mobile, consent: dto.consent },
      });

      return {
        customerId: customer.id,
        name: profile.name,
        mobile: profile.mobile,
        bookingCount: link.bookingCount,
        lastVisitAt: link.lastVisitAt.toISOString(),
        consent: link.consent,
        optedOut: link.optedOut,
      };
    });
  }

  /**
   * Bulk owner/staff CRM import (PRD §4.9). Each row reuses the same
   * find-or-create user + upsert link/profile logic as {@link addCustomer},
   * tenant-scoped to the caller's owner. One bad row never aborts the batch:
   * rows are validated and persisted independently, and failures are reported
   * per row rather than thrown.
   */
  async bulkAdd(user: RequestUser, dto: BulkAddDto): Promise<BulkAddResult> {
    const ownerId = user.ownerId;
    if (!ownerId) throw new BadRequestException('No tenant context');

    const results: BulkAddRowResult[] = [];
    for (const row of dto.customers) {
      const mobile = typeof row?.mobile === 'string' ? row.mobile.trim() : '';
      const name = typeof row?.name === 'string' ? row.name.trim() : '';
      if (!mobile || !name) {
        results.push({
          mobile,
          ok: false,
          error: 'name and mobile are required',
        });
        continue;
      }

      try {
        // Per-row transaction so a failure can't roll back already-added rows.
        const summary = await this.prisma.withTenantId(ownerId, (tx) =>
          this.upsertCustomer(tx, ownerId, {
            name,
            mobile,
            consent: row.consent,
          }),
        );
        results.push({ mobile, ok: true, customerId: summary.customerId });
      } catch (err) {
        results.push({
          mobile,
          ok: false,
          error: err instanceof Error ? err.message : 'failed',
        });
      }
    }

    const added = results.filter((r) => r.ok).length;
    return { results, added, failed: results.length - added };
  }

  /**
   * DPDP opt-out / consent write path (PRD §4.9). Updates the caller-owned
   * OwnerCustomer link (and mirrored PlayerProfile) for (ownerId, customerId).
   * Tenant scoping is enforced in code: if no link exists for this owner the
   * call 404s, so an owner can never edit another tenant's CRM record.
   * Setting `optedOut: true` records the customer withdrawing marketing consent.
   */
  async updateConsent(
    user: RequestUser,
    customerId: string,
    dto: UpdateConsentDto,
  ): Promise<PlayerSummary> {
    const ownerId = user.ownerId;
    if (!ownerId) throw new BadRequestException('No tenant context');

    return this.prisma.withTenantId(ownerId, async (tx) => {
      const existing = await tx.ownerCustomer.findUnique({
        where: { ownerId_customerId: { ownerId, customerId } },
      });
      if (!existing) {
        throw new NotFoundException('Customer not found in this CRM');
      }

      const linkData: { optedOut?: boolean; consent?: boolean } = {};
      if (dto.optedOut !== undefined) linkData.optedOut = dto.optedOut;
      if (dto.consent !== undefined) linkData.consent = dto.consent;

      const link = await tx.ownerCustomer.update({
        where: { ownerId_customerId: { ownerId, customerId } },
        data: linkData,
      });

      // Keep the player profile's consent flag in sync when provided.
      const profile =
        dto.consent !== undefined
          ? await tx.playerProfile
              .update({
                where: { ownerId_customerId: { ownerId, customerId } },
                data: { consent: dto.consent },
              })
              .catch(() => null)
          : await tx.playerProfile.findUnique({
              where: { ownerId_customerId: { ownerId, customerId } },
            });

      const u = await tx.user.findUnique({ where: { id: customerId } });

      return {
        customerId,
        name: profile?.name ?? u?.name ?? null,
        mobile: profile?.mobile ?? u?.mobile ?? null,
        bookingCount: link.bookingCount,
        lastVisitAt: link.lastVisitAt.toISOString(),
        consent: link.consent,
        optedOut: link.optedOut,
      };
    });
  }

  /**
   * Owner marketing broadcast (PRD §4.9). Resolves the chosen segment to the
   * owner's CRM contacts using the SAME filter as {@link list}, then keeps only
   * DPDP-eligible recipients (consent === true AND optedOut === false) with a
   * mobile on file. Each eligible contact is messaged over SMS + WhatsApp on a
   * best-effort basis: an individual delivery failure is swallowed (never
   * throws), a contact reached counts as `sent`, and a contact with no mobile
   * counts as `skipped`. Strictly tenant-scoped to `user.ownerId` so an owner
   * can never reach another tenant's customers.
   */
  async broadcast(
    user: RequestUser,
    dto: BroadcastDto,
  ): Promise<BroadcastResult> {
    const ownerId = user.ownerId;
    if (!ownerId) throw new BadRequestException('No tenant context');

    const message = typeof dto.message === 'string' ? dto.message.trim() : '';
    if (!message) throw new BadRequestException('message is required');

    // Resolve the segment to eligible recipients inside a tenant-scoped tx.
    const recipients = await this.prisma.withTenantId(ownerId, async (tx) => {
      const links = await tx.ownerCustomer.findMany({
        where: { ownerId },
        orderBy: { lastVisitAt: 'desc' },
      });

      const cutoff = new Date(Date.now() - 60 * 24 * 3600 * 1000);
      const eligible = links.filter((l) => {
        // Same segment filter as the CRM list.
        if (dto.segment === 'lapsed' && !(l.lastVisitAt < cutoff)) return false;
        if (dto.segment === 'regulars' && l.bookingCount < 5) return false;
        // DPDP: only consented, non-opted-out contacts may be marketed to.
        return l.consent === true && l.optedOut === false;
      });

      const customerIds = eligible.map((l) => l.customerId);
      const [profiles, users] = await Promise.all([
        tx.playerProfile.findMany({
          where: { customerId: { in: customerIds } },
        }),
        tx.user.findMany({ where: { id: { in: customerIds } } }),
      ]);
      const profileById = new Map(profiles.map((p) => [p.customerId, p]));
      const userById = new Map(users.map((u) => [u.id, u]));

      // Prefer the per-owner profile mobile; fall back to the global user.
      return eligible.map((l) => {
        const mobile =
          profileById.get(l.customerId)?.mobile ??
          userById.get(l.customerId)?.mobile ??
          null;
        return { mobile };
      });
    });

    let sent = 0;
    let skipped = 0;
    for (const r of recipients) {
      const mobile = typeof r.mobile === 'string' ? r.mobile.trim() : '';
      if (!mobile) {
        skipped += 1;
        continue;
      }
      // Best-effort fan-out: never let one contact's failure abort the batch.
      // NotificationService already swallows gateway errors, but guard here too
      // so any unexpected throw still counts as a skip rather than a 500.
      try {
        await Promise.all([
          this.notifications.sendSms(mobile, message),
          this.notifications.sendWhatsApp(mobile, message),
        ]);
        sent += 1;
      } catch {
        skipped += 1;
      }
    }

    return { sent, skipped };
  }

  /**
   * Shared find-or-create user + upsert CRM link/profile. Runs inside a
   * caller-provided tenant-scoped transaction so it can back both the single
   * and bulk add paths without nesting transactions.
   */
  private async upsertCustomer(
    tx: Prisma.TransactionClient,
    ownerId: string,
    dto: CreateCustomerDto,
  ): Promise<PlayerSummary> {
    let customer = await tx.user.findUnique({ where: { mobile: dto.mobile } });
    if (!customer) {
      customer = await tx.user.create({
        data: { role: 'customer', name: dto.name, mobile: dto.mobile },
      });
    }

    const link = await tx.ownerCustomer.upsert({
      where: { ownerId_customerId: { ownerId, customerId: customer.id } },
      create: {
        ownerId,
        customerId: customer.id,
        consent: dto.consent,
        lastVisitAt: new Date(),
      },
      update: { consent: dto.consent },
    });

    const profile = await tx.playerProfile.upsert({
      where: { ownerId_customerId: { ownerId, customerId: customer.id } },
      create: {
        ownerId,
        customerId: customer.id,
        name: dto.name,
        mobile: dto.mobile,
        consent: dto.consent,
      },
      update: { name: dto.name, mobile: dto.mobile, consent: dto.consent },
    });

    return {
      customerId: customer.id,
      name: profile.name,
      mobile: profile.mobile,
      bookingCount: link.bookingCount,
      lastVisitAt: link.lastVisitAt.toISOString(),
      consent: link.consent,
      optedOut: link.optedOut,
    };
  }
}

@Controller()
export class PlayersController {
  constructor(private readonly players: PlayersService) {}

  @Put('owners/:ownerId/profile')
  @UseGuards(RolesGuard)
  @Roles(UserRole.CUSTOMER)
  updateProfile(
    @CurrentUser() user: RequestUser,
    @Param('ownerId') ownerId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.players.updateProfile(user, ownerId, dto);
  }

  /** Owner CRM directory (PRD §4.9) with optional segment filter. */
  @Get('players')
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  list(@CurrentUser() user: RequestUser, @Query('segment') segment?: string) {
    return this.players.list(user, segment);
  }

  /** Owner/staff add a customer to the CRM (PRD §4.9). */
  @Post('players')
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  addCustomer(@CurrentUser() user: RequestUser, @Body() dto: CreateCustomerDto) {
    return this.players.addCustomer(user, dto);
  }

  /** Owner/staff bulk import into the CRM (PRD §4.9). */
  @Post('players/bulk')
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  bulkAdd(@CurrentUser() user: RequestUser, @Body() dto: BulkAddDto) {
    return this.players.bulkAdd(user, dto);
  }

  /** DPDP consent / opt-out update for a single owned CRM link (PRD §4.9). */
  @Patch('players/:customerId/consent')
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  updateConsent(
    @CurrentUser() user: RequestUser,
    @Param('customerId') customerId: string,
    @Body() dto: UpdateConsentDto,
  ) {
    return this.players.updateConsent(user, customerId, dto);
  }

  /**
   * Owner/staff marketing broadcast to a CRM segment (PRD §4.9). Fans the
   * message out over SMS/WhatsApp to consented, non-opted-out contacts.
   */
  @Post('players/broadcast')
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  broadcast(@CurrentUser() user: RequestUser, @Body() dto: BroadcastDto) {
    return this.players.broadcast(user, dto);
  }
}

@Module({
  controllers: [PlayersController],
  providers: [PlayersService],
})
export class PlayersModule {}
