import { UserRole } from '@sportsbooking/shared';
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Msg } from '../../components/common';
import { normalizeMobile } from '../../lib/mobile';
import { useStorefront } from '../../storefront/StorefrontProvider';
import { useTheme } from '../../theme/ThemeProvider';

/**
 * Player sign-in / sign-up. OTP (mobile) only, per PRD §2.1 — one flow that
 * signs you in if you're a returning player and creates your profile if you're
 * new. Owner / staff / super-admin sign in elsewhere (the console at /admin);
 * nothing here references the back office.
 */
export function PlayerAuthPage() {
  const { user, setSession } = useAuth();
  const { scoped, ownerName } = useStorefront();
  const { mode } = useTheme();
  const nav = useNavigate();

  // Brand tile initial: operator's first letter when scoped, else "S" (Sportline).
  const brandInitial = (scoped && ownerName ? ownerName : 'Sportline').charAt(0).toUpperCase();

  const [mobile, setMobile] = useState('+91');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Already a signed-in player — send them to the storefront, not the landing.
  if (user?.role === UserRole.CUSTOMER) return <Navigate to="/browse" replace />;

  const sendOtp = async () => {
    // Canonicalise to +91XXXXXXXXXX (matches the API) so a returning player
    // always resolves to the same account, whatever shape they type.
    const normalized = normalizeMobile(mobile);
    if (!normalized) {
      setMsg('Enter a valid 10-digit mobile number.');
      return;
    }
    setMsg(null);
    setBusy(true);
    try {
      await api.requestOtp(normalized);
      setSent(true);
      setMsg(import.meta.env.DEV ? 'Code sent. In dev, use 123456.' : 'Code sent to your phone.');
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    const normalized = normalizeMobile(mobile);
    if (!normalized) {
      setMsg('Enter a valid 10-digit mobile number.');
      return;
    }
    setMsg(null);
    setBusy(true);
    try {
      const res = await api.verifyOtp(normalized, code.trim(), name.trim() || undefined);
      setSession(res);
      nav('/browse');
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const fieldStyle: React.CSSProperties = {
    width: '100%',
    background: 'var(--bg-2)',
    border: '1px solid var(--line-strong)',
    borderRadius: 12,
    padding: '15px 16px',
    color: 'var(--chalk)',
    outline: 'none',
  };

  // Secondary action ("Change number", "Resend code") — Floodlit, never console teal.
  const secondaryBtnStyle: React.CSSProperties = {
    background: 'var(--surface)',
    border: '1px solid var(--line-strong)',
    color: 'var(--chalk)',
  };

  return (
    <div
      className="floodlit flex min-h-screen items-center justify-center px-4 py-8"
      data-fl-mode={mode}
    >
      <div
        className="w-full max-w-md rounded-2xl"
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--line-strong)',
          boxShadow: '0 30px 80px -30px rgba(0,0,0,0.6)',
          padding: 28,
        }}
      >
        {/* Back to storefront */}
        <button
          type="button"
          onClick={() => nav('/')}
          aria-label="Back"
          className="grid h-9 w-9 place-items-center rounded-full text-[17px]"
          style={{
            border: '1px solid var(--line-strong)',
            background: 'var(--bg-2)',
            color: 'var(--chalk)',
          }}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>

        {/* Brand tile + title */}
        <div className="mt-6">
          <span
            className="fl-display grid place-items-center"
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              background: 'var(--brand)',
              color: 'var(--on-brand)',
              fontWeight: 800,
              fontSize: 26,
            }}
          >
            {brandInitial}
          </span>
          <h1
            className="fl-display mt-4"
            style={{ fontWeight: 800, fontSize: 32, lineHeight: 1, color: 'var(--chalk)' }}
          >
            {sent ? 'Enter your code' : 'Log in or sign up'}
          </h1>
          <p className="mt-2.5 text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
            {sent
              ? 'Pop in the 6-digit code we just texted you.'
              : "We'll text you a one-time code — no passwords to remember."}
          </p>
        </div>

        {!sent ? (
          <div>
            <input
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              placeholder="+91 98765 43210"
              inputMode="tel"
              aria-label="Mobile number"
              className="fl-mono mt-6"
              style={{ ...fieldStyle, fontSize: 17, letterSpacing: '0.06em' }}
              onKeyDown={(e) => e.key === 'Enter' && !busy && sendOtp()}
            />
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name (new players only)"
              aria-label="Your name"
              className="mt-2.5"
              style={{ ...fieldStyle, fontSize: 15 }}
            />
            <button
              type="button"
              onClick={sendOtp}
              disabled={busy}
              className="mt-3.5 w-full rounded-xl py-[15px] text-base font-bold transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
              style={{ background: 'var(--brand)', color: 'var(--on-brand)', border: 'none' }}
            >
              {busy ? 'Sending…' : 'Send code'}
            </button>
            <p
              className="mt-3 text-center text-[11.5px] leading-relaxed"
              style={{ color: 'var(--faint)' }}
            >
              No passwords, ever. First time? We'll create your account automatically.
            </p>
          </div>
        ) : (
          <div>
            <div className="mt-6 text-[13px]" style={{ color: 'var(--muted)' }}>
              Code sent to{' '}
              <span className="fl-mono" style={{ color: 'var(--chalk)', fontWeight: 600 }}>
                {mobile}
              </span>
            </div>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="······"
              inputMode="numeric"
              maxLength={6}
              autoFocus
              aria-label="6-digit code"
              className="fl-mono mt-3"
              style={{
                ...fieldStyle,
                padding: 16,
                fontSize: 24,
                letterSpacing: '0.5em',
                textAlign: 'center',
              }}
              onKeyDown={(e) => e.key === 'Enter' && !busy && verify()}
            />
            <button
              type="button"
              onClick={verify}
              disabled={busy || code.trim().length < 4}
              className="mt-3.5 w-full rounded-xl py-[15px] text-base font-bold transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
              style={{ background: 'var(--brand)', color: 'var(--on-brand)', border: 'none' }}
            >
              {busy ? 'Verifying…' : 'Verify'}
            </button>

            <div className="mt-3.5 grid grid-cols-2 gap-2.5 text-sm">
              <button
                type="button"
                onClick={() => {
                  setSent(false);
                  setCode('');
                  setMsg(null);
                }}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl py-3 font-semibold transition-opacity"
                style={secondaryBtnStyle}
              >
                <ArrowLeft className="h-4 w-4" /> Change number
              </button>
              <button
                type="button"
                onClick={sendOtp}
                disabled={busy}
                className="rounded-xl py-3 font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
                style={secondaryBtnStyle}
              >
                Resend code
              </button>
            </div>
          </div>
        )}

        <Msg text={msg} />

        <p className="mt-6 text-xs leading-relaxed" style={{ color: 'var(--faint)' }}>
          By continuing you agree to receive booking updates. We only use your number to run
          your bookings.
        </p>
      </div>
    </div>
  );
}
