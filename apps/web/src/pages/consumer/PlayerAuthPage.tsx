import { UserRole } from '@sportsbooking/shared';
import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Activity,
  CalendarCheck,
  Phone,
  ShieldCheck,
  Swords,
  User,
  Wallet,
} from 'lucide-react';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Msg } from '../../components/common';

/** Player perks shown on the hero panel — why bother signing in. */
const PERKS = [
  { icon: CalendarCheck, label: 'Book a slot in seconds' },
  { icon: Swords, label: 'Host or join open matches' },
  { icon: Wallet, label: 'Earn credit every game' },
];

/**
 * Player sign-in / sign-up. OTP (mobile) only, per PRD §2.1 — one flow that
 * signs you in if you're a returning player and creates your profile if you're
 * new. Owner / staff / super-admin sign in elsewhere (the console at /admin);
 * nothing here references the back office.
 */
export function PlayerAuthPage() {
  const { user, setSession } = useAuth();
  const nav = useNavigate();

  const [mobile, setMobile] = useState('+91');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Already a signed-in player — nothing to do here.
  if (user?.role === UserRole.CUSTOMER) return <Navigate to="/" replace />;

  const inputBase =
    'h-12 w-full rounded-xl border border-white/15 bg-white/[0.04] pl-11 pr-3 text-sm text-white outline-none transition-colors placeholder:text-white/35 focus-visible:border-accent/60 focus-visible:ring-2 focus-visible:ring-accent/25';

  const sendOtp = async () => {
    if (mobile.replace(/\D/g, '').length < 10) {
      setMsg('Enter a valid mobile number to get your code.');
      return;
    }
    setMsg(null);
    setBusy(true);
    try {
      await api.requestOtp(mobile.trim());
      setSent(true);
      setMsg(import.meta.env.DEV ? 'Code sent. In dev, use 123456.' : 'Code sent to your phone.');
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setMsg(null);
    setBusy(true);
    try {
      const res = await api.verifyOtp(mobile.trim(), code.trim(), name.trim() || undefined);
      setSession(res);
      nav('/');
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden text-white">
      {/* Floodlit night backdrop */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(155deg in oklab, oklch(0.29 0.072 176) 0%, oklch(0.2 0.044 172) 36%, oklch(0.15 0.02 165) 68%, oklch(0.12 0.012 160) 100%)',
        }}
      />
      <div
        className="pitch-lines absolute inset-0 opacity-40"
        aria-hidden
        style={{
          maskImage: 'radial-gradient(120% 90% at 25% 0%, black 30%, transparent 78%)',
          WebkitMaskImage: 'radial-gradient(120% 90% at 25% 0%, black 30%, transparent 78%)',
        }}
      />
      <div
        className="pointer-events-none absolute -top-24 left-[6%] h-72 w-72 rounded-full bg-accent/25 blur-[140px]"
        aria-hidden
      />

      <div className="relative grid min-h-screen lg:grid-cols-2">
        {/* Hero panel */}
        <div className="hidden flex-col justify-between p-12 lg:flex xl:p-16">
          <Link to="/" className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-white/[0.06] ring-1 ring-white/12">
              <Activity className="h-6 w-6 text-accent" strokeWidth={2.6} />
            </span>
            <span className="ff-display text-xl font-extrabold tracking-tight">
              Sport<span className="text-primary">line</span>
            </span>
          </Link>

          <div>
            <h1 className="ff-display text-5xl font-extrabold leading-[0.98] tracking-tight xl:text-6xl">
              Game on.
              <br />
              <span className="text-accent">Let's get you playing.</span>
            </h1>
            <p className="mt-5 max-w-md text-lg text-white/60">
              One number is all it takes. Sign in or set up your profile and your next
              game is a tap away.
            </p>
          </div>

          <ul className="space-y-3">
            {PERKS.map((p) => (
              <li key={p.label} className="flex items-center gap-3 text-white/75">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/[0.06] text-accent ring-1 ring-white/10">
                  <p.icon className="h-[18px] w-[18px]" />
                </span>
                {p.label}
              </li>
            ))}
          </ul>
        </div>

        {/* Auth card */}
        <div className="flex items-center justify-center p-6 sm:p-10">
          <div className="w-full max-w-md">
            <Link
              to="/"
              className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-white/55 transition-colors hover:text-white lg:hidden"
            >
              <ArrowLeft className="h-4 w-4" /> Back home
            </Link>

            <div className="rounded-3xl border border-white/12 bg-[oklch(0.17_0.022_168)]/80 p-7 backdrop-blur-xl sm:p-9">
              <span className="ff-score inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-accent">
                <ShieldCheck className="h-4 w-4" /> Player access
              </span>
              <h2 className="ff-display mt-3 text-3xl font-extrabold tracking-tight">
                {sent ? 'Enter your code' : 'Sign in to play'}
              </h2>
              <p className="mt-2 text-sm text-white/55">
                {sent
                  ? `We sent a 6-digit code to ${mobile}.`
                  : "We'll text you a one-time code — no passwords to remember."}
              </p>

              {!sent ? (
                <div className="mt-7">
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-white/80">
                      Mobile number
                    </span>
                    <div className="relative">
                      <Phone className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                      <input
                        value={mobile}
                        onChange={(e) => setMobile(e.target.value)}
                        placeholder="+91 98765 43210"
                        inputMode="tel"
                        className={inputBase}
                        onKeyDown={(e) => e.key === 'Enter' && !busy && sendOtp()}
                      />
                    </div>
                  </label>

                  <label className="mt-4 block">
                    <span className="mb-1.5 block text-sm font-medium text-white/80">
                      Your name{' '}
                      <span className="font-normal text-white/40">· new players only</span>
                    </span>
                    <div className="relative">
                      <User className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                      <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="What should we call you?"
                        className={inputBase}
                      />
                    </div>
                  </label>

                  <button
                    onClick={sendOtp}
                    disabled={busy}
                    className="glow-primary mt-7 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground transition-transform active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {busy ? 'Sending…' : 'Get my code'} <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div className="mt-7">
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-white/80">
                      6-digit code
                    </span>
                    <input
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      placeholder="······"
                      inputMode="numeric"
                      maxLength={6}
                      autoFocus
                      className="ff-score h-12 w-full rounded-xl border border-white/15 bg-white/[0.04] px-4 text-center text-lg tracking-[0.4em] text-white outline-none transition-colors placeholder:text-white/25 focus-visible:border-accent/60 focus-visible:ring-2 focus-visible:ring-accent/25"
                      onKeyDown={(e) => e.key === 'Enter' && !busy && verify()}
                    />
                  </label>

                  <button
                    onClick={verify}
                    disabled={busy || code.trim().length < 4}
                    className="glow-primary mt-7 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground transition-transform active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {busy ? 'Verifying…' : 'Verify & play'} <ArrowRight className="h-4 w-4" />
                  </button>

                  <div className="mt-4 flex items-center justify-between text-sm">
                    <button
                      onClick={() => {
                        setSent(false);
                        setCode('');
                        setMsg(null);
                      }}
                      className="inline-flex items-center gap-1.5 font-medium text-white/55 transition-colors hover:text-white"
                    >
                      <ArrowLeft className="h-4 w-4" /> Change number
                    </button>
                    <button
                      onClick={sendOtp}
                      disabled={busy}
                      className="font-semibold text-accent hover:underline disabled:opacity-60"
                    >
                      Resend code
                    </button>
                  </div>
                </div>
              )}

              <Msg text={msg} />

              <p className="mt-6 text-xs leading-relaxed text-white/40">
                By continuing you agree to receive booking updates by SMS/WhatsApp. We
                only use your number to run your bookings.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
