import type { PointerEvent, ReactNode } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Clipboard, Keyboard } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../../lib/utils';
import type { TerminalSession, TerminalSnapshot } from '../utils/terminalSession';

type Key =
  | { id: string; label: ReactNode; labelKey?: string; sequence: string }
  | { id: 'ctrl' | 'alt'; label: string; labelKey: string; modifier: 'ctrl' | 'alt' }
  | { id: 'keyboard' | 'paste'; label: ReactNode; labelKey: string; action: 'keyboard' | 'paste' };

const ICON = 'h-4 w-4';

const PINNED_KEYS: Key[] = [
  { id: 'ctrl', label: 'CTRL', labelKey: 'terminal.keys.ctrl', modifier: 'ctrl' },
  { id: 'esc', label: 'ESC', sequence: '\x1b' },
  { id: 'tab', label: 'TAB', sequence: '\t' },
];

const SCROLLING_KEYS: Key[] = [
  { id: 'keyboard', label: <Keyboard className={ICON} />, labelKey: 'terminal.keys.keyboard', action: 'keyboard' },
  { id: 'paste', label: <Clipboard className={ICON} />, labelKey: 'terminal.keys.paste', action: 'paste' },
  { id: 'alt', label: 'ALT', labelKey: 'terminal.keys.alt', modifier: 'alt' },
  { id: 'ctrl-c', label: '^C', labelKey: 'terminal.keys.interrupt', sequence: '\x03' },
  { id: 'ctrl-d', label: '^D', labelKey: 'terminal.keys.endOfInput', sequence: '\x04' },
  { id: 'ctrl-z', label: '^Z', labelKey: 'terminal.keys.suspend', sequence: '\x1a' },
  { id: 'up', label: <ArrowUp className={ICON} />, labelKey: 'terminal.keys.up', sequence: '\x1b[A' },
  { id: 'down', label: <ArrowDown className={ICON} />, labelKey: 'terminal.keys.down', sequence: '\x1b[B' },
  { id: 'left', label: <ArrowLeft className={ICON} />, labelKey: 'terminal.keys.left', sequence: '\x1b[D' },
  { id: 'right', label: <ArrowRight className={ICON} />, labelKey: 'terminal.keys.right', sequence: '\x1b[C' },
  { id: 'home', label: 'HOME', sequence: '\x1b[H' },
  { id: 'end', label: 'END', sequence: '\x1b[F' },
  { id: 'pgup', label: 'PGUP', sequence: '\x1b[5~' },
  { id: 'pgdn', label: 'PGDN', sequence: '\x1b[6~' },
  { id: 'pipe', label: '|', sequence: '|' },
  { id: 'tilde', label: '~', sequence: '~' },
  { id: 'slash', label: '/', sequence: '/' },
  { id: 'dash', label: '-', sequence: '-' },
  { id: 'underscore', label: '_', sequence: '_' },
];

// Keeps focus (and the soft keyboard) in the terminal while a key is tapped.
const keepFocus = (event: PointerEvent) => event.preventDefault();

type TerminalKeyBarProps = {
  session: TerminalSession;
  snapshot: TerminalSnapshot;
  onPasteBlocked: () => void;
};

/** The phone's missing terminal keys: Ctrl, Esc and Tab stay put; the rest swipe sideways. */
export default function TerminalKeyBar({ session, snapshot, onPasteBlocked }: TerminalKeyBarProps) {
  const { t } = useTranslation();
  const disabled = snapshot.status !== 'connected';

  const press = (key: Key) => {
    if ('modifier' in key) {
      session.toggleModifier(key.modifier);
    } else if ('action' in key) {
      if (key.action === 'keyboard') {
        session.focus();
      } else {
        void session.paste().then((ok) => {
          if (!ok) onPasteBlocked();
        });
      }
    } else {
      session.sendKey(key.sequence);
    }
  };

  const renderKey = (key: Key) => {
    const isArmed = 'modifier' in key && (key.modifier === 'ctrl' ? snapshot.pendingCtrl : snapshot.pendingAlt);
    const name = key.labelKey ? t(key.labelKey) : typeof key.label === 'string' ? key.label : key.id;
    return (
      <button
        key={key.id}
        type="button"
        onPointerDown={keepFocus}
        onClick={() => press(key)}
        disabled={disabled}
        aria-label={name}
        title={name}
        aria-pressed={'modifier' in key ? isArmed : undefined}
        className={cn(
          'grid h-9 min-w-10 flex-shrink-0 touch-manipulation select-none place-items-center rounded-md border px-2 font-mono text-xs font-semibold transition-colors disabled:opacity-40',
          isArmed
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-border bg-background text-foreground active:bg-accent',
        )}
      >
        {key.label}
      </button>
    );
  };

  return (
    <div className="flex flex-shrink-0 items-center gap-1 border-t border-border bg-card px-1 py-1.5">
      <div className="flex flex-shrink-0 gap-1 border-r border-border pr-1">
        {PINNED_KEYS.map(renderKey)}
      </div>
      <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {SCROLLING_KEYS.map(renderKey)}
      </div>
    </div>
  );
}
