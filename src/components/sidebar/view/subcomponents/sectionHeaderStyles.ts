import { cn } from '../../../../lib/utils';

/**
 * The one set of metrics every sidebar section label uses.
 *
 * Its own module rather than a second export from `SidebarSectionHeader` so
 * that file stays component-only and keeps Fast Refresh during HMR work.
 *
 * Shared because the Projects label is a menu button rather than a section
 * toggle (`SidebarProjectPicker`) and so cannot render through the component.
 * It previously carried its own `min-h-11`, which made the same visual element
 * 44px tall next to Pinned's 16px — the headers read as inconsistent because
 * they were, and none of the three matched.
 *
 * The padding is deliberately asymmetric: a label an equal distance from the
 * block above and the block below binds to neither. Anything placed in the
 * `summary` slot must not grow this box, or that header alone gains centred
 * padding the others lack.
 */
export const SIDEBAR_SECTION_HEADER_CLASS = cn(
  'flex w-full items-center gap-1.5 px-3 pb-0.5 pt-3 md:px-2 md:pb-0 md:pt-2',
  'text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70',
);
