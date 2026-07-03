import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ command, mode }) => {
  // Build-time guardrail: a production build without a Razorpay key ships a
  // storefront that can't take online payments (prepay is hidden, pay-at-venue
  // only). That's a valid launch mode, so we WARN loudly rather than fail — set
  // VITE_RAZORPAY_KEY_ID to enable online prepay.
  if (command === 'build') {
    const env = loadEnv(mode, process.cwd(), '');
    if (!env.VITE_RAZORPAY_KEY_ID) {
      console.warn(
        '\n\x1b[33m[build] VITE_RAZORPAY_KEY_ID is not set — online prepay will be ' +
          'DISABLED in this bundle (pay-at-venue only). Set it to enable Razorpay ' +
          'checkout.\x1b[0m\n',
      );
    }
  }

  return {
  plugins: [react(), tailwindcss()],
  resolve: {
    // With pnpm's symlinked store, Radix/Recharts can resolve their own copy of
    // React, which breaks hooks ("Invalid hook call … more than one copy of
    // React"). Force a single instance.
    dedupe: ['react', 'react-dom'],
    alias: {
      // Resolve the shared contract to its TS source so Vite can statically
      // analyse enum exports (the CJS dist uses export* which bundlers can't
      // tree-shake). The API continues to consume the built CJS dist.
      '@sportsbooking/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-dom/client'],
  },
  server: {
    host: '0.0.0.0',
    port: 5000,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: process.env.VITE_API_BASE_URL ?? 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  };
});
