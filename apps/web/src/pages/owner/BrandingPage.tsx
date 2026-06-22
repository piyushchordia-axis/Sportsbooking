import { Branding } from '@sportsbooking/shared';
import { useEffect, useMemo, useState } from 'react';
import {
  CalendarCheck,
  Check,
  Image as ImageIcon,
  Moon,
  Palette,
  RotateCcw,
  Save,
  Sun,
} from 'lucide-react';
import { api } from '../../api/client';
import {
  Card,
  Field,
  Msg,
  OwnerLogo,
  PageHeader,
  SectionLabel,
  useLoad,
} from '../../components/common';
import { Button } from '../../components/ui/button';
import { Switch } from '../../components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { Skeleton } from '../../components/ui/skeleton';
import { DEFAULT_BRANDING, useTheme } from '../../theme/ThemeProvider';

const HEX = /^#([0-9a-fA-F]{6})$/;

/** Relative luminance of a #rrggbb colour (0–1), sRGB-weighted. */
function luminance(hex: string): number {
  if (!HEX.test(hex)) return 0.5;
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** Legible ink for text/icons placed on a brand colour. Mirrors the app theme. */
function inkOn(hex: string): string {
  return luminance(hex) > 0.62 ? '#1B201D' : '#F7F6F2';
}

/** Colour roles in the order they read in the storefront. */
const ROLES = [
  {
    key: 'primaryColor',
    label: 'Primary',
    help: 'Buttons, links and active states',
  },
  {
    key: 'secondaryColor',
    label: 'Secondary',
    help: 'Surfaces, headers and chips',
  },
  {
    key: 'accentColor',
    label: 'Accent',
    help: 'Highlights, badges and offers',
  },
] as const;

type RoleKey = (typeof ROLES)[number]['key'];

/** Surfaces the customer sees the brand on — drives the preview copy. */
const SURFACES = [
  { value: 'booking', label: 'Booking page' },
  { value: 'checkout', label: 'Checkout' },
  { value: 'email', label: 'Confirmation email' },
] as const;

type Surface = (typeof SURFACES)[number]['value'];

/** Colour-well + hex input bound to one brand role, with a live preview chip. */
function ColorField({
  label,
  help,
  value,
  onChange,
}: {
  label: string;
  help: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const valid = HEX.test(value);
  return (
    <div className="rounded-xl border border-border bg-elevated/60 p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span
          className={`font-mono text-[11px] uppercase ${
            valid ? 'text-muted-foreground' : 'text-destructive'
          }`}
        >
          {valid ? value : 'Invalid'}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <label className="relative shrink-0 cursor-pointer">
          <span
            className="block h-10 w-10 rounded-lg border border-border shadow-sm"
            style={{ backgroundColor: valid ? value : 'transparent' }}
          />
          <input
            type="color"
            value={valid ? value : '#000000'}
            onChange={(e) => onChange(e.target.value)}
            aria-label={`${label} colour`}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>
        <input
          type="text"
          value={value}
          placeholder="#14C8A2"
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} hex value`}
          className="flex h-10 w-full min-w-0 rounded-lg border border-border bg-input-background px-3 py-1 font-mono text-sm text-foreground uppercase transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20"
        />
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">{help}</p>
    </div>
  );
}

/**
 * A faithful, self-contained mock of how the brand appears in the storefront.
 * Driven entirely by the in-progress colours so owners see changes before saving.
 */
function StorefrontPreview({
  logoUrl,
  primary,
  secondary,
  accent,
  dark,
  surface,
}: {
  logoUrl: string;
  primary: string;
  secondary: string;
  accent: string;
  dark: boolean;
  surface: Surface;
}) {
  const ok = HEX.test(primary) && HEX.test(secondary) && HEX.test(accent);
  // Neutral page colours follow the chosen preview mode, not the app's own mode,
  // so the owner can sanity-check both light and dark storefronts.
  const page = dark ? '#17211D' : '#FBFAF7';
  const surfaceBg = dark ? '#1F2B26' : '#FFFFFF';
  const ink = dark ? '#F2F0EB' : '#1B201D';
  const subtle = dark ? '#A9B2AD' : '#6C746F';
  const hairline = dark ? '#2C3A34' : '#E7E3DB';
  const onPrimary = ok ? inkOn(primary) : '#fff';
  const onAccent = ok ? inkOn(accent) : '#fff';

  const cta =
    surface === 'checkout'
      ? 'Pay & confirm'
      : surface === 'email'
        ? 'View booking'
        : 'Book this slot';
  const headline =
    surface === 'checkout'
      ? 'Confirm your court'
      : surface === 'email'
        ? "You're all set"
        : 'Centre Court · 7:00 PM';

  return (
    <div
      className="overflow-hidden rounded-2xl border shadow-sm"
      style={{ backgroundColor: page, borderColor: hairline }}
    >
      {/* Brand bar */}
      <div
        className="flex items-center gap-3 px-4 py-3"
        style={{ backgroundColor: secondary, borderBottom: `1px solid ${hairline}` }}
      >
        <OwnerLogo logoUrl={logoUrl || null} name="Brand" className="h-9 w-9" />
        <span
          className="font-display text-sm font-semibold leading-none"
          style={{ color: inkOn(HEX.test(secondary) ? secondary : '#17211D') }}
        >
          Your venue
        </span>
        <span
          className="ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold"
          style={{ backgroundColor: accent, color: onAccent }}
        >
          Member
        </span>
      </div>

      {/* Body */}
      <div className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="font-display text-base font-semibold" style={{ color: ink }}>
            {headline}
          </p>
          <span
            className="rounded-md px-2 py-0.5 text-[11px] font-medium"
            style={{
              color: accent,
              backgroundColor: `color-mix(in srgb, ${ok ? accent : '#888'} 16%, transparent)`,
            }}
          >
            20% off
          </span>
        </div>
        <p className="text-xs leading-relaxed" style={{ color: subtle }}>
          {surface === 'email'
            ? 'A receipt is on its way. Tap below to manage your booking.'
            : 'Indoor · 60 min · 2–4 players. Cancel free up to 24h before.'}
        </p>

        <div
          className="rounded-xl p-3"
          style={{ backgroundColor: surfaceBg, border: `1px solid ${hairline}` }}
        >
          <div className="mb-2 flex items-center justify-between text-xs" style={{ color: subtle }}>
            <span>Total</span>
            <span className="font-mono font-semibold" style={{ color: ink }}>
              ₹ 900
            </span>
          </div>
          <button
            type="button"
            tabIndex={-1}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold"
            style={{ backgroundColor: primary, color: onPrimary }}
          >
            <CalendarCheck className="h-4 w-4" />
            {cta}
          </button>
          <button
            type="button"
            tabIndex={-1}
            className="mt-2 w-full rounded-lg border py-2 text-sm font-medium"
            style={{ borderColor: primary, color: primary, backgroundColor: 'transparent' }}
          >
            Save for later
          </button>
        </div>
      </div>
    </div>
  );
}

export function BrandingPage() {
  const { setBranding } = useTheme();
  const { data, error, loading } = useLoad<Branding>(() => api.getBranding(), []);

  const [form, setForm] = useState<Branding>({
    logoUrl: '',
    primaryColor: '#14C8A2',
    secondaryColor: '#17211D',
    accentColor: '#F59E0B',
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Preview-only controls — never sent to the server.
  const [previewDark, setPreviewDark] = useState(false);
  const [surface, setSurface] = useState<Surface>('booking');

  // Prefill once branding loads.
  useEffect(() => {
    if (!data) return;
    setForm({
      logoUrl: data.logoUrl ?? '',
      primaryColor: data.primaryColor,
      secondaryColor: data.secondaryColor,
      accentColor: data.accentColor,
    });
  }, [data]);

  const setColor = (key: RoleKey, v: string) =>
    setForm((f) => ({ ...f, [key]: v }));

  const colorsValid =
    HEX.test(form.primaryColor) &&
    HEX.test(form.secondaryColor) &&
    HEX.test(form.accentColor);

  const dirty = useMemo(() => {
    if (!data) return false;
    return (
      (data.logoUrl ?? '') !== (form.logoUrl ?? '') ||
      data.primaryColor !== form.primaryColor ||
      data.secondaryColor !== form.secondaryColor ||
      data.accentColor !== form.accentColor
    );
  }, [data, form]);

  const resetToDefaults = () => {
    setForm({
      logoUrl: '',
      primaryColor: DEFAULT_BRANDING.primaryColor,
      secondaryColor: DEFAULT_BRANDING.secondaryColor,
      accentColor: DEFAULT_BRANDING.accentColor,
    });
    setMsg(null);
  };

  const save = async () => {
    if (!colorsValid) {
      setMsg('Enter a valid 6-digit hex for every colour, e.g. #14C8A2.');
      return;
    }
    setSaving(true);
    setMsg(null);
    const logo = (form.logoUrl ?? '').trim();
    const payload: Branding = {
      logoUrl: logo === '' ? null : logo,
      primaryColor: form.primaryColor,
      secondaryColor: form.secondaryColor,
      accentColor: form.accentColor,
    };
    try {
      const saved = await api.updateBranding(payload);
      setBranding(saved); // Apply to the live app immediately.
      setMsg('Branding saved and applied.');
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="container">
      <PageHeader
        title="Branding"
        subtitle="Give your storefront your logo and colours. Changes go live the moment you save."
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={resetToDefaults}
            disabled={loading || saving}
          >
            <RotateCcw className="h-4 w-4" />
            Reset to default
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-5">
        {/* Controls */}
        <div className="lg:col-span-3">
          <Card title="Brand identity" topAccent="primary">
            <Msg text={error} />

            <SectionLabel icon={ImageIcon} className="mb-2">
              Logo
            </SectionLabel>
            {loading ? (
              <Skeleton className="mb-4 h-10 w-full rounded-xl" />
            ) : (
              <Field
                label="Logo URL"
                value={form.logoUrl ?? ''}
                onChange={(v) => setForm((f) => ({ ...f, logoUrl: v }))}
                placeholder="https://…/logo.png"
              />
            )}
            <p className="-mt-1 mb-5 text-xs text-muted-foreground">
              A square PNG or SVG works best. Leave blank to show a monogram from
              your venue name.
            </p>

            <SectionLabel icon={Palette} className="mb-2">
              Colour palette
            </SectionLabel>
            {loading ? (
              <div className="grid gap-3 sm:grid-cols-3">
                {ROLES.map((r) => (
                  <Skeleton key={r.key} className="h-28 rounded-xl" />
                ))}
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-3">
                {ROLES.map((r) => (
                  <ColorField
                    key={r.key}
                    label={r.label}
                    help={r.help}
                    value={form[r.key]}
                    onChange={(v) => setColor(r.key, v)}
                  />
                ))}
              </div>
            )}

            <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-border pt-4">
              <Button onClick={save} disabled={saving || loading || !colorsValid || !dirty}>
                {saving ? (
                  <>Saving…</>
                ) : (
                  <>
                    <Save className="h-4 w-4" />
                    Save branding
                  </>
                )}
              </Button>
              {!dirty && !loading && colorsValid && (
                <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Check className="h-4 w-4 text-primary" />
                  All changes saved
                </span>
              )}
              <Msg text={msg} />
            </div>
          </Card>
        </div>

        {/* Live preview */}
        <div className="lg:col-span-2">
          <Card title="Live preview" topAccent="accent">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Shown on
                </span>
                <Select value={surface} onValueChange={(v) => setSurface(v as Surface)}>
                  <SelectTrigger className="h-9 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SURFACES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <label className="flex shrink-0 cursor-pointer items-center gap-2">
                {previewDark ? (
                  <Moon className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <Sun className="h-4 w-4 text-muted-foreground" />
                )}
                <span className="text-xs font-medium text-muted-foreground">Dark</span>
                <Switch checked={previewDark} onCheckedChange={setPreviewDark} aria-label="Preview dark storefront" />
              </label>
            </div>

            {loading ? (
              <Skeleton className="h-72 w-full rounded-2xl" />
            ) : (
              <StorefrontPreview
                logoUrl={form.logoUrl ?? ''}
                primary={form.primaryColor}
                secondary={form.secondaryColor}
                accent={form.accentColor}
                dark={previewDark}
                surface={surface}
              />
            )}

            <p className="mt-3 text-xs text-muted-foreground">
              This is a sample only — your real catalogue and prices appear in the
              live storefront.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
