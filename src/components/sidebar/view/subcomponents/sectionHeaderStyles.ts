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
 * `summary` slot must not grow this box (see the `-my-1` on the Sessions
 * controls), or that header alone gains centred padding the others lack.
 */
export const SIDEBAR_SECTION_HEADER_CLASS = cn(
  'flex w-full items-center gap-1.5 px-3 pb-0.5 pt-3 md:px-2 md:pb-0 md:pt-2',
  'text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70',
);

/**
 * The Sessions label is not a peer of Pinned and Projects: it belongs to the
 * repository row directly above it, and shares that row's sticky wrapper. So it
 * takes almost no space above — the separation it needs is from the list below,
 * not from its own parent — and indents to the project title's text edge
 * (`mx-3` + `px-3` on mobile, `px-3` on desktop) so it reads as part of that
 * row's block. Given the full `pt-3` it stood off from the project and looked
 * like a section of its own.
 */
export const NESTED_SECTION_HEADER_CLASS = cn(
  SIDEBAR_SECTION_HEADER_CLASS,
  'pb-0.5 pl-6 pr-3 pt-0.5 md:pb-0 md:pl-3 md:pr-2 md:pt-0.5',
);
