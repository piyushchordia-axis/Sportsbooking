import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@sportsbooking/shared';
import * as bcrypt from 'bcryptjs';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import {
  CurrentUser,
  RequestUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { DbService } from '../../db/db.service';
import type { DbTx } from '../../db';
import { users, venues } from '../../db/schema';

class CreateStaffDto {
  @IsString() name!: string;
  @IsEmail() email!: string;
  @IsString() @MinLength(8) password!: string;
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  assignedVenueIds!: string[];
}

class UpdateStaffDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  assignedVenueIds?: string[];
  @IsOptional() @IsBoolean() active?: boolean;
}

/** Public view of a staff user — NEVER includes passwordHash. */
interface StaffSummary {
  id: string;
  name: string;
  email: string | null;
  active: boolean;
  assignedVenueIds: string[];
}

/**
 * Owner-scoped staff login management (PRD §2.1, PRD-3). Owners create and
 * manage venue-scoped staff users (role 'staff') that authenticate via the
 * existing email/password staffLogin flow (auth.service). Every read/write is
 * scoped to the caller's owner in code — the dev DB connects as a superuser
 * that bypasses RLS, so we must never rely on RLS alone for isolation.
 */
@Injectable()
export class StaffService {
  constructor(private readonly db: DbService) {}

  private ownerId(user: RequestUser): string {
    if (!user.ownerId) throw new BadRequestException('No tenant context');
    return user.ownerId;
  }

  private toSummary(u: {
    id: string;
    name: string;
    email: string | null;
    active: boolean;
    assignedVenueIds: string[] | null;
  }): StaffSummary {
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      active: u.active,
      assignedVenueIds: u.assignedVenueIds ?? [],
    };
  }

  /**
   * Validate that every id in `venueIds` is a venue owned by this owner.
   * Rejects empty/foreign ids. Scoped by ownerId explicitly (defense-in-depth).
   */
  private async assertVenuesOwned(
    tx: DbTx,
    ownerId: string,
    venueIds: string[],
  ): Promise<void> {
    if (venueIds.length === 0) return;
    const owned = await tx.query.venues.findMany({
      where: and(inArray(venues.id, venueIds), eq(venues.ownerId, ownerId)),
      columns: { id: true },
    });
    if (owned.length !== venueIds.length) {
      throw new BadRequestException(
        'One or more venues do not belong to this owner',
      );
    }
  }

  /** Create a staff user under this owner with a bcrypt-hashed password. */
  async create(user: RequestUser, dto: CreateStaffDto): Promise<StaffSummary> {
    const ownerId = this.ownerId(user);

    return this.db.withTenantId(ownerId, async (tx) => {
      // Email is globally unique across all users; reject any existing match.
      const existing = await tx.query.users.findFirst({
        where: eq(users.email, dto.email),
      });
      if (existing) throw new ConflictException('Email already in use');

      await this.assertVenuesOwned(tx, ownerId, dto.assignedVenueIds);

      const passwordHash = await bcrypt.hash(dto.password, 10);
      const created = (
        await tx
          .insert(users)
          .values({
            id: randomUUID(),
            role: UserRole.STAFF,
            ownerId,
            name: dto.name,
            email: dto.email,
            passwordHash,
            active: true,
            assignedVenueIds: dto.assignedVenueIds,
          })
          .returning()
      )[0];
      return this.toSummary(created);
    });
  }

  /** List this owner's staff users (never returns passwordHash). */
  async list(user: RequestUser): Promise<StaffSummary[]> {
    const ownerId = this.ownerId(user);
    return this.db.withTenantId(ownerId, async (tx) => {
      const staff = await tx.query.users.findMany({
        where: and(eq(users.ownerId, ownerId), eq(users.role, UserRole.STAFF)),
        columns: {
          id: true,
          name: true,
          email: true,
          active: true,
          assignedVenueIds: true,
        },
        orderBy: desc(users.createdAt),
      });
      return staff.map((s) => this.toSummary(s));
    });
  }

  /**
   * Update a staff user owned by this owner (name / venue scoping / active).
   * 404s if the id is not a staff user under this owner; re-validates venue
   * ownership when assignedVenueIds is provided.
   */
  async update(
    user: RequestUser,
    id: string,
    dto: UpdateStaffDto,
  ): Promise<StaffSummary> {
    const ownerId = this.ownerId(user);
    return this.db.withTenantId(ownerId, async (tx) => {
      const existing = await tx.query.users.findFirst({
        where: and(
          eq(users.id, id),
          eq(users.ownerId, ownerId),
          eq(users.role, UserRole.STAFF),
        ),
      });
      if (!existing) throw new NotFoundException('Staff user not found');

      const data: {
        name?: string;
        assignedVenueIds?: string[];
        active?: boolean;
      } = {};
      if (dto.name !== undefined) data.name = dto.name;
      if (dto.active !== undefined) data.active = dto.active;
      if (dto.assignedVenueIds !== undefined) {
        await this.assertVenuesOwned(tx, ownerId, dto.assignedVenueIds);
        data.assignedVenueIds = dto.assignedVenueIds;
      }

      const updated = (
        await tx.update(users).set(data).where(eq(users.id, id)).returning()
      )[0];
      return this.toSummary(updated);
    });
  }

  /** Soft-deactivate a staff user owned by this owner (active=false). */
  async deactivate(user: RequestUser, id: string): Promise<StaffSummary> {
    const ownerId = this.ownerId(user);
    return this.db.withTenantId(ownerId, async (tx) => {
      const existing = await tx.query.users.findFirst({
        where: and(
          eq(users.id, id),
          eq(users.ownerId, ownerId),
          eq(users.role, UserRole.STAFF),
        ),
      });
      if (!existing) throw new NotFoundException('Staff user not found');

      const updated = (
        await tx
          .update(users)
          .set({ active: false })
          .where(eq(users.id, id))
          .returning()
      )[0];
      return this.toSummary(updated);
    });
  }
}

/**
 * Owner-scoped staff management endpoints (PRD-3). All routes are OWNER-only
 * and tenant-scoped to the authenticated owner.
 */
@Controller('staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER)
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateStaffDto) {
    return this.staff.create(user, dto);
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER)
  list(@CurrentUser() user: RequestUser) {
    return this.staff.list(user);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER)
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateStaffDto,
  ) {
    return this.staff.update(user, id, dto);
  }

  @Post(':id/deactivate')
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER)
  deactivate(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.staff.deactivate(user, id);
  }
}

@Module({
  controllers: [StaffController],
  providers: [StaffService],
})
export class StaffModule {}
