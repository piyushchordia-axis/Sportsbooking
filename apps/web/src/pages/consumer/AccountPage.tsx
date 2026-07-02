import { SkillLevel } from '@sportsbooking/shared';
import { Pencil } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useLoad } from '../../components/common';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '../../components/ui/sheet';
import { Skeleton } from '../../components/ui/skeleton';
import { useFloodlitToast } from '../../floodlit/toast';
import { label } from '../../lib/labels';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { useStorefront } from '../../storefront/StorefrontProvider';
import { useTheme } from '../../theme/ThemeProvider';

/** Customer profile: a single GLOBAL identity (skill + preferred games) the
 *  player edits once — no "venue operator" to pick. Referral codes are
 *  per-operator, so they only show on an operator's storefront (resolved from
 *  the domain), never on the bare marketplace. */
export function AccountPage() {
  const { user, logout } = useAuth();
  const { flash } = useFloodlitToast();
  const { mode } = useTheme();
  // Operator context comes from the storefront (subdomain / /s/:key / ?owner),
  // never from the player. Null on the marketplace.
  const { scoped, ownerId: sfOwnerId, ownerName } = useStorefront();
  const isDesktop = useMediaQuery('(min-width: 768px)');

  const saved = useLoad(() => api.listSavedVenues());
  // Game catalogue powers the preferred-games multi-select in the edit form.
  const games = useLoad(() => api.discoverGames());
  // The player's single global profile (skill + games), operator-agnostic.
  const profile = useLoad(() =>
    user
      ? api.getMyProfile()
      : Promise.resolve({ skillLevel: SkillLevel.BEGINNER as string, games: [] as string[] }),
  );

  const [skill, setSkill] = useState<SkillLevel>(SkillLevel.BEGINNER);
  const [selectedGames, setSelectedGames] = useState<string[]>([]);
  const [consent, setConsent] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Seed the editable form from the saved profile (initial load + after save).
  useEffect(() => {
    if (profile.data) {
      setSkill(profile.data.skillLevel as SkillLevel);
      setSelectedGames(profile.data.games ?? []);
    }
  }, [profile.data]);

  // Referral codes are per-operator → only fetch/show on an operator storefront.
  useEffect(() => {
    setCode(null);
    setCopied(false);
    if (!scoped || !sfOwnerId) return;
    api.referralCode(sfOwnerId).then((r) => setCode(r.code)).catch(() => setCode(null));
  }, [scoped, sfOwnerId]);

  // Normalise the loosely-typed catalogue rows to { id, name }.
  const gameOptions = useMemo(
    () =>
      ((games.data ?? []) as { id: string; name: string }[]).map((g) => ({
        id: g.id,
        name: g.name,
      })),
    [games.data],
  );

  const toggleGame = (id: string) =>
    setSelectedGames((prev) =>
      prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id],
    );

  const openEdit = () => {
    // Reset the form to the saved values so a cancel discards in-progress edits.
    if (profile.data) {
      setSkill(profile.data.skillLevel as SkillLevel);
      setSelectedGames(profile.data.games ?? []);
    }
    setEditOpen(true);
  };

  const saveProfile = async () => {
    try {
      await api.updateMyProfile({ skillLevel: skill, games: selectedGames });
      flash('Profile updated.');
      setEditOpen(false);
      profile.reload();
    } catch (e) {
      flash((e as Error).message);
    }
  };

  const copyCode = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      flash('Referral code copied');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  const toggleConsent = async () => {
    const next = !consent;
    setConsent(next);
    if (!user) return;
    try {
      await api.setPlayerConsent(user.id, { consent: next });
      flash(next ? 'Marketing contact on' : 'Marketing contact off');
    } catch (e) {
      setConsent(!next); // roll back on failure
      flash((e as Error).message);
    }
  };

  // ---- guest empty state -------------------------------------------------
  if (!user) {
    return (
      <div className="mx-auto w-full max-w-2xl px-1 py-2">
        <h1 className="fl-display text-3xl" style={{ color: 'var(--chalk)' }}>
          Profile
        </h1>
        <div
          className="mt-5 flex flex-col items-center px-6 py-9 text-center"
          style={{
            background: 'var(--surface)',
            border: '1px dashed var(--line-strong)',
            borderRadius: 16,
          }}
        >
          <div style={{ fontSize: 30 }}>👤</div>
          <div className="fl-display mt-3 text-lg" style={{ color: 'var(--chalk)' }}>
            You&apos;re browsing as a guest
          </div>
          <p className="mt-1.5 text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
            Sign in with your mobile to unlock packs, points, referrals and your booking history.
          </p>
        </div>
      </div>
    );
  }

  // ---- initial loading skeleton -----------------------------------------
  if (profile.loading && !profile.data) {
    return (
      <div className="mx-auto w-full max-w-5xl px-1 py-2">
        <Skeleton className="h-9 w-40 rounded-lg" />
        <Skeleton className="mt-4 h-[86px] w-full rounded-2xl" />
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
          <Skeleton className="h-[110px] w-full rounded-[14px]" />
          <Skeleton className="h-[150px] w-full rounded-[14px]" />
        </div>
      </div>
    );
  }

  const userName = user.name || 'Player';
  const userInitial = userName.trim().charAt(0).toUpperCase() || 'P';
  const userMobile = user.mobile ?? user.email ?? '';
  const savedCount = saved.data?.length ?? 0;
  const savedSkill = (profile.data?.skillLevel as SkillLevel) ?? skill;

  // Shared edit-profile form — rendered inside a Dialog (desktop) or Sheet (mobile).
  const editForm = (
    <div className="flex flex-col gap-4">
      <label className="block">
        <span className="mb-1.5 block text-xs" style={{ color: 'var(--muted)' }}>
          Skill level (powers open-match matching)
        </span>
        <Picker
          value={skill}
          onChange={(v) => setSkill(v as SkillLevel)}
          options={Object.values(SkillLevel).map((s) => ({ value: s, label: label(s) }))}
        />
      </label>
      <div className="block">
        <span className="mb-1.5 block text-xs" style={{ color: 'var(--muted)' }}>
          Preferred games
        </span>
        <div className="flex flex-wrap gap-2">
          {gameOptions.length === 0 ? (
            <span className="text-xs" style={{ color: 'var(--faint)' }}>
              No games available.
            </span>
          ) : (
            gameOptions.map((g) => {
              const on = selectedGames.includes(g.id);
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => toggleGame(g.id)}
                  aria-pressed={on}
                  className="text-xs font-semibold"
                  style={{
                    background: on ? 'var(--brand)' : 'var(--bg-2)',
                    color: on ? 'var(--on-brand)' : 'var(--chalk)',
                    border: `1px solid ${on ? 'var(--brand)' : 'var(--line-strong)'}`,
                    borderRadius: 999,
                    padding: '7px 13px',
                    cursor: 'pointer',
                  }}
                >
                  {g.name}
                </button>
              );
            })
          )}
        </div>
      </div>
      <button
        onClick={saveProfile}
        className="fl-display mt-1 w-full"
        style={{
          background: 'var(--brand)',
          color: 'var(--on-brand)',
          border: 'none',
          borderRadius: 11,
          padding: '12px',
          fontSize: 15,
          cursor: 'pointer',
        }}
      >
        Save changes
      </button>
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-5xl px-1 py-2">
      <h1 className="fl-display text-3xl" style={{ color: 'var(--chalk)' }}>
        Profile
      </h1>

      {/* profile card */}
      <div
        className="mt-4 flex items-center gap-4 p-4"
        style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16 }}
      >
        <span
          className="fl-display grid flex-none place-items-center"
          style={{
            width: 54,
            height: 54,
            borderRadius: '50%',
            background: 'var(--brand)',
            color: 'var(--on-brand)',
            fontSize: 24,
          }}
        >
          {userInitial}
        </span>
        <div className="min-w-0">
          <div className="fl-display text-lg" style={{ color: 'var(--chalk)' }}>
            {userName}
          </div>
          {userMobile && (
            <div className="fl-mono truncate text-sm" style={{ color: 'var(--faint)' }}>
              {userMobile}
            </div>
          )}
        </div>
        {/* compact edit affordance — opens the responsive edit modal */}
        <button
          type="button"
          onClick={openEdit}
          aria-label="Edit profile"
          title="Edit profile"
          className="ml-auto grid h-9 w-9 flex-none place-items-center rounded-full"
          style={{ background: 'var(--bg-2)', border: '1px solid var(--line-strong)', color: 'var(--brand)' }}
        >
          <Pencil className="h-4 w-4" />
        </button>
      </div>

      {/* desktop two-column reflow: details | refer & earn (storefront only) */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
        {/* details card */}
        <div
          className="px-4"
          style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14 }}
        >
          <Row label="Skill level" value={label(savedSkill)} valueColor="var(--brand)" />
          <Row label="Saved venues" value={`${savedCount} grounds`} last />
        </div>

        {/* refer & earn — per-operator program, so only on an operator storefront */}
        {scoped && (
          <div
            className="p-4"
            style={{
              background:
                'linear-gradient(150deg, color-mix(in oklab,var(--brand) 13%, var(--surface)), var(--surface))',
              border: '1px solid var(--line)',
              borderRadius: 14,
            }}
          >
            <div className="fl-display text-base" style={{ color: 'var(--chalk)' }}>
              Refer &amp; earn ₹150
            </div>
            <p className="mt-1.5 text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
              {ownerName ? `Your code at ${ownerName}. ` : ''}Credit drops after your friend&apos;s first paid booking.
            </p>
            <button
              onClick={copyCode}
              disabled={!code}
              aria-label="Copy referral code"
              className="mt-3 flex w-full items-center justify-between"
              style={{
                background: 'var(--bg-2)',
                border: '1px dashed var(--brand)',
                borderRadius: 10,
                padding: '12px 14px',
                cursor: code ? 'pointer' : 'default',
              }}
            >
              <span className="fl-mono text-base font-semibold" style={{ letterSpacing: '0.08em', color: 'var(--chalk)' }}>
                {code ?? '—'}
              </span>
              <span className="text-xs font-semibold" style={{ color: 'var(--brand)' }}>
                {copied ? 'Copied' : 'Copy'}
              </span>
            </button>
          </div>
        )}
      </div>

      {/* consent toggle — DPDP */}
      <button
        onClick={toggleConsent}
        className="mt-4 flex w-full items-center gap-3 text-left"
        style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 13, padding: 14, cursor: 'pointer' }}
      >
        <div className="flex-1">
          <div className="text-sm font-semibold" style={{ color: 'var(--chalk)' }}>
            Marketing contact
          </div>
          <div className="text-xs" style={{ color: 'var(--faint)' }}>
            DPDP consent · offers &amp; updates
          </div>
        </div>
        <span
          className="relative flex-none"
          style={{
            width: 44,
            height: 26,
            borderRadius: 999,
            background: consent ? 'var(--brand)' : 'var(--line-strong)',
          }}
        >
          <span
            style={{
              position: 'absolute',
              top: 3,
              left: consent ? 21 : 3,
              width: 20,
              height: 20,
              borderRadius: '50%',
              background: '#fff',
              transition: 'left .2s',
            }}
          />
        </span>
      </button>

      {/* sign out */}
      <button
        onClick={logout}
        className="mt-4 w-full font-semibold"
        style={{
          background: 'transparent',
          color: 'var(--danger)',
          border: '1px solid color-mix(in oklab,var(--danger) 50%, transparent)',
          borderRadius: 12,
          padding: 14,
          fontSize: 14,
          cursor: 'pointer',
        }}
      >
        Sign out
      </button>

      {/* edit-profile modal: Dialog on desktop, bottom Sheet on mobile. Both are
          portaled to <body>, so re-apply the `.floodlit` theme scope + mode here
          (the design tokens only resolve inside it). */}
      {isDesktop ? (
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent
            className="floodlit max-w-md"
            data-fl-mode={mode}
            style={{ background: 'var(--surface)', color: 'var(--chalk)', borderColor: 'var(--line)' }}
          >
            <DialogHeader>
              <DialogTitle className="fl-display text-xl" style={{ color: 'var(--chalk)' }}>
                Edit profile
              </DialogTitle>
            </DialogHeader>
            {editForm}
          </DialogContent>
        </Dialog>
      ) : (
        <Sheet open={editOpen} onOpenChange={setEditOpen}>
          <SheetContent
            side="bottom"
            className="floodlit"
            data-fl-mode={mode}
            style={{ background: 'var(--surface)', color: 'var(--chalk)', borderColor: 'var(--line)' }}
          >
            <SheetHeader style={{ borderColor: 'var(--line)' }}>
              <SheetTitle className="fl-display text-xl" style={{ color: 'var(--chalk)' }}>
                Edit profile
              </SheetTitle>
            </SheetHeader>
            <SheetBody>{editForm}</SheetBody>
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}

/** A label/value row inside the details card. */
function Row({
  label,
  value,
  valueColor,
  last,
}: {
  label: string;
  value: string;
  valueColor?: string;
  last?: boolean;
}) {
  return (
    <div
      className="flex items-center justify-between"
      style={{ padding: '14px 0', borderBottom: last ? 'none' : '1px solid var(--line)' }}
    >
      <span className="text-sm" style={{ color: 'var(--muted)' }}>
        {label}
      </span>
      <span className="text-sm font-semibold" style={{ color: valueColor ?? 'var(--chalk)' }}>
        {value}
      </span>
    </div>
  );
}

/** Native select skinned to the Floodlit surface tokens. */
function Picker({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full text-sm"
      style={{
        background: 'var(--bg-2)',
        border: '1px solid var(--line-strong)',
        borderRadius: 11,
        padding: '11px 12px',
        color: 'var(--chalk)',
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} style={{ color: '#000' }}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
