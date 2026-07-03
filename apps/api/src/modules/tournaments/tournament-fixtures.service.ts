import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { IsInt, Min } from 'class-validator';
import { and, asc, eq } from 'drizzle-orm';
import { DbService } from '../../db/db.service';
import {
  tournamentMatches,
  tournamentParticipants,
  tournaments,
} from '../../db/schema';

export class RecordResultDto {
  @IsInt() @Min(0) scoreA!: number;
  @IsInt() @Min(0) scoreB!: number;
}

/** A bracket/league match shaped for the UI (participant labels resolved). */
export interface MatchView {
  id: string;
  round: number;
  position: number;
  participantAId: string | null;
  participantBId: string | null;
  aLabel: string | null;
  bLabel: string | null;
  scoreA: number | null;
  scoreB: number | null;
  winnerId: string | null;
  status: 'pending' | 'completed';
}

export interface StandingRow {
  participantId: string;
  label: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  points: number;
}

export interface Board {
  format: string;
  generated: boolean;
  rounds: number;
  matches: MatchView[];
  standings: StandingRow[];
}

/** Win = 3 pts, draw = 1 (league/round-robin standings). */
const WIN_POINTS = 3;
const DRAW_POINTS = 1;

type NewMatch = typeof tournamentMatches.$inferInsert;

/**
 * Generate and manage a tournament's fixtures (PRD §4.x). Knockout produces a
 * seeded single-elimination bracket where the winner advances; round-robin /
 * league produces every pairing with standings derived from results.
 */
@Injectable()
export class TournamentFixturesService {
  constructor(private readonly db: DbService) {}

  /** Generate fixtures from the paid participants. Idempotent guard: throws if already generated. */
  async generate(ownerId: string, tournamentId: string): Promise<Board> {
    const tournament = await this.loadTournament(ownerId, tournamentId);

    // Build + insert inside one tx; read the board AFTER it commits (getBoard
    // opens its own tx and would not see uncommitted rows if nested here).
    await this.db.withTenantId(ownerId, async (tx) => {
      const existing = await tx.query.tournamentMatches.findFirst({
        where: eq(tournamentMatches.tournamentId, tournamentId),
      });
      if (existing) {
        throw new BadRequestException(
          'Fixtures already generated. Clear them first to regenerate.',
        );
      }

      const participants = await tx.query.tournamentParticipants.findMany({
        where: and(
          eq(tournamentParticipants.tournamentId, tournamentId),
          eq(tournamentParticipants.paid, true),
        ),
        orderBy: asc(tournamentParticipants.createdAt),
      });
      if (participants.length < 2) {
        throw new BadRequestException(
          'Need at least 2 paid participants to generate fixtures.',
        );
      }

      const ids = participants.map((p) => p.id);
      const rows =
        tournament.format === 'knockout'
          ? this.buildKnockout(ownerId, tournamentId, ids)
          : this.buildRoundRobin(ownerId, tournamentId, ids);

      await tx.insert(tournamentMatches).values(rows);
    });

    return this.getBoard(ownerId, tournamentId);
  }

  /** Delete all fixtures so they can be regenerated (results are lost). */
  async clear(ownerId: string, tournamentId: string): Promise<Board> {
    await this.loadTournament(ownerId, tournamentId);
    await this.db.withTenantId(ownerId, (tx) =>
      tx
        .delete(tournamentMatches)
        .where(eq(tournamentMatches.tournamentId, tournamentId)),
    );
    return this.getBoard(ownerId, tournamentId);
  }

  /** The full board: matches (with labels) + standings (league/round-robin). */
  async getBoard(ownerId: string, tournamentId: string): Promise<Board> {
    const tournament = await this.loadTournament(ownerId, tournamentId);

    return this.db.withTenantId(ownerId, async (tx) => {
      const [matches, participants] = await Promise.all([
        tx.query.tournamentMatches.findMany({
          where: eq(tournamentMatches.tournamentId, tournamentId),
          orderBy: [
            asc(tournamentMatches.round),
            asc(tournamentMatches.position),
          ],
        }),
        tx.query.tournamentParticipants.findMany({
          where: eq(tournamentParticipants.tournamentId, tournamentId),
        }),
      ]);

      const label = new Map<string, string>();
      for (const p of participants) {
        label.set(p.id, p.teamName?.trim() || p.captainName);
      }

      const views: MatchView[] = matches.map((m) => ({
        id: m.id,
        round: m.round,
        position: m.position,
        participantAId: m.participantAId,
        participantBId: m.participantBId,
        aLabel: m.participantAId ? (label.get(m.participantAId) ?? null) : null,
        bLabel: m.participantBId ? (label.get(m.participantBId) ?? null) : null,
        scoreA: m.scoreA,
        scoreB: m.scoreB,
        winnerId: m.winnerId,
        status: m.status as 'pending' | 'completed',
      }));

      const rounds = views.reduce((max, m) => Math.max(max, m.round), 0);
      const standings =
        tournament.format === 'knockout'
          ? []
          : this.standings(views, label);

      return {
        format: tournament.format,
        generated: views.length > 0,
        rounds,
        matches: views,
        standings,
      };
    });
  }

  /** Record a match result; advances the winner in a knockout bracket. */
  async recordResult(
    ownerId: string,
    tournamentId: string,
    matchId: string,
    dto: RecordResultDto,
  ): Promise<Board> {
    const tournament = await this.loadTournament(ownerId, tournamentId);

    await this.db.withTenantId(ownerId, async (tx) => {
      const match = await tx.query.tournamentMatches.findFirst({
        where: and(
          eq(tournamentMatches.id, matchId),
          eq(tournamentMatches.tournamentId, tournamentId),
        ),
      });
      if (!match) throw new NotFoundException('Match not found');
      if (!match.participantAId || !match.participantBId) {
        throw new BadRequestException(
          'Both participants must be decided before recording a result.',
        );
      }

      let winnerId: string | null = null;
      if (dto.scoreA > dto.scoreB) winnerId = match.participantAId;
      else if (dto.scoreB > dto.scoreA) winnerId = match.participantBId;
      else if (tournament.format === 'knockout') {
        throw new BadRequestException('A knockout match cannot end in a tie.');
      }

      await tx
        .update(tournamentMatches)
        .set({
          scoreA: dto.scoreA,
          scoreB: dto.scoreB,
          winnerId,
          status: 'completed',
        })
        .where(eq(tournamentMatches.id, matchId));

      // Knockout: push the winner into the next round's slot.
      if (match.nextMatchId && winnerId) {
        await tx
          .update(tournamentMatches)
          .set(
            match.nextSlot === 'A'
              ? { participantAId: winnerId }
              : { participantBId: winnerId },
          )
          .where(eq(tournamentMatches.id, match.nextMatchId));
      }
    });

    return this.getBoard(ownerId, tournamentId);
  }

  // --- helpers -------------------------------------------------------------

  private async loadTournament(ownerId: string, tournamentId: string) {
    const t = await this.db.withTenantBypass((tx) =>
      tx.query.tournaments.findFirst({
        where: eq(tournaments.id, tournamentId),
      }),
    );
    if (!t || t.ownerId !== ownerId) {
      throw new NotFoundException('Tournament not found');
    }
    return t;
  }

  /**
   * Standard single-elimination seed order for a bracket of `size` (power of 2),
   * 1-based: index i holds seed seedOrder[i]. Pairs 1-vs-last, 2-vs-2nd-last, … so
   * byes (the highest, non-existent seeds) always face a real participant.
   */
  private seedOrder(size: number): number[] {
    let order = [1, 2];
    while (order.length < size) {
      const sum = order.length * 2 + 1;
      const next: number[] = [];
      for (const s of order) {
        next.push(s);
        next.push(sum - s);
      }
      order = next;
    }
    return order;
  }

  private buildKnockout(
    ownerId: string,
    tournamentId: string,
    participantIds: string[],
  ): NewMatch[] {
    const n = participantIds.length;
    let size = 1;
    while (size < n) size *= 2;
    const totalRounds = Math.log2(size);

    // Pre-create every match (so nextMatchId links exist), keyed by round/position.
    const byRound: Record<number, NewMatch[]> = {};
    const all: NewMatch[] = [];
    for (let r = 1; r <= totalRounds; r++) {
      const count = size / 2 ** r;
      byRound[r] = [];
      for (let p = 0; p < count; p++) {
        const m: NewMatch = {
          id: randomUUID(),
          ownerId,
          tournamentId,
          round: r,
          position: p,
          status: 'pending',
        };
        byRound[r].push(m);
        all.push(m);
      }
    }
    // Link advancement: match (r, p) → parent (r+1, floor(p/2)), slot by parity.
    for (let r = 1; r < totalRounds; r++) {
      byRound[r].forEach((m, p) => {
        const parent = byRound[r + 1][Math.floor(p / 2)];
        m.nextMatchId = parent.id;
        m.nextSlot = p % 2 === 0 ? 'A' : 'B';
      });
    }
    // Seed round 1 by standard order; seeds beyond n are byes (null).
    const order = this.seedOrder(size);
    const seatParticipant = (seed: number): string | null =>
      seed <= n ? participantIds[seed - 1] : null;
    byRound[1].forEach((m, p) => {
      m.participantAId = seatParticipant(order[2 * p]);
      m.participantBId = seatParticipant(order[2 * p + 1]);
    });
    // Resolve byes at ROUND 1 ONLY: a participant seeded against an empty slot
    // auto-advances into round 2. Deeper empty slots are NOT byes — they await a
    // real feeder match's winner, so they must stay pending. (Standard seeding +
    // size/2 < n guarantees no bye-vs-bye match, so no deeper phantom slot.)
    const byId = new Map(all.map((m) => [m.id, m]));
    for (const m of byRound[1]) {
      const a = m.participantAId ?? null;
      const b = m.participantBId ?? null;
      const lone = a && !b ? a : b && !a ? b : null;
      if (lone) {
        m.winnerId = lone;
        m.status = 'completed';
        if (m.nextMatchId) {
          const parent = byId.get(m.nextMatchId)!;
          if (m.nextSlot === 'A') parent.participantAId = lone;
          else parent.participantBId = lone;
        }
      }
    }
    return all;
  }

  private buildRoundRobin(
    ownerId: string,
    tournamentId: string,
    participantIds: string[],
  ): NewMatch[] {
    const rows: NewMatch[] = [];
    let position = 0;
    for (let i = 0; i < participantIds.length; i++) {
      for (let j = i + 1; j < participantIds.length; j++) {
        rows.push({
          id: randomUUID(),
          ownerId,
          tournamentId,
          round: 1,
          position: position++,
          participantAId: participantIds[i],
          participantBId: participantIds[j],
          status: 'pending',
        });
      }
    }
    return rows;
  }

  private standings(
    matches: MatchView[],
    label: Map<string, string>,
  ): StandingRow[] {
    const table = new Map<string, StandingRow>();
    const row = (id: string): StandingRow => {
      let r = table.get(id);
      if (!r) {
        r = {
          participantId: id,
          label: label.get(id) ?? '—',
          played: 0,
          won: 0,
          drawn: 0,
          lost: 0,
          points: 0,
        };
        table.set(id, r);
      }
      return r;
    };
    // Seed every known participant so the table lists everyone, even 0-played.
    for (const id of label.keys()) row(id);

    for (const m of matches) {
      if (m.status !== 'completed' || !m.participantAId || !m.participantBId) {
        continue;
      }
      const a = row(m.participantAId);
      const b = row(m.participantBId);
      a.played++;
      b.played++;
      if (!m.winnerId) {
        a.drawn++;
        b.drawn++;
        a.points += DRAW_POINTS;
        b.points += DRAW_POINTS;
      } else if (m.winnerId === m.participantAId) {
        a.won++;
        b.lost++;
        a.points += WIN_POINTS;
      } else {
        b.won++;
        a.lost++;
        b.points += WIN_POINTS;
      }
    }
    return [...table.values()].sort(
      (x, y) => y.points - x.points || y.won - x.won || x.label.localeCompare(y.label),
    );
  }
}
