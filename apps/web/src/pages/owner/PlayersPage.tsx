import { useState } from 'react';
import { api } from '../../api/client';
import { Card, Msg, PageHeader, Select, useLoad } from '../../components/common';

/** Owner CRM directory with segment filter (PRD §4.9). */
export function PlayersPage() {
  const [segment, setSegment] = useState('');
  const players = useLoad(() => api.listPlayers(segment || undefined), [segment]);

  return (
    <div className="container">
      <PageHeader title="Players" subtitle="CRM directory & segments" />
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
        <div className="overflow-x-auto mt-4">
          <table>
            <thead>
              <tr>
                <th>Customer</th>
                <th>Bookings</th>
                <th>Last visit</th>
                <th>Consent</th>
              </tr>
            </thead>
            <tbody>
              {(players.data ?? []).map((p) => (
                <tr key={p.customerId}>
                  <td className="font-mono text-xs text-muted-foreground">{p.customerId}</td>
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
      </Card>
    </div>
  );
}
