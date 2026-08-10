import { Ban, Check } from 'lucide-react';
import type { TFunction } from 'i18next';

import { cn } from '../../../../lib/utils';
import { ContextMenuOverlay, type ContextMenuAnchor } from '../../../../shared/view/ui';
import {
  PROJECT_ACCENT_COLORS,
  projectAccentColorValue,
  type ProjectAccentColor,
} from '../../utils/accentColors';

type SidebarAccentColorMenuProps = {
  anchor: ContextMenuAnchor;
  /** The colour currently saved for the row, or null when it has none. */
  accentColor: ProjectAccentColor | null;
  onSelect: (accentColor: ProjectAccentColor | null) => void;
  onClose: () => void;
  t: TFunction;
};

/**
 * The highlight-colour picker, opened from Customize in a project's menu.
 *
 * A grid of fixed swatches rather than a colour input: each is a palette token
 * with a value per theme, so a project reads the same weight in light and dark
 * (see `utils/accentColors.ts`). It reuses `ContextMenuOverlay` so it anchors,
 * dismisses, and freezes the list exactly like the menu it opens from.
 *
 * Picking applies immediately and closes — the strip is right there behind the
 * menu, so a separate confirm step would only delay seeing the result.
 */
export default function SidebarAccentColorMenu({
  anchor,
  accentColor,
  onSelect,
  onClose,
  t,
}: SidebarAccentColorMenuProps) {
  const chooseAccentColor = (nextAccentColor: ProjectAccentColor | null) => {
    onSelect(nextAccentColor);
    onClose();
  };

  return (
    <ContextMenuOverlay
      anchor={anchor}
      onDismiss={onClose}
      ariaLabel={t('projects.customizeColor', 'Highlight colour')}
      className="sidebar-context-menu w-56 rounded-xl p-3"
      measureKey="accent-colors"
    >
      <div className="mb-2 px-0.5 text-xs font-medium text-muted-foreground">
        {t('projects.customizeColor', 'Highlight colour')}
      </div>

      <div className="grid grid-cols-4 gap-2">
        {PROJECT_ACCENT_COLORS.map((paletteColor) => {
          const isSelected = paletteColor === accentColor;
          return (
            <button
              key={paletteColor}
              type="button"
              role="menuitemradio"
              aria-checked={isSelected}
              aria-label={paletteColor}
              title={paletteColor}
              onClick={() => chooseAccentColor(paletteColor)}
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-lg transition-transform duration-150 active:scale-90',
                // The ring reads against the popover, not the swatch, so a
                // selected dark colour is still visibly selected.
                isSelected && 'ring-2 ring-foreground/70 ring-offset-2 ring-offset-popover',
              )}
              style={{ backgroundColor: projectAccentColorValue(paletteColor) }}
            >
              {isSelected && <Check className="h-4 w-4 text-white drop-shadow" />}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        role="menuitem"
        onClick={() => chooseAccentColor(null)}
        className={cn(
          'mt-3 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm transition-colors',
          accentColor === null
            ? 'bg-accent text-foreground'
            : 'text-muted-foreground hover:bg-accent hover:text-foreground',
        )}
      >
        <Ban className="h-4 w-4 flex-shrink-0" />
        <span>{t('projects.customizeColorNone', 'No highlight')}</span>
      </button>
    </ContextMenuOverlay>
  );
}
