/**
 * How tall a menu's data-driven list grows before it scrolls: seven and a half
 * standard rows.
 *
 * A cap in rows rather than viewport fraction, because `65vh` shows eight items
 * on one device and fourteen on another. Whatever a surface's own row height is,
 * this lands mid-row, and that clipped row is the only honest signal the list
 * continues — a list cut flush at a row boundary reads as the whole list.
 *
 * Fixed action menus stay uncapped: they are short by construction, and a cap
 * they cannot reach only risks clipping their last row.
 */
export const MENU_LIST_MAX_HEIGHT = 330;

/**
 * The same idea for a reading surface (the usage popover), which is prose and
 * sections rather than rows and needs more room before scrolling.
 */
export const READING_SURFACE_MAX_HEIGHT = 416;
