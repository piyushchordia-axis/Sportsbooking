import { UserRole } from '@sportsbooking/shared';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Field, Msg } from '../components/common';
import { HERO_IMAGE } from '../lib/imagery';

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

  const tabBtn = (id: 'customer' | 'staff', text: string) => (
    <button
      onClick={() => setTab(id)}
      className={`flex-1 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
        tab === id
          ? 'bg-primary text-primary-foreground'
          : 'bg-secondary text-secondary-foreground/70 hover:text-secondary-foreground'
      }`}
    >
      {text}
    </button>
  );

  return (
    <div className="min-h-[calc(100vh-4rem)] grid lg:grid-cols-2">
      {/* Hero (desktop) */}
      <div className="relative hidden lg:block overflow-hidden">
        <img
          src={HERO_IMAGE}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-tr from-background via-background/75 to-background/25" />
        <div className="relative h-full flex flex-col justify-end p-10 xl:p-14">
          <span className="inline-flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-primary mb-4">
            <Activity className="h-4 w-4" strokeWidth={2.5} /> Game on
          </span>
          <h2 className="font-display font-bold text-4xl xl:text-5xl leading-[1.05] max-w-md">
            Book courts.<br />Run venues.<br />Own game day.
          </h2>
          <p className="text-muted-foreground mt-4 max-w-sm">
            Pickleball, badminton, turf football &amp; box cricket — one place to play, and to
            run your arena.
          </p>
        </div>
      </div>

      {/* Auth panel */}
      <div className="grid place-items-center px-4 py-10">
        <div className="w-full max-w-md">
          {/* Hero (mobile banner) */}
          <div className="lg:hidden relative h-32 rounded-2xl overflow-hidden mb-6">
            <img src={HERO_IMAGE} alt="" className="absolute inset-0 h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-background via-background/50 to-transparent" />
          </div>

          <div className="flex flex-col items-center text-center mb-8">
            <span className="grid place-items-center h-14 w-14 rounded-2xl bg-primary text-primary-foreground mb-4">
              <Activity className="h-8 w-8" strokeWidth={2.5} />
            </span>
            <h1 className="font-display font-bold text-3xl tracking-tight">
              Sport<span className="text-primary">line</span>
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Book courts. Run venues. Own game day.
            </p>
          </div>

          <div className="bg-card border border-border rounded-xl p-6">
            <div className="flex gap-2 mb-5">
              {tabBtn('customer', 'Player (OTP)')}
              {tabBtn('staff', 'Owner / Staff / Admin')}
            </div>

            {tab === 'customer' ? (
              <>
                <Field label="Mobile" value={mobile} onChange={setMobile} />
                <Field label="Name" value={name} onChange={setName} />
                {!sent ? (
                  <button
                    onClick={sendOtp}
                    className="w-full mt-1 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold hover:bg-primary/90 transition-colors"
                  >
                    Send OTP
                  </button>
                ) : (
                  <>
                    <Field
                      label="OTP code"
                      value={code}
                      onChange={setCode}
                      placeholder="123456"
                    />
                    <button
                      onClick={verify}
                      className="w-full mt-1 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold hover:bg-primary/90 transition-colors"
                    >
                      Verify &amp; continue
                    </button>
                  </>
                )}
              </>
            ) : (
              <>
                <Field label="Email" value={email} onChange={setEmail} />
                <Field
                  label="Password"
                  type="password"
                  value={password}
                  onChange={setPassword}
                />
                <button
                  onClick={staffLogin}
                  className="w-full mt-1 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold hover:bg-primary/90 transition-colors"
                >
                  Sign in
                </button>
                <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
                  Seed: owner@smasharena.local / owner12345 ·
                  admin@sportsbooking.local / admin12345
                </p>
              </>
            )}
            <Msg text={msg} />
          </div>
        </div>
      </div>
    </div>
  );
}
