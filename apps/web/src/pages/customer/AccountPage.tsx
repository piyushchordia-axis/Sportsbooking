import { SkillLevel } from '@sportsbooking/shared';
import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { Card, Msg, PageHeader, Select } from '../../components/common';

/** Customer account: per-owner referral code + skill level (PRD §4.5, §5.1). */
export function AccountPage() {
  const [owners, setOwners] = useState<{ id: string; name: string }[]>([]);
  const [ownerId, setOwnerId] = useState('');
  const [skill, setSkill] = useState<SkillLevel>(SkillLevel.BEGINNER);
  const [code, setCode] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    api.discoverVenues().then((vs) => {
      const uniq = Array.from(new Map(vs.map((v) => [v.ownerId, v.name.split(' — ')[0]])));
      setOwners(uniq.map(([id, name]) => ({ id, name })));
      if (uniq[0]) setOwnerId(uniq[0][0]);
    });
  }, []);

  useEffect(() => {
    setCode(null);
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

  return (
    <div className="container" style={{ maxWidth: '40rem' }}>
      <PageHeader title="Account" subtitle="Referrals & skill profile" />
      <Card title="Profile">
        <Select
          label="Venue operator"
          value={ownerId}
          onChange={setOwnerId}
          options={owners.map((o) => ({ value: o.id, label: o.name }))}
        />

        <div className="rounded-lg border border-border bg-input-background p-4 my-4">
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            Your referral code
          </p>
          <p className="font-display font-bold text-2xl mt-1">{code ?? '—'}</p>
          <p className="text-xs text-muted-foreground mt-1">
            Reward is released after a referred player's first paid booking.
          </p>
        </div>

        <Select
          label="Skill level (powers open-match matching)"
          value={skill}
          onChange={(v) => setSkill(v as SkillLevel)}
          options={Object.values(SkillLevel).map((s) => ({ value: s, label: s }))}
        />
        <button
          onClick={saveSkill}
          className="mt-1 px-4 py-2 rounded-lg bg-primary text-primary-foreground font-semibold hover:bg-primary/90 transition-colors"
        >
          Save skill
        </button>
        <Msg text={msg} />
      </Card>
    </div>
  );
}
