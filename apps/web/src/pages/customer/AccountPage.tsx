import { SkillLevel } from '@sportsbooking/shared';
import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { Card, Msg, Select } from '../../components/common';

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
    <div className="container" style={{ maxWidth: 560 }}>
      <Card title="Account">
        <Select
          label="Venue operator"
          value={ownerId}
          onChange={setOwnerId}
          options={owners.map((o) => ({ value: o.id, label: o.name }))}
        />

        <p>
          Your referral code: <strong>{code ?? '—'}</strong>
          <br />
          <span style={{ fontSize: 12, color: '#64748b' }}>
            Reward is released after a referred player's first paid booking.
          </span>
        </p>

        <Select
          label="Skill level (powers open-match matching)"
          value={skill}
          onChange={(v) => setSkill(v as SkillLevel)}
          options={Object.values(SkillLevel).map((s) => ({ value: s, label: s }))}
        />
        <button onClick={saveSkill}>Save skill</button>
        <Msg text={msg} />
      </Card>
    </div>
  );
}
