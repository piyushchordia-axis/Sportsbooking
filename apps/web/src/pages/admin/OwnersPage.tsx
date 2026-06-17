import { FeatureFlag } from '@sportsbooking/shared';
import { useState } from 'react';
import { api } from '../../api/client';
import { Card, Field, Msg, useLoad } from '../../components/common';

/** Super Admin: owner onboarding & oversight (PRD §3.2, §3.3). */
export function OwnersPage() {
  const games = useLoad(() => api.listGames());
  const owners = useLoad(() => api.listOwners());
  const [name, setName] = useState('New Turf Co');
  const [email, setEmail] = useState('owner2@example.com');
  const [password, setPassword] = useState('owner12345');
  const [quota, setQuota] = useState('3');
  const [msg, setMsg] = useState<string | null>(null);

  const create = async () => {
    setMsg(null);
    try {
      await api.createOwner({
        name,
        contactEmail: email,
        adminPassword: password,
        venueQuota: Number(quota),
        allowedGameIds: (games.data ?? []).map((g: any) => g.id),
        featureFlags: Object.values(FeatureFlag),
      });
      setMsg(`Owner onboarded — login ${email} / ${password}`);
      owners.reload();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  return (
    <div className="container">
      <Card title="Onboard owner">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <Field label="Business name" value={name} onChange={setName} />
          <Field label="Contact email" value={email} onChange={setEmail} />
          <Field label="Admin password" value={password} onChange={setPassword} />
          <Field label="Venue quota" value={quota} onChange={setQuota} />
        </div>
        <p style={{ fontSize: 12, color: '#64748b' }}>
          All catalogue games &amp; feature flags are granted in this quick form.
        </p>
        <button onClick={create}>Onboard owner</button>
        <Msg text={msg} />
      </Card>

      <Card title="Owners">
        <table style={{ width: '100%', fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#64748b' }}>
              <th>Name</th><th>Status</th><th>Venues</th><th>Quota</th>
            </tr>
          </thead>
          <tbody>
            {(owners.data ?? []).map((o) => (
              <tr key={o.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                <td>{o.name}</td>
                <td>{o.status}</td>
                <td>{o.venueCount}</td>
                <td>{o.venueQuota}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
