import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Pencil } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { ContextMenuOverlay, anchorFromElement } from '../../../../shared/view/ui';
import { cn } from '../../../../lib/utils';
import { useHeaderMenuSection, type HeaderMenuItem } from '../../../../contexts/HeaderMenuContext';
import { useHeaderSheet } from '../../../../contexts/HeaderSheetContext';
import { copyTextToClipboard } from '../../../../utils/clipboard';
import { HEADER_MENU_CLASS_NAME, HEADER_MENU_ITEM_CLASS_NAME } from '../../constants/menu';
import { useMenuButton } from '../../hooks/useMenuButton';

const TITLE_CLASS_NAME = 'max-w-[min(20rem,calc(100vw-2rem))] whitespace-normal break-words px-4 pb-2.5 pt-2 text-sm font-semibold leading-snug text-foreground';

/** The menu's first line: the whole title, which renames the session in place when the view allows it. */
function MenuTitle({ title, rename, isWide = false }: { title: string; rename?: { name: string; submit: (name: string) => void } | null; isWide?: boolean }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<string | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  // Enter or Escape settles the edit; the blur that follows as the field unmounts must not settle it again.
  const settledRef = useRef(false);
  const isEditing = draft !== null;

  // Grows with the text, so a long title wraps instead of scrolling sideways.
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${field.scrollHeight}px`;
  }, [draft]);

  useEffect(() => {
    if (isEditing) fieldRef.current?.select();
  }, [isEditing]);

  if (!rename) {
    return <div role="menuitem" aria-disabled="true" tabIndex={-1} className={cn(TITLE_CLASS_NAME, 'border-b border-border', isWide && 'max-w-none')}>{title}</div>;
  }

  const startEditing = () => {
    settledRef.current = false;
    setDraft(rename.name || title);
  };
  const cancel = () => {
    settledRef.current = true;
    setDraft(null);
  };
  const commit = () => {
    if (draft === null || settledRef.current) return;
    settledRef.current = true;
    const next = draft.trim();
    setDraft(null);
    // An emptied field keeps the old name.
    if (next && next !== rename.name) rename.submit(next);
  };

  if (isEditing) {
    return (
      <div className="border-b border-border px-2.5 py-1.5">
        <textarea
          ref={fieldRef}
          autoFocus
          rows={1}
          value={draft}
          aria-label={t('mainContent.editTitle')}
          // A title is one line; a pasted line break becomes a space.
          onChange={(event) => setDraft(event.target.value.replace(/\s*\n\s*/g, ' '))}
          onKeyDown={(event) => {
            // The menu's own arrow and Escape handling would act on the whole menu.
            event.stopPropagation();
            if (event.key === 'Enter') {
              event.preventDefault();
              commit();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              cancel();
            }
          }}
          onBlur={commit}
          className="block w-[min(20rem,calc(100vw-2rem))] max-w-full resize-none overflow-hidden rounded-md border border-border bg-background px-1.5 py-1 text-sm font-semibold leading-snug text-foreground outline-none focus:border-primary"
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      role="menuitem"
      data-menu-title
      aria-label={`${title}, ${t('mainContent.editTitle')}`}
      onClick={startEditing}
      className={cn(TITLE_CLASS_NAME, 'flex w-full items-start gap-2 border-b border-border text-left transition-colors hover:bg-accent active:bg-accent', isWide && 'max-w-none')}
    >
      <span className="min-w-0 flex-1">{title}</span>
      <Pencil className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  );
}

type MainContentHeaderMenuProps = {
  /** The header title, which opens the menu; shown as is on a view with no actions. */
  children: ReactNode;
  /** The untruncated title, first in the menu. */
  fullTitle?: string;
};

/** The header's action menu, opened from the title: the visible view's own actions. */
export default function MainContentHeaderMenu({ children, fullTitle }: MainContentHeaderMenuProps) {
  const { t } = useTranslation();
  const section = useHeaderMenuSection();
  const { buttonRef, firstItemRef, isOpen, toggle, close } = useMenuButton();
  const [panelKey, setPanelKey] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const items = section?.items ?? [];
  const firstEnabledIndex = items.findIndex((item) => !item.disabled);
  // Gone with the section that offered it, e.g. once another view is visible.
  const panelItem = panelKey ? items.find((item) => item.key === panelKey && item.renderPanel) : undefined;

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copiedTimerRef = useRef<number | null>(null);
  const sessionIds = section?.sessionIds;
  const providerLabel = sessionIds?.provider
    ? t(`actions.providerNames.${sessionIds.provider}`, { ns: 'sidebar', defaultValue: sessionIds.provider })
    : '';
  // One entry when the provider's id is unknown or is the app id.
  const sessionIdEntries = !sessionIds
    ? []
    : sessionIds.providerId && sessionIds.providerId !== sessionIds.appId
      ? [
          { label: 'CLIde', value: sessionIds.appId },
          { label: providerLabel, value: sessionIds.providerId },
        ]
      : [{ label: sessionIds.providerId ? `CLIde · ${providerLabel}` : 'CLIde', value: sessionIds.appId }];

  const copyId = (value: string) => {
    void copyTextToClipboard(value).then((ok) => {
      if (!ok) {
        return;
      }
      setCopiedId(value);
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
      }
      copiedTimerRef.current = window.setTimeout(() => setCopiedId(null), 1500);
    });
  };

  useEffect(() => () => {
    if (copiedTimerRef.current !== null) {
      window.clearTimeout(copiedTimerRef.current);
    }
  }, []);

  const closeMenuAndPanel = useCallback(() => {
    close();
    setPanelKey(null);
  }, [close]);
  const sheet = useHeaderSheet('menu', isOpen || Boolean(panelItem), closeMenuAndPanel, t('mainContent.moreOptions'));

  const run = (item: HeaderMenuItem) => {
    if (item.renderPanel) {
      close();
      setPanelKey(item.key);
    } else if (sheet.inSheet) {
      // After the sheet has gone, so a dialog the action opens isn't under it.
      sheet.close(item.onSelect);
    } else {
      close();
      item.onSelect();
    }
  };

  const closeDesktopPanel = useCallback(() => {
    setPanelKey(null);
    buttonRef.current?.focus();
  }, [buttonRef]);
  const closePanel = sheet.inSheet ? sheet.close : closeDesktopPanel;

  const hasPanel = Boolean(panelItem);
  const hasActions = items.length > 0 || Boolean(section?.status);
  // Otherwise it would reopen when that view comes back.
  useEffect(() => {
    if (panelKey && !hasPanel) {
      setPanelKey(null);
    }
  }, [panelKey, hasPanel]);

  useEffect(() => {
    if (isOpen && !hasActions) {
      close();
    }
  }, [isOpen, hasActions, close]);

  useEffect(() => {
    if (!hasPanel) {
      return undefined;
    }
    const frame = window.requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLElement>('input:not([disabled]), button:not([disabled])')?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [hasPanel]);

  if (!hasActions) {
    return <>{children}</>;
  }

  const renderMenuBody = (isWide: boolean) => (
    <>
      {fullTitle && <MenuTitle title={fullTitle} rename={section?.rename} isWide={isWide} />}

      {section?.status && (
        <div
          role="menuitem"
          aria-disabled="true"
          tabIndex={-1}
          className="flex min-h-10 items-center gap-3 px-4 py-2.5 text-xs text-muted-foreground"
        >
          <span
            aria-hidden="true"
            className={cn('h-2 w-2 flex-shrink-0 rounded-full', section.status.isOk ? 'bg-green-500' : 'bg-red-500')}
          />
          <span className="truncate">{section.status.text}</span>
        </div>
      )}

      {items.map((item, index) => {
        const Icon = item.icon;
        return (
          <Fragment key={item.key}>
            {item.showDividerBefore && index > 0 && (
              <div role="separator" className="mx-2 my-1 h-px bg-border" />
            )}
            <button
              ref={index === firstEnabledIndex ? firstItemRef : undefined}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              aria-haspopup={item.renderPanel ? 'dialog' : undefined}
              onClick={() => run(item)}
              className={cn(HEADER_MENU_ITEM_CLASS_NAME, item.isDanger && 'text-red-600 dark:text-red-400')}
            >
              <Icon className={cn('h-4 w-4 flex-shrink-0', !item.isDanger && 'text-muted-foreground')} aria-hidden="true" />
              <span className="truncate">{item.label}</span>
            </button>
          </Fragment>
        );
      })}

      {sessionIdEntries.length > 0 && (
        <>
          <div role="separator" className="mx-2 my-1 h-px bg-border" />
          {/* Zero intrinsic width: the actions set the menu's width and the ids truncate to it. */}
          <div className="flex w-0 min-w-full">
            {sessionIdEntries.map((entry) => (
              <button
                key={entry.label}
                type="button"
                role="menuitem"
                aria-label={t('mainContent.copySessionId', { label: entry.label })}
                onClick={() => copyId(entry.value)}
                className="flex min-h-10 min-w-0 flex-1 flex-col items-start justify-center px-4 py-1 text-left transition-colors hover:bg-accent active:bg-accent"
              >
                <span className="text-[11px] leading-4 text-muted-foreground">{entry.label}</span>
                {copiedId === entry.value ? (
                  <span className="text-xs leading-4 text-foreground">{t('mainContent.sessionIdCopied')}</span>
                ) : (
                  <span className="w-full truncate font-mono text-xs leading-4 text-foreground/80">{entry.value}</span>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );

  return (
    <>
      <button
        ref={buttonRef}
        data-main-content-header-menu-trigger
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen || hasPanel}
        onClick={(event) => (sheet.inSheet && (isOpen || hasPanel) ? sheet.close() : toggle(event))}
        className={cn(
          'touch-menu-trigger -ml-1.5 flex h-11 min-w-0 flex-1 touch-manipulation items-center rounded-lg px-1.5 text-left transition-colors hover:bg-accent/60',
          (isOpen || hasPanel) && 'bg-accent/60',
        )}
      >
        {children}
      </button>

      {sheet.inSheet && sheet.target && createPortal(
        panelItem?.renderPanel ? (
          <div ref={panelRef} role="dialog" aria-label={panelItem.label} className="py-1">
            {panelItem.renderPanel(closePanel)}
          </div>
        ) : (
          <div role="menu" aria-label={t('mainContent.moreOptions')} className="py-1">
            {renderMenuBody(true)}
          </div>
        ),
        sheet.target,
      )}

      {!sheet.inSheet && isOpen && buttonRef.current && (
        <ContextMenuOverlay
          anchor={anchorFromElement(buttonRef.current, { x: 0, y: 0 })}
          anchorElement={buttonRef.current}
          onDismiss={close}
          ariaLabel={t('mainContent.moreOptions')}
          className={HEADER_MENU_CLASS_NAME}
          measureKey={`${items.length}:${section?.status?.text ?? ''}:${sessionIdEntries.length}:${fullTitle ?? ''}`}
        >
          {renderMenuBody(false)}
        </ContextMenuOverlay>
      )}

      {!sheet.inSheet && panelItem?.renderPanel && buttonRef.current && (
        <ContextMenuOverlay
          role="dialog"
          anchor={anchorFromElement(buttonRef.current, { x: 0, y: 0 })}
          anchorElement={buttonRef.current}
          onDismiss={closePanel}
          ariaLabel={panelItem.label}
          className={HEADER_MENU_CLASS_NAME}
          measureKey={panelItem.key}
        >
          <div ref={panelRef}>{panelItem.renderPanel(closePanel)}</div>
        </ContextMenuOverlay>
      )}
    </>
  );
}
