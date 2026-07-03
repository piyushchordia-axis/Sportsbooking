/// <reference types="vite/client" />

/**
 * Razorpay checkout helper for the customer prepay flow.
 *
 * The checkout widget script is loaded from Razorpay's CDN and is *not* a bundled
 * dependency, so we lazy-load it on first use and cache the promise. In
 * development the publishable key (`VITE_RAZORPAY_KEY_ID`) is typically unset, so
 * `razorpayEnabled` is false and callers fall back to the existing mock-payment
 * path — the live modal only opens when a real key is configured (production).
 */

const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

/** Razorpay publishable key from the build-time env (empty/undefined in dev). */
const KEY_ID = import.meta.env.VITE_RAZORPAY_KEY_ID as string | undefined;

/** True only when a Razorpay key is configured (production). */
export const razorpayEnabled = !!KEY_ID;

/**
 * Whether the storefront may offer online prepay at all. In a DEV build the
 * mock-payment path is acceptable (lets us exercise prepay without a gateway);
 * in a production build it is NOT — a prod build without a key would create a
 * PENDING prepay booking, open no checkout, and let it silently expire. So a
 * production build without a Razorpay key must hide online prepay and offer only
 * pay-at-venue. UI surfaces gate their prepay controls on this.
 */
export const onlinePrepayAvailable = razorpayEnabled || import.meta.env.DEV;

// Loud runtime signal if a production bundle shipped without the key (online
// prepay silently unavailable). Build-time detection lives in vite.config.ts.
if (import.meta.env.PROD && !razorpayEnabled) {
  console.warn(
    '[payments] VITE_RAZORPAY_KEY_ID is not set — online prepay is DISABLED; ' +
      'the storefront will offer pay-at-venue only.',
  );
}

/** Signature payload Razorpay hands back on a successful payment. */
export interface RazorpaySuccess {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

/** Error payload Razorpay emits on `payment.failed`. */
export interface RazorpayFailure {
  code?: string;
  description?: string;
  reason?: string;
  step?: string;
  source?: string;
}

export interface OpenCheckoutOptions {
  /** Razorpay order id returned by our booking API. */
  orderId: string;
  /** Amount in the smallest currency unit (paise). */
  amount: number;
  /** Display name shown in the checkout modal. */
  name: string;
  /** Optional customer prefill for the modal form. */
  prefill?: { name?: string; email?: string; contact?: string };
  /** Called with the verification ids once the payment succeeds. */
  onSuccess: (result: RazorpaySuccess) => void;
  /** Called when the customer closes the modal without paying. */
  onDismiss?: () => void;
  /** Called when Razorpay reports a failed payment attempt. */
  onFailure?: (error: RazorpayFailure) => void;
}

// Minimal shape of the global the CDN script installs on `window`.
interface RazorpayInstance {
  open: () => void;
  on: (event: string, handler: (payload: unknown) => void) => void;
}
interface RazorpayConstructor {
  new (options: Record<string, unknown>): RazorpayInstance;
}
declare global {
  interface Window {
    Razorpay?: RazorpayConstructor;
  }
}

let scriptPromise: Promise<void> | null = null;

/** Lazy-load the Razorpay checkout script exactly once. */
function loadCheckoutScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = CHECKOUT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = null; // allow a retry on next attempt
      reject(new Error('Failed to load Razorpay checkout'));
    };
    document.body.appendChild(script);
  });
  return scriptPromise;
}

/**
 * Open the Razorpay checkout modal for an existing order. Resolves once the
 * modal has been opened; the result is delivered via `onSuccess`.
 */
export async function openCheckout(options: OpenCheckoutOptions): Promise<void> {
  if (!KEY_ID) throw new Error('Razorpay is not configured');
  await loadCheckoutScript();
  if (!window.Razorpay) throw new Error('Razorpay failed to initialise');

  const rzp = new window.Razorpay({
    key: KEY_ID,
    order_id: options.orderId,
    amount: options.amount,
    name: options.name,
    prefill: options.prefill,
    handler: (response: RazorpaySuccess) => {
      options.onSuccess({
        razorpay_payment_id: response.razorpay_payment_id,
        razorpay_order_id: response.razorpay_order_id,
        razorpay_signature: response.razorpay_signature,
      });
    },
    // The customer closed the checkout modal without completing payment.
    modal: {
      ondismiss: () => options.onDismiss?.(),
    },
  });
  // Surface a failed payment attempt (gateway/bank decline, etc.) to the caller.
  rzp.on('payment.failed', (payload: unknown) => {
    const error = (payload as { error?: RazorpayFailure } | undefined)?.error ?? {};
    options.onFailure?.(error);
  });
  rzp.open();
}
