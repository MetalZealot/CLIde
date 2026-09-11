import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { EllipsisVertical } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { ContextMenuOverlay, MENU_LIST_MAX_HEIGHT, anchorFromElement } from '../../../../shared/view/ui';
import { cn } from '../../../../lib/utils';
import { useHeaderMenuSection, type HeaderMenuItem } from '../../../../contexts/HeaderMenuContext';
import { MENU_CLASS_NAME, MENU_ITEM_CLASS_NAME } from '../../constants/menu';
import { useMenuButton } from '../../hooks/useMenuButton';

/** The header's action menu: the visible view's own actions. Absent on a view that has none. */
export default function MainContentHeaderMenu() {
  const { t } = useTranslation();
  const section = useHeaderMenuSection();
  const { buttonRef, firstItemRef, isOpen, toggle, close } = useMenuButton();
  const [panelKey, setPanelKey] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const items = section?.items ?? [];
  const firstEnabledIndex = items.findIndex((item) => !item.disabled);
  // Gone with the section that offered it, e.g. once another view is visible.
  const panelItem = panelKey ? items.find((item) => item.key === panelKey && item.renderPanel) : undefined;

  const run = (item: HeaderMenuItem) => {
    close();
    if (item.renderPanel) {
      setPanelKey(item.key);
    } else {
      item.onSelect();
    }
  };

  const closePanel = useCallback(() => {
    setPanelKey(null);
    buttonRef.current?.focus();
  }, [buttonRef]);

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
    return null;
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={t('mainContent.moreOptions')}
        aria-haspopup="menu"
        aria-expanded={isOpen || hasPanel}
        onClick={toggle}
        className={cn(
          'flex h-11 w-11 flex-shrink-0 touch-manipulation items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground',
          (isOpen || hasPanel) && 'bg-accent/60 text-foreground',
        )}
      >
        <EllipsisVertical className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
      </button>

      {isOpen && buttonRef.current && (
        <ContextMenuOverlay
          anchor={anchorFromElement(buttonRef.current, { x: 0, y: 0 })}
          anchorElement={buttonRef.current}
          onDismiss={close}
          ariaLabel={t('mainContent.moreOptions')}
          maxHeight={MENU_LIST_MAX_HEIGHT}
          className={MENU_CLASS_NAME}
          measureKey={`${items.length}:${section?.status?.text ?? ''}`}
        >
          {section?.status && (
            <div
              role="menuitem"
              aria-disabled="true"
              tabIndex={-1}
              className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground"
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
                {item.showDividerBefore && index > 0 && <div role="separator" className="my-1 border-t border-border" />}
                <button
                  ref={index === firstEnabledIndex ? firstItemRef : undefined}
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  aria-haspopup={item.renderPanel ? 'dialog' : undefined}
                  onClick={() => run(item)}
                  className={cn(MENU_ITEM_CLASS_NAME, item.isDanger && 'text-red-600 dark:text-red-400')}
                >
                  <Icon className={cn('h-4 w-4 flex-shrink-0', !item.isDanger && 'text-muted-foreground')} aria-hidden="true" />
                  <span className="truncate">{item.label}</span>
                </button>
              </Fragment>
            );
          })}
        </ContextMenuOverlay>
      )}

      {panelItem?.renderPanel && buttonRef.current && (
        <ContextMenuOverlay
          role="dialog"
          anchor={anchorFromElement(buttonRef.current, { x: 0, y: 0 })}
          anchorElement={buttonRef.current}
          onDismiss={closePanel}
          ariaLabel={panelItem.label}
          maxHeight={MENU_LIST_MAX_HEIGHT}
          className={MENU_CLASS_NAME}
          measureKey={panelItem.key}
        >
          <div ref={panelRef}>{panelItem.renderPanel(closePanel)}</div>
        </ContextMenuOverlay>
      )}
    </>
  );
}
