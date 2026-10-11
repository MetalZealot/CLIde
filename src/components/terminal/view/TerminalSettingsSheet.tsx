import { useSyncExternalStore, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import BottomSheet from '../../../shared/view/ui/BottomSheet';
import { cn } from '../../../lib/utils';
import {
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  terminalPrefs,
  type TerminalCursorStyle,
} from '../utils/terminalPrefs';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border text-sm last:border-b-0">
      <span>{label}</span>
      <div className="flex gap-1">{children}</div>
    </div>
  );
}

function Choice({ pressed, onClick, disabled, label, children }: {
  pressed?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  label?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      aria-label={label}
      className={cn(
        'h-8 min-w-10 rounded-lg border px-2.5 text-[13px] disabled:opacity-40',
        pressed ? 'border-primary text-primary' : 'border-border',
      )}
    >
      {children}
    </button>
  );
}

const CURSORS: Array<{ value: TerminalCursorStyle; labelKey: string }> = [
  { value: 'block', labelKey: 'terminal.settings.cursorBlock' },
  { value: 'bar', labelKey: 'terminal.settings.cursorBar' },
  { value: 'underline', labelKey: 'terminal.settings.cursorUnderline' },
];

/** Per-device preferences for every terminal; changes apply as they are picked. */
export default function TerminalSettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const prefs = useSyncExternalStore(terminalPrefs.subscribe, terminalPrefs.get);

  return (
    <BottomSheet open={open} onClose={onClose} title={t('terminal.settings.title')}>
      <div className="px-4 pb-4 pt-1">
        <h3 className="mb-2.5 mt-1 text-base font-semibold">{t('terminal.settings.title')}</h3>
        <Row label={t('terminal.settings.fontSize')}>
          <Choice
            label={t('terminal.settings.smaller')}
            disabled={prefs.fontSize <= MIN_FONT_SIZE}
            onClick={() => terminalPrefs.set({ fontSize: prefs.fontSize - 1 })}
          >
            A−
          </Choice>
          <span className="grid h-8 min-w-10 place-items-center rounded-lg border border-border px-2.5 text-[13px] tabular-nums text-muted-foreground">
            {prefs.fontSize}
          </span>
          <Choice
            label={t('terminal.settings.larger')}
            disabled={prefs.fontSize >= MAX_FONT_SIZE}
            onClick={() => terminalPrefs.set({ fontSize: prefs.fontSize + 1 })}
          >
            A+
          </Choice>
        </Row>
        <Row label={t('terminal.settings.cursor')}>
          {CURSORS.map(({ value, labelKey }) => (
            <Choice
              key={value}
              pressed={prefs.cursorStyle === value}
              onClick={() => terminalPrefs.set({ cursorStyle: value })}
            >
              {t(labelKey)}
            </Choice>
          ))}
        </Row>
        <Row label={t('terminal.settings.copyOnSelect')}>
          <Choice pressed={!prefs.copyOnSelect} onClick={() => terminalPrefs.set({ copyOnSelect: false })}>
            {t('terminal.settings.off')}
          </Choice>
          <Choice pressed={prefs.copyOnSelect} onClick={() => terminalPrefs.set({ copyOnSelect: true })}>
            {t('terminal.settings.on')}
          </Choice>
        </Row>
      </div>
    </BottomSheet>
  );
}
