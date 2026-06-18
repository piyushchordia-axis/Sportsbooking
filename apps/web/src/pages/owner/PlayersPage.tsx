import { useState } from 'react';
import { api } from '../../api/client';
import { Card, EmptyState, Field, Msg, PageHeader, Select, useLoad } from '../../components/common';

/** Owner CRM directory with segment filter + direct add-customer (PRD §4.9). */
export function PlayersPage() {
  const [segment, setSegment] = useState('');
  const players = useLoad(() => api.listPlayers(segment || undefined), [segment]);

  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [consent, setConsent] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const add = async () => {
    setMsg(null);
    if (!name.trim() || !mobile.trim()) {
      setMsg('Name and mobile are required');
      return;
    }
    setSaving(true);
    try {
      const created = await api.addCustomer({ name: name.trim(), mobile: mobile.trim(), consent });
      setName('');
      setMobile('');
      setConsent(false);
      players.reload();
      setMsg(`Added ${created.name} (${created.mobile}) to your CRM`);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="container">
      <PageHeader title="Players" subtitle="CRM directory & segments" />

      <Card title="Add a customer">
        <p className="text-sm text-muted-foreground -mt-2 mb-4">
          Add a walk-in or phone customer to your CRM. They’ll appear below even before their first booking.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
          <Field label="Name" value={name} onChange={setName} placeholder="e.g. Priya Sharma" />
          <Field label="Mobile" value={mobile} onChange={setMobile} placeholder="e.g. 9876543210" />
        </div>
        <label className="flex items-center gap-2 mb-3 text-sm text-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="h-4 w-4 rounded border-border accent-primary"
          />
          Customer consents to marketing messages
        </label>
        <button
          onClick={add}
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground font-semibold disabled:opacity-40 hover:bg-primary/90 transition-colors"
        >
          {saving ? 'Adding…' : 'Add customer'}
        </button>
        <Msg text={msg} />
      </Card>

      <Card>
        <Select
          label="Segment"
          value={segment}
          onChange={setSegment}
          options={[
            { value: '', label: 'All' },
            { value: 'regulars', label: 'Regulars (5+ bookings)' },
            { value: 'lapsed', label: 'Lapsed (60+ days)' },
          ]}
        />
        <Msg text={players.error} />
        {!players.error && (players.data ?? []).length === 0 ? (
          <EmptyState
            title="No players in this segment"
            hint="Add a customer above, or as customers book and opt in, they’ll show up in your CRM here."
          />
        ) : (
          <div className="overflow-x-auto mt-4">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Mobile</th>
                  <th>Bookings</th>
                  <th>Last visit</th>
                  <th>Consent</th>
                </tr>
              </thead>
              <tbody>
                {(players.data ?? []).map((p) => (
                  <tr key={p.customerId}>
                    <td className="font-medium">
                      {p.name ?? <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="font-mono whitespace-nowrap">
                      {p.mobile ?? <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="font-mono">{p.bookingCount}</td>
                    <td className="whitespace-nowrap">
                      {new Date(p.lastVisitAt).toLocaleDateString()}
                    </td>
                    <td>
                      {p.consent ? (
                        <span className="text-primary">✓</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                      {p.optedOut ? (
                        <span className="text-muted-foreground"> (opted out)</span>
                      ) : (
                        ''
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
