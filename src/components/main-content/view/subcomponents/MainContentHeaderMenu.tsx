import { EllipsisVertical, Settings as SettingsIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { ContextMenuOverlay, MENU_LIST_MAX_HEIGHT, anchorFromElement } from '../../../../shared/view/ui';
import { cn } from '../../../../lib/utils';
import { useHeaderMenuSection } from '../../../../contexts/HeaderMenuContext';
import { MENU_CLASS_NAME, MENU_ITEM_CLASS_NAME } from '../../constants/menu';
import { useMenuButton } from '../../hooks/useMenuButton';

type MainContentHeaderMenuProps = {
  onShowSettings: (tab?: string) => void;
};

/** The header's action menu: the visible view's own actions, then app-wide ones. */
export default function MainContentHeaderMenu({ onShowSettings }: MainContentHeaderMenuProps) {
  const { t } = useTranslation();
  const section = useHeaderMenuSection();
  const { buttonRef, firstItemRef, isOpen, toggle, close } = useMenuButton();
  const items = section?.items ?? [];
  const firstEnabledIndex = items.findIndex((item) => !item.disabled);

  const run = (onSelect: () => void) => {
    close();
    onSelect();
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={t('mainContent.moreOptions')}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={toggle}
        className={cn(
          'flex h-11 w-11 flex-shrink-0 touch-manipulation items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground',
          isOpen && 'bg-accent/60 text-foreground',
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
              <button
                key={item.key}
                ref={index === firstEnabledIndex ? firstItemRef : undefined}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => run(item.onSelect)}
                className={cn(MENU_ITEM_CLASS_NAME, item.isDanger && 'text-red-600 dark:text-red-400')}
              >
                <Icon className={cn('h-4 w-4 flex-shrink-0', !item.isDanger && 'text-muted-foreground')} aria-hidden="true" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}

          {items.length > 0 && <div role="separator" className="my-1 border-t border-border" />}

          <button
            ref={firstEnabledIndex === -1 ? firstItemRef : undefined}
            type="button"
            role="menuitem"
            onClick={() => run(() => onShowSettings())}
            className={MENU_ITEM_CLASS_NAME}
          >
            <SettingsIcon className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>{t('navigation.settings')}</span>
          </button>
        </ContextMenuOverlay>
      )}
    </>
  );
}
