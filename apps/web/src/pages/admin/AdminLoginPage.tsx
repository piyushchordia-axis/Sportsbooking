import { UserRole } from '@sportsbooking/shared';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Mail,
} from 'lucide-react';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Msg } from '../../components/common';

/** Where each console role lands after a successful sign-in. */
const HOME: Record<UserRole, string> = {
  [UserRole.CUSTOMER]: '/',
  [UserRole.OWNER]: '/owner',
  [UserRole.STAFF]: '/owner/venues',
  [UserRole.SUPER_ADMIN]: '/admin',
};

const FEATURES = [
  { k: 'BOOKINGS', v: 'Live view' },
  { k: 'PRICING', v: 'Per court' },
  { k: 'REPORTS', v: 'Built in' },
];

/**
 * Console sign-in for owners, staff and super-admins (email + password, RBAC).
 * Reached only by navigating to /admin (or /admin/login) directly — it is never
 * linked from the consumer storefront. Players sign in with OTP at /login.
 */
export function AdminLoginPage() {
  const { setSession } = useAuth();
  const nav = useNavigate();
  const [msg, setMsg] = useState<string | null>(null);
  const [showPass, setShowPass] = useState(false);

  const [email, setEmail] = useState(import.meta.env.DEV ? 'owner@smasharena.local' : '');
  const [password, setPassword] = useState(import.meta.env.DEV ? 'owner12345' : '');

  // Forgot-password: 'signin' → 'request' (enter email) → 'reset' (token + new pw).
  const [pwStep, setPwStep] = useState<'signin' | 'request' | 'reset'>('signin');
  const [resetEmail, setResetEmail] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [resetNewPass, setResetNewPass] = useState('');
  const [busy, setBusy] = useState(false);

  const goStep = (step: 'signin' | 'request' | 'reset') => {
    setPwStep(step);
    setMsg(null);
  };

  const finish = (res: Parameters<typeof setSession>[0]) => {
    setSession(res);
    nav(HOME[res.user.role]);
  };

  const signIn = async () => {
    setMsg(null);
    setBusy(true);
    try {
      finish(await api.staffLogin(email, password));
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const requestReset = async () => {
    setMsg(null);
    setBusy(true);
    try {
      await api.requestPasswordReset(resetEmail.trim());
      setMsg('If that email exists, a reset code was sent.');
      setPwStep('reset');
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submitReset = async () => {
    setMsg(null);
    if (resetNewPass.length < 8) {
      setMsg('New password must be at least 8 characters.');
      return;
    }
    setBusy(true);
    try {
      await api.resetPassword(resetToken.trim(), resetNewPass);
      setResetToken('');
      setResetNewPass('');
      setPwStep('signin');
      setMsg('Password updated. You can now sign in.');
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const inputBase =
    'h-11 w-full rounded-xl border border-border bg-input-background pl-10 pr-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20';

  return (
    <div
      className="dark relative min-h-screen overflow-hidden bg-background text-foreground"
      style={{
        background:
          'linear-gradient(105deg in oklab, oklch(0.29 0.082 184) 0%, oklch(0.2 0.05 185) 14%, oklch(0.155 0.016 90) 28%, oklch(0.135 0.009 56) 60%, oklch(0.125 0.008 56) 100%)',
      }}
    >
      <div
        className="grid-backdrop pointer-events-none absolute inset-0 opacity-100"
        style={{
          maskImage:
            'linear-gradient(to right, rgba(0,0,0,1) 0%, rgba(0,0,0,0.85) 38%, rgba(0,0,0,0) 72%)',
          WebkitMaskImage:
            'linear-gradient(to right, rgba(0,0,0,1) 0%, rgba(0,0,0,0.85) 38%, rgba(0,0,0,0) 72%)',
        }}
      />
      <div className="pointer-events-none absolute -left-[8%] -top-1/4 h-[65%] w-[52%] rounded-full bg-primary/25 blur-[150px]" />

      <div className="relative grid min-h-screen lg:grid-cols-2">
        {/* Left hero content */}
        <div className="hidden flex-col justify-between p-12 text-white lg:flex xl:p-16">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-white/5 ring-1 ring-white/10">
              <Activity className="h-6 w-6 text-primary" strokeWidth={2.6} />
            </span>
            <div className="leading-tight">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">
                Turf Management System
              </p>
              <p className="font-display text-lg font-bold">Sportline</p>
            </div>
          </div>

          <div>
            <h1 className="font-display text-5xl font-extrabold leading-[1.02] tracking-tight xl:text-6xl">
              The home ground
              <br />
              for turf owners.
            </h1>
            <p className="mt-5 max-w-md text-lg text-white/55">
              Bookings, schedules, pricing, and payments — manage it all in one place.
            </p>
          </div>

          <div className="grid max-w-md grid-cols-3 gap-3">
            {FEATURES.map((f) => (
              <div
                key={f.k}
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur-sm"
              >
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">
                  {f.k}
                </p>
                <p className="mt-1 font-semibold">{f.v}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Right — auth panel */}
        <div className="flex items-center justify-center p-6 sm:p-10">
          <div className="w-full max-w-md">
            <div className="rounded-3xl border border-border bg-card/90 p-7 backdrop-blur-xl sm:p-9">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
                Console access
              </p>
              <h2 className="mt-2 font-display text-3xl font-bold tracking-tight">
                Welcome back
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Owners and staff sign in here to manage venues, bookings and operations.
              </p>

              {pwStep === 'signin' ? (
                <div className="mt-6">
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium">Email</span>
                    <div className="relative">
                      <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="name@company.com"
                        className={inputBase}
                      />
                    </div>
                  </label>

                  <label className="mt-4 block">
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-sm font-medium">Password</span>
                      <button
                        type="button"
                        onClick={() => {
                          setResetEmail(email);
                          goStep('request');
                        }}
                        className="text-xs font-semibold text-primary hover:underline"
                      >
                        Forgot password?
                      </button>
                    </div>
                    <div className="relative">
                      <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <input
                        type={showPass ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter your password"
                        className={`${inputBase} pr-10`}
                        onKeyDown={(e) => e.key === 'Enter' && !busy && signIn()}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPass((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        aria-label={showPass ? 'Hide password' : 'Show password'}
                      >
                        {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </label>

                  <button
                    onClick={signIn}
                    disabled={busy}
                    className="glow-primary mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground transition-transform active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {busy ? 'Signing in…' : 'Sign in'} <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              ) : pwStep === 'request' ? (
                <div className="mt-6">
                  <button
                    type="button"
                    onClick={() => goStep('signin')}
                    className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
                  >
                    <ArrowLeft className="h-4 w-4" /> Back to sign in
                  </button>

                  <h3 className="font-display text-lg font-semibold">Reset your password</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Enter your account email and we&apos;ll send a reset code.
                  </p>

                  <label className="mt-5 block">
                    <span className="mb-1.5 block text-sm font-medium">Email</span>
                    <div className="relative">
                      <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <input
                        type="email"
                        value={resetEmail}
                        onChange={(e) => setResetEmail(e.target.value)}
                        placeholder="name@company.com"
                        className={inputBase}
                        onKeyDown={(e) => e.key === 'Enter' && !busy && requestReset()}
                      />
                    </div>
                  </label>

                  <button
                    onClick={requestReset}
                    disabled={busy || !resetEmail.trim()}
                    className="glow-primary mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground transition-transform active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {busy ? 'Sending…' : 'Send reset code'} <ArrowRight className="h-4 w-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() => goStep('reset')}
                    className="mt-3 w-full text-center text-sm font-medium text-muted-foreground hover:text-foreground"
                  >
                    I already have a reset code
                  </button>
                </div>
              ) : (
                <div className="mt-6">
                  <button
                    type="button"
                    onClick={() => goStep('request')}
                    className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
                  >
                    <ArrowLeft className="h-4 w-4" /> Back
                  </button>

                  <h3 className="font-display text-lg font-semibold">Enter your reset code</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Paste the code you received, then choose a new password.
                  </p>

                  <label className="mt-5 block">
                    <span className="mb-1.5 block text-sm font-medium">Reset code</span>
                    <div className="relative">
                      <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <input
                        value={resetToken}
                        onChange={(e) => setResetToken(e.target.value)}
                        placeholder="Paste reset code"
                        className={inputBase}
                      />
                    </div>
                  </label>

                  <label className="mt-4 block">
                    <span className="mb-1.5 block text-sm font-medium">New password</span>
                    <div className="relative">
                      <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <input
                        type={showPass ? 'text' : 'password'}
                        value={resetNewPass}
                        onChange={(e) => setResetNewPass(e.target.value)}
                        placeholder="At least 8 characters"
                        className={`${inputBase} pr-10`}
                        onKeyDown={(e) => e.key === 'Enter' && !busy && submitReset()}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPass((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        aria-label={showPass ? 'Hide password' : 'Show password'}
                      >
                        {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </label>

                  <button
                    onClick={submitReset}
                    disabled={busy || !resetToken.trim() || !resetNewPass}
                    className="glow-primary mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground transition-transform active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {busy ? 'Updating…' : 'Set new password'} <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              )}

              <Msg text={msg} />
            </div>

            {import.meta.env.DEV && (
              <p className="mt-4 text-center text-xs text-white/35">
                Dev seed · owner@smasharena.local / owner12345 · admin@sportsbooking.local /
                admin12345
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
