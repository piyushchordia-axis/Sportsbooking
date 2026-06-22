import { SkillLevel } from '@sportsbooking/shared';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useLoad } from '../../components/common';
import { useFloodlitToast } from '../../floodlit/toast';
import { label } from '../../lib/labels';

/** Customer account: profile, per-owner referral code + skill level, saved
 *  venues, offers inbox and DPDP marketing consent (PRD §4.5, §5.1, §5.4). */
export function AccountPage() {
  const { user, logout } = useAuth();
  const { flash } = useFloodlitToast();

  const venues = useLoad(() => api.discoverVenues());
  const saved = useLoad(() => api.listSavedVenues());
  // Game catalogue powers the preferred-games multi-select in the edit form.
  const games = useLoad(() => api.discoverGames());
  const [ownerId, setOwnerId] = useState('');
  const [skill, setSkill] = useState<SkillLevel>(SkillLevel.BEGINNER);
  // Preferred games the player is editing — seeded from their current profile.
  const [selectedGames, setSelectedGames] = useState<string[]>(() => {
    const current = (user as { games?: { id: string }[] } | null)?.games;
    return Array.isArray(current) ? current.map((g) => g.id) : [];
  });
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [offers, setOffers] = useState<{ title: string; sub: string; code: string | null }[]>([]);
  const [consent, setConsent] = useState(true);

  // Collapse the venue list into the distinct operators that issue referral codes.
  const owners = useMemo(() => {
    const uniq = Array.from(
      new Map((venues.data ?? []).map((v) => [v.ownerId, v.name.split(' — ')[0]])),
    );
    return uniq.map(([id, name]) => ({ id, name }));
  }, [venues.data]);

  // Default to the first operator once they load; keep the choice valid if the
  // list changes and never override an active selection that's still present.
  useEffect(() => {
    if (owners.length === 0) {
      if (ownerId) setOwnerId('');
      return;
    }
    if (!owners.some((o) => o.id === ownerId)) setOwnerId(owners[0].id);
  }, [owners, ownerId]);

  useEffect(() => {
    setCode(null);
    setCopied(false);
    setOffers([]);
    if (!ownerId) return;
    api.referralCode(ownerId).then((r) => setCode(r.code)).catch(() => setCode(null));
    api
      .offersInbox(ownerId)
      .then((list) =>
        setOffers(
          list.map((o) => ({
            title: o.name,
            sub: o.type === 'percent' ? `${o.value}% off` : `₹${o.value} off`,
            code: o.code,
          })),
        ),
      )
      .catch(() => setOffers([]));
  }, [ownerId]);

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

  const saveSkill = async () => {
    try {
      await api.updateProfile(ownerId, { skillLevel: skill, games: selectedGames });
      flash('Skill level updated.');
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
          Account
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

  const userName = user.name || 'Player';
  const userInitial = userName.trim().charAt(0).toUpperCase() || 'P';
  const userMobile = user.mobile ?? user.email ?? '';
  const savedCount = saved.data?.length ?? 0;
  const ownerName = owners.find((o) => o.id === ownerId)?.name;

  return (
    <div className="mx-auto w-full max-w-5xl px-1 py-2">
      <h1 className="fl-display text-3xl" style={{ color: 'var(--chalk)' }}>
        Account
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
      </div>

      {/* desktop two-column reflow */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2 lg:items-start">
        <div className="flex flex-col gap-4">
          {/* details card */}
          <div
            className="px-4"
            style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14 }}
          >
            <Row label="Venue operator" value={ownerName ?? '—'} />
            <Row label="Skill level" value={label(skill)} valueColor="var(--brand)" />
            <Row label="Saved venues" value={`${savedCount} grounds`} last />
          </div>

          {/* skill editor — preserves updateProfile wiring */}
          <div
            className="p-4"
            style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14 }}
          >
            <SectionLabel>Edit profile</SectionLabel>
            <label className="mt-3 block">
              <span className="mb-1.5 block text-xs" style={{ color: 'var(--muted)' }}>
                Venue operator
              </span>
              <Picker value={ownerId} onChange={setOwnerId} options={owners.map((o) => ({ value: o.id, label: o.name }))} />
            </label>
            <label className="mt-3 block">
              <span className="mb-1.5 block text-xs" style={{ color: 'var(--muted)' }}>
                Skill level (powers open-match matching)
              </span>
              <Picker
                value={skill}
                onChange={(v) => setSkill(v as SkillLevel)}
                options={Object.values(SkillLevel).map((s) => ({ value: s, label: s }))}
              />
            </label>
            <div className="mt-3 block">
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
              onClick={saveSkill}
              className="fl-display mt-4 w-full"
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
              Save skill
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          {/* refer & earn — copyable code, preserves copyCode wiring */}
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
              Credit drops after your friend&apos;s first paid booking.
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

          {/* offers inbox */}
          <div>
            <div className="fl-mono mb-2.5 mt-1 text-xs uppercase" style={{ letterSpacing: '0.1em', color: 'var(--faint)' }}>
              Offers for you
            </div>
            <div className="flex flex-col gap-2.5">
              {offers.length === 0 ? (
                <div
                  className="px-4 py-3.5 text-sm"
                  style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, color: 'var(--faint)' }}
                >
                  No offers right now.
                </div>
              ) : (
                offers.map((o, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 px-3.5 py-3"
                    style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12 }}
                  >
                    <span style={{ fontSize: 20 }}>🎟️</span>
                    <div className="flex-1 min-w-0">
                      <div className="truncate text-sm font-semibold" style={{ color: 'var(--chalk)' }}>
                        {o.title}
                      </div>
                      <div className="text-xs" style={{ color: 'var(--faint)' }}>
                        {o.sub}
                      </div>
                    </div>
                    {o.code && (
                      <span className="fl-mono text-xs font-semibold" style={{ color: 'var(--brand)' }}>
                        {o.code}
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
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

/** Small uppercase section label in the Floodlit mono style. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="fl-mono text-xs uppercase" style={{ letterSpacing: '0.1em', color: 'var(--faint)' }}>
      {children}
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
