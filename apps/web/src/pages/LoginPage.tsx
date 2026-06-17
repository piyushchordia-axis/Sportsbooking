import { UserRole } from '@sportsbooking/shared';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Card, Field, Msg } from '../components/common';

const HOME: Record<UserRole, string> = {
  [UserRole.CUSTOMER]: '/book',
  [UserRole.OWNER]: '/owner',
  [UserRole.STAFF]: '/owner/venues',
  [UserRole.SUPER_ADMIN]: '/admin',
};

export function LoginPage() {
  const { setSession } = useAuth();
  const nav = useNavigate();
  const [tab, setTab] = useState<'customer' | 'staff'>('customer');
  const [msg, setMsg] = useState<string | null>(null);

  // customer OTP
  const [mobile, setMobile] = useState('+919800000001');
  const [name, setName] = useState('Player');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);

  // staff
  const [email, setEmail] = useState('owner@smasharena.local');
  const [password, setPassword] = useState('owner12345');

  const finish = (res: Parameters<typeof setSession>[0]) => {
    setSession(res);
    nav(HOME[res.user.role]);
  };

  const sendOtp = async () => {
    setMsg(null);
    try {
      await api.requestOtp(mobile);
      setSent(true);
      setMsg('OTP sent. In dev the code is 123456.');
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const verify = async () => {
    setMsg(null);
    try {
      finish(await api.verifyOtp(mobile, code, name));
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const staffLogin = async () => {
    setMsg(null);
    try {
      finish(await api.staffLogin(email, password));
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  return (
    <div className="container" style={{ maxWidth: 460 }}>
      <Card>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button
            onClick={() => setTab('customer')}
            style={{ opacity: tab === 'customer' ? 1 : 0.5 }}
          >
            Player (OTP)
          </button>
          <button
            onClick={() => setTab('staff')}
            style={{ opacity: tab === 'staff' ? 1 : 0.5 }}
          >
            Owner / Staff / Admin
          </button>
        </div>

        {tab === 'customer' ? (
          <>
            <Field label="Mobile" value={mobile} onChange={setMobile} />
            <Field label="Name" value={name} onChange={setName} />
            {!sent ? (
              <button onClick={sendOtp}>Send OTP</button>
            ) : (
              <>
                <Field label="OTP code" value={code} onChange={setCode} placeholder="123456" />
                <button className="accent" onClick={verify}>
                  Verify & continue
                </button>
              </>
            )}
          </>
        ) : (
          <>
            <Field label="Email" value={email} onChange={setEmail} />
            <Field label="Password" type="password" value={password} onChange={setPassword} />
            <button onClick={staffLogin}>Sign in</button>
            <p style={{ fontSize: 12, color: '#64748b' }}>
              Seed: owner@smasharena.local / owner12345 ·
              admin@sportsbooking.local / admin12345
            </p>
          </>
        )}
        <Msg text={msg} />
      </Card>
    </div>
  );
}
