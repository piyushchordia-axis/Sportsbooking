import { SkillLevel } from '@sportsbooking/shared';
import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  Gift,
  RotateCw,
  Ticket,
  TrendingUp,
  UserCircle,
} from 'lucide-react';
import { api } from '../../api/client';
import {
  EmptyState,
  InfoCard,
  KeyVal,
  Msg,
  PageHeader,
  SectionLabel,
  Select,
  Stat,
  StatusPill,
  useLoad,
} from '../../components/common';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/skeleton';

/** Customer account: per-owner referral code + skill level (PRD §4.5, §5.1). */
export function AccountPage() {
  const venues = useLoad(() => api.discoverVenues());
  const [ownerId, setOwnerId] = useState('');
  const [skill, setSkill] = useState<SkillLevel>(SkillLevel.BEGINNER);
  const [code, setCode] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
    if (ownerId) api.referralCode(ownerId).then((r) => setCode(r.code)).catch(() => setCode(null));
  }, [ownerId]);

  const saveSkill = async () => {
    setMsg(null);
    try {
      await api.updateProfile(ownerId, { skillLevel: skill });
      setMsg('Skill level updated.');
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const copyCode = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  const ownerName = owners.find((o) => o.id === ownerId)?.name;

  return (
    <div className="container" style={{ maxWidth: '52rem' }}>
      <PageHeader
        title="Account"
        subtitle="Referrals & skill profile"
        badge={<StatusPill status="active">Player</StatusPill>}
      />

      {venues.loading && !venues.data ? (
        <AccountSkeleton />
      ) : venues.error ? (
        <InfoCard title="Couldn't load your account" icon={AlertTriangle} accent="destructive">
          <p className="text-sm text-muted-foreground">
            We couldn't reach the venues service, so your referral code and profile aren't
            available yet. {venues.error}
          </p>
          <div className="mt-4">
            <Button variant="outline" onClick={venues.reload} disabled={venues.loading}>
              <RotateCw className={venues.loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
              Try again
            </Button>
          </div>
        </InfoCard>
      ) : owners.length === 0 ? (
        <InfoCard title="No venue operators yet" icon={UserCircle} accent="primary">
          <EmptyState
            title="No operators to set up"
            hint="Referral codes and skill profiles are issued per venue operator. Book at a venue first and your operator will show up here."
          />
        </InfoCard>
      ) : (
        <AccountBody />
      )}
    </div>
  );

  function AccountBody() {
    return (
      <>
      <div className="grid grid-cols-2 gap-4 mb-4">
        <Stat label="Referral code" value={code ?? '—'} sub="Per venue operator" accent="primary" icon={Ticket} />
        <Stat label="Skill level" value={skill} sub="Powers open-match matching" accent="purple" icon={TrendingUp} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <InfoCard title="Referral code" icon={Gift} accent="emerald">
          <KeyVal label="Venue operator" value={ownerName} />
          <div className="rounded-xl border border-border bg-input-background p-4 mt-3">
            <SectionLabel>Your referral code</SectionLabel>
            <div className="flex items-center justify-between gap-3 mt-2">
              <p className="font-display font-bold text-2xl tracking-wide">{code ?? '—'}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={copyCode}
                disabled={!code}
                aria-label="Copy referral code"
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              Reward is released after a referred player's first paid booking.
            </p>
          </div>
        </InfoCard>

        <InfoCard title="Profile" icon={UserCircle} accent="primary">
          <Select
            label="Venue operator"
            value={ownerId}
            onChange={setOwnerId}
            options={owners.map((o) => ({ value: o.id, label: o.name }))}
          />
          <Select
            label="Skill level (powers open-match matching)"
            value={skill}
            onChange={(v) => setSkill(v as SkillLevel)}
            options={Object.values(SkillLevel).map((s) => ({ value: s, label: s }))}
          />
          <div className="mt-1">
            <Button onClick={saveSkill}>Save skill</Button>
          </div>
          <Msg text={msg} />
        </InfoCard>
      </div>
      </>
    );
  }
}

/** Placeholder layout mirroring the loaded account body while venues fetch. */
function AccountSkeleton() {
  return (
    <>
      <div className="grid grid-cols-2 gap-4 mb-4">
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-28 rounded-2xl" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-64 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    </>
  );
}
