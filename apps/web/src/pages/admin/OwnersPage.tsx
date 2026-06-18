import { FeatureFlag } from '@sportsbooking/shared';
import { useState } from 'react';
import { api } from '../../api/client';
import { Card, Field, Msg, PageHeader, useLoad } from '../../components/common';

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
      <PageHeader title="Owners" subtitle="Onboarding & oversight" />
      <Card title="Onboard owner">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Business name" value={name} onChange={setName} />
          <Field label="Contact email" value={email} onChange={setEmail} />
          <Field label="Admin password" value={password} onChange={setPassword} />
          <Field label="Venue quota" value={quota} onChange={setQuota} />
        </div>
        <p className="text-xs text-muted-foreground my-3">
          All catalogue games &amp; feature flags are granted in this quick form.
        </p>
        <button
          onClick={create}
          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground font-semibold hover:bg-primary/90 transition-colors"
        >
          Onboard owner
        </button>
        <Msg text={msg} />
      </Card>

      <Card title="Owners">
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Venues</th>
                <th>Quota</th>
              </tr>
            </thead>
            <tbody>
              {(owners.data ?? []).map((o) => (
                <tr key={o.id}>
                  <td className="font-medium">{o.name}</td>
                  <td>
                    <span className="text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 rounded-md bg-secondary text-secondary-foreground">
                      {o.status}
                    </span>
                  </td>
                  <td className="font-mono">{o.venueCount}</td>
                  <td className="font-mono">{o.venueQuota}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
