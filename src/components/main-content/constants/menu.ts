export const MENU_CLASS_NAME =
  'sidebar-context-menu min-w-56 max-w-[calc(100vw-1.25rem)] overflow-y-auto rounded-xl py-1';

// Preserve natural menu height until it would leave the viewport.
export const HEADER_MENU_CLASS_NAME = `${MENU_CLASS_NAME} max-h-[calc(100dvh-1.25rem)]`;

export const MENU_ITEM_CLASS_NAME =
  'flex min-h-11 w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-accent active:bg-accent disabled:pointer-events-none disabled:opacity-50';

export const HEADER_MENU_ITEM_CLASS_NAME =
  'flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-accent active:bg-accent disabled:pointer-events-none disabled:opacity-50';
