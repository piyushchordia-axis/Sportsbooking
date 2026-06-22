import {
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { UserRole } from '@sportsbooking/shared';
import { IsString } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import {
  CurrentUser,
  RequestUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { DbService } from '../../db/db.service';
import { savedVenues, venues } from '../../db/schema';

class SaveVenueDto {
  @IsString() venueId!: string;
}

interface SavedVenueView {
  venueId: string;
  name: string;
  city: string | null;
  ownerId: string;
  savedAt: Date;
}

/**
 * Customer saved venues / favourites (PRD §5.4). The row is tenant-scoped by the
 * venue's owner, but a customer carries no owner context, so reads/writes run
 * under withTenantBypass with explicit customerId filtering — the same pattern
 * as the wallet and booking-history endpoints.
 */
@Injectable()
export class SavedVenuesService {
  constructor(private readonly db: DbService) {}

  async list(customerId: string): Promise<SavedVenueView[]> {
    return this.db.withTenantBypass(async (tx) => {
      const rows = await tx
        .select({
          venueId: savedVenues.venueId,
          savedAt: savedVenues.createdAt,
          name: venues.name,
          city: venues.city,
          ownerId: venues.ownerId,
        })
        .from(savedVenues)
        .innerJoin(venues, eq(savedVenues.venueId, venues.id))
        .where(eq(savedVenues.customerId, customerId))
        .orderBy(desc(savedVenues.createdAt));
      return rows;
    });
  }

  async save(customerId: string, venueId: string): Promise<{ saved: true }> {
    await this.db.withTenantBypass(async (tx) => {
      const venue = (
        await tx
          .select({ id: venues.id, ownerId: venues.ownerId, active: venues.active })
          .from(venues)
          .where(eq(venues.id, venueId))
          .limit(1)
      )[0];
      if (!venue || !venue.active) {
        throw new NotFoundException('Venue not found');
      }
      // Idempotent: saving an already-saved venue is a no-op.
      await tx
        .insert(savedVenues)
        .values({
          id: randomUUID(),
          ownerId: venue.ownerId,
          customerId,
          venueId,
        })
        .onConflictDoNothing();
    });
    return { saved: true };
  }

  async remove(customerId: string, venueId: string): Promise<{ removed: true }> {
    await this.db.withTenantBypass((tx) =>
      tx
        .delete(savedVenues)
        .where(
          and(
            eq(savedVenues.customerId, customerId),
            eq(savedVenues.venueId, venueId),
          ),
        ),
    );
    return { removed: true };
  }
}

@Controller('saved-venues')
@Roles(UserRole.CUSTOMER)
export class SavedVenuesController {
  constructor(private readonly service: SavedVenuesService) {}

  /** The signed-in customer's saved venues. */
  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.service.list(user.id);
  }

  /** Bookmark a venue. */
  @Post()
  save(@CurrentUser() user: RequestUser, @Body() dto: SaveVenueDto) {
    return this.service.save(user.id, dto.venueId);
  }

  /** Remove a saved venue. */
  @Delete(':venueId')
  remove(@CurrentUser() user: RequestUser, @Param('venueId') venueId: string) {
    return this.service.remove(user.id, venueId);
  }
}

@Module({
  controllers: [SavedVenuesController],
  providers: [SavedVenuesService],
})
export class SavedVenuesModule {}
