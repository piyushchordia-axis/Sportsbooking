import { useState } from 'react';
import { api } from '../api/client';

/** Owner/staff email-password login (PRD §2.1). */
export function LoginPage() {
  const [email, setEmail] = useState('owner@smasharena.local');
  const [password, setPassword] = useState('owner12345');
  const [message, setMessage] = useState<string | null>(null);

  const submit = async () => {
    setMessage(null);
    try {
      const res = await api.staffLogin(email, password);
      localStorage.setItem('accessToken', res.accessToken);
      localStorage.setItem('refreshToken', res.refreshToken);
      setMessage(`Signed in as ${res.user.name} (${res.user.role})`);
    } catch (e) {
      setMessage((e as Error).message);
    }
  };

  return (
    <div className="container">
      <div className="card" style={{ maxWidth: 420 }}>
        <h2>Owner / Staff login</h2>
        <label>Email</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} />
        <label>Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button onClick={submit}>Sign in</button>
        {message && <p>{message}</p>}
      </div>
    </div>
  );
}
