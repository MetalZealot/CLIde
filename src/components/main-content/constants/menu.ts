export const MENU_CLASS_NAME =
  'sidebar-context-menu min-w-56 max-w-[calc(100vw-1.25rem)] overflow-y-auto rounded-xl py-1';

// Preserve natural menu height until it would leave the viewport.
export const HEADER_MENU_CLASS_NAME = `${MENU_CLASS_NAME} max-h-[calc(100dvh-1.25rem)]`;

export const MENU_ITEM_CLASS_NAME =
  'flex min-h-11 w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-accent active:bg-accent disabled:pointer-events-none disabled:opacity-50';

export const HEADER_MENU_ITEM_CLASS_NAME =
  'flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-accent active:bg-accent disabled:pointer-events-none disabled:opacity-50';

export const HEADER_SHEET_TILE_CLASS_NAME =
  'flex min-h-16 min-w-0 flex-1 flex-col items-center justify-center gap-1.5 rounded-xl px-1 py-2 text-[11.5px] leading-tight transition-colors hover:bg-accent active:bg-accent disabled:pointer-events-none disabled:opacity-50';

// Chip surface shared with the Context & Usage panel.
export const HEADER_SHEET_HALF_CLASS_NAME =
  'flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg bg-muted/60 text-sm transition-colors hover:bg-muted active:bg-muted dark:bg-muted dark:hover:bg-muted/70 dark:active:bg-muted/70 disabled:pointer-events-none disabled:opacity-50';
