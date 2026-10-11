import { useSyncExternalStore } from 'react';
import { Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../../lib/utils';
import type { TerminalStatus } from '../utils/terminalSession';
import { tabLabel, type TerminalTab, type TerminalTabs } from '../utils/terminalTabs';

export function StatusDot({ status }: { status: TerminalStatus }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'h-[7px] w-[7px] flex-shrink-0 rounded-full',
        status === 'connected' && 'bg-green-500',
        (status === 'connecting' || status === 'reconnecting') && 'bg-amber-500 motion-safe:animate-pulse',
        (status === 'idle' || status === 'exited' || status === 'error') && 'bg-muted-foreground',
      )}
    />
  );
}

function TabChip({ tab, tabCount, fallbackShell, isActive, onSelect, onClose }: {
  tab: TerminalTab;
  tabCount: number;
  fallbackShell: string | null;
  isActive: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { status } = useSyncExternalStore(tab.session.subscribe, tab.session.getSnapshot);
  const label = tabLabel(tab, tabCount, fallbackShell);
  return (
    <div
      className={cn(
        'flex h-[30px] flex-none items-center gap-1.5 rounded-lg border pl-2.5 pr-1.5 text-[13px]',
        isActive ? 'border-border bg-popover text-foreground' : 'border-transparent text-muted-foreground',
      )}
    >
      <button type="button" onClick={onSelect} aria-pressed={isActive} className="flex items-center gap-1.5">
        <StatusDot status={status} />
        {label}
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label={t('terminal.tabs.close', { name: label })}
        className="grid h-5 w-5 place-items-center rounded opacity-60 hover:opacity-100"
      >
        <X className="h-[13px] w-[13px]" />
      </button>
    </div>
  );
}

/** Shown only with two or more terminals; one terminal needs no row. */
export default function TerminalTabStrip({ store, tabs, active, activeShell, onClose }: {
  store: TerminalTabs;
  tabs: TerminalTab[];
  active: TerminalTab;
  /** Names tabs not yet started, which have not reported their shell. */
  activeShell: string | null;
  onClose: (tab: TerminalTab) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="flex flex-shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-card px-1.5 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      // Keeps the soft keyboard up when switching tabs.
      onMouseDown={(event) => event.preventDefault()}
    >
      {tabs.map((tab) => (
        <TabChip
          key={tab.n}
          tab={tab}
          tabCount={tabs.length}
          fallbackShell={activeShell}
          isActive={tab === active}
          onSelect={() => store.select(tab)}
          onClose={() => onClose(tab)}
        />
      ))}
      <button
        type="button"
        onClick={() => store.add()}
        aria-label={t('terminal.actions.new')}
        className="grid h-[30px] w-[30px] flex-none place-items-center rounded-lg text-muted-foreground hover:text-foreground"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}
