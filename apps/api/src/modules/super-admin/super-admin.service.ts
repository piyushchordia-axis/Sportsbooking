import { Injectable } from '@nestjs/common';
import { OwnerStatus, UserRole } from '@sportsbooking/shared';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateGameDto, CreateOwnerDto } from './dto';

/**
 * Super Admin operations (PRD §3): global game catalogue, owner onboarding,
 * and oversight. Runs under RLS bypass (super admin context).
 */
@Injectable()
export class SuperAdminService {
  constructor(private readonly prisma: PrismaService) {}

  // ---- Game catalogue (PRD §3.1) ----
  listGames() {
    return this.prisma.gameCatalogue.findMany({ orderBy: { name: 'asc' } });
  }

  createGame(dto: CreateGameDto) {
    return this.prisma.gameCatalogue.create({
      data: {
        name: dto.name,
        iconUrl: dto.iconUrl,
        slotGranularityMin: dto.slotGranularityMin,
        unitLabel: dto.unitLabel,
        minPlayers: dto.minPlayers,
        maxPlayers: dto.maxPlayers,
        defaultOpenTime: dto.defaultOpenTime ?? '06:00',
        defaultCloseTime: dto.defaultCloseTime ?? '23:00',
      },
    });
  }

  // ---- Owner onboarding (PRD §3.2) ----
  async createOwner(dto: CreateOwnerDto) {
    return this.prisma.withTenantBypass(async (tx) => {
      const owner = await tx.owner.create({
        data: {
          name: dto.name,
          contactEmail: dto.contactEmail,
          contactMobile: dto.contactMobile,
          status: OwnerStatus.ACTIVE,
          venueQuota: dto.venueQuota,
          allowedGameIds: dto.allowedGameIds,
          featureFlags: dto.featureFlags,
          setupFee: dto.setupFee,
          amcAmount: dto.amcAmount,
          amcRenewalDate: dto.amcRenewalDate
            ? new Date(dto.amcRenewalDate)
            : undefined,
        },
      });

      // Provision the owner-admin login (PRD §3.2 step 5).
      await tx.user.create({
        data: {
          role: UserRole.OWNER,
          ownerId: owner.id,
          name: `${dto.name} Admin`,
          email: dto.contactEmail,
          passwordHash: await bcrypt.hash(dto.adminPassword, 10),
        },
      });

      return owner;
    });
  }

  // ---- Oversight (PRD §3.3) ----
  async listOwners() {
    return this.prisma.withTenantBypass(async (tx) => {
      const owners = await tx.owner.findMany({
        include: { _count: { select: { venues: true } } },
        orderBy: { createdAt: 'desc' },
      });
      return owners.map((o) => ({
        id: o.id,
        name: o.name,
        status: o.status,
        venueQuota: o.venueQuota,
        venueCount: o._count.venues,
        allowedGameIds: o.allowedGameIds,
        featureFlags: o.featureFlags,
        amcRenewalDate: o.amcRenewalDate?.toISOString() ?? null,
      }));
    });
  }

  async setOwnerStatus(ownerId: string, status: OwnerStatus) {
    return this.prisma.withTenantBypass((tx) =>
      tx.owner.update({ where: { id: ownerId }, data: { status } }),
    );
  }
}
