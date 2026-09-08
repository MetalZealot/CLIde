// Temporary variant harness. Deleted when one direction is promoted.
// Deliberately outside the design system: no project tokens, no theme.
import { useCallback, useEffect, useState } from 'react';

export const VARIANTS = ['filled', 'ledger', 'roll'] as const;
export type VariantName = (typeof VARIANTS)[number];

const LABELS: Record<VariantName, string> = {
  filled: 'Filled',
  ledger: 'Ledger',
  roll: 'Roll',
};

const STORE_KEY = 'clide-browser-variant';

function coerce(value: string | null): VariantName | null {
  return (VARIANTS as readonly string[]).includes(value || '') ? (value as VariantName) : null;
}

// The app rewrites its own URL on load, so latch the param at module scope
// before that happens and keep it for the session. The link still selects.
const latched = coerce(new URLSearchParams(window.location.search).get('variant'));
if (latched) sessionStorage.setItem(STORE_KEY, latched);

function readVariant(): VariantName | null {
  return latched || coerce(sessionStorage.getItem(STORE_KEY));
}

export function useVariant(): [VariantName | null, (next: VariantName) => void] {
  const [variant, setVariant] = useState<VariantName | null>(readVariant);

  useEffect(() => {
    const sync = () => setVariant(readVariant());
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  const select = useCallback((next: VariantName) => {
    sessionStorage.setItem(STORE_KEY, next);
    const url = new URL(window.location.href);
    url.searchParams.set('variant', next);
    window.history.replaceState({}, '', url);
    setVariant(next);
  }, []);

  return [variant, select];
}

export function VariantPicker({ active, onSelect }: { active: VariantName; onSelect: (v: VariantName) => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const index = VARIANTS.indexOf(active);
      if (event.key === 'ArrowRight') onSelect(VARIANTS[(index + 1) % VARIANTS.length]);
      if (event.key === 'ArrowLeft') onSelect(VARIANTS[(index - 1 + VARIANTS.length) % VARIANTS.length]);
      const digit = Number(event.key);
      if (Number.isInteger(digit) && digit >= 1 && digit <= VARIANTS.length) onSelect(VARIANTS[digit - 1]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, onSelect]);

  return (
    <nav
      aria-label="Variants"
      style={{
        position: 'fixed',
        top: 8,
        left: '50%',
        translate: '-50% 0',
        zIndex: 2147483647,
        display: 'flex',
        gap: 2,
        padding: 4,
        borderRadius: 999,
        background: 'rgb(20 20 20 / 0.9)',
        boxShadow: 'inset 0 0 0 1px rgb(255 255 255 / 0.1), 0 8px 24px rgb(0 0 0 / 0.25)',
        font: '13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        userSelect: 'none',
      }}
    >
      {VARIANTS.map((name) => (
        <button
          key={name}
          type="button"
          data-variant={name}
          aria-current={name === active ? 'true' : undefined}
          onClick={() => onSelect(name)}
          style={{
            padding: '7px 14px',
            border: 0,
            borderRadius: 999,
            background: name === active ? 'rgb(255 255 255 / 0.14)' : 'none',
            color: name === active ? 'rgb(255 255 255)' : 'rgb(255 255 255 / 0.6)',
            cursor: 'pointer',
          }}
        >
          {LABELS[name]}
        </button>
      ))}
    </nav>
  );
}
