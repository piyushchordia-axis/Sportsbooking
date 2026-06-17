import { useState } from 'react';
import { api } from '../../api/client';
import { Card, Msg, Select, useLoad } from '../../components/common';

/** Owner CRM directory with segment filter (PRD §4.9). */
export function PlayersPage() {
  const [segment, setSegment] = useState('');
  const players = useLoad(() => api.listPlayers(segment || undefined), [segment]);

  return (
    <div className="container">
      <Card title="Players (CRM)">
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
        <table style={{ width: '100%', fontSize: 14, marginTop: 8 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#64748b' }}>
              <th>Customer</th><th>Bookings</th><th>Last visit</th><th>Consent</th>
            </tr>
          </thead>
          <tbody>
            {(players.data ?? []).map((p) => (
              <tr key={p.customerId} style={{ borderTop: '1px solid #f1f5f9' }}>
                <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{p.customerId}</td>
                <td>{p.bookingCount}</td>
                <td>{new Date(p.lastVisitAt).toLocaleDateString()}</td>
                <td>{p.consent ? '✓' : '—'}{p.optedOut ? ' (opted out)' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
