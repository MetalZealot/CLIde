import { cn } from '../../../lib/utils';

type AccountAvatarProps = {
  /** A small square image data URL, or null/undefined for the initial fallback. */
  avatar?: string | null;
  username: string;
  /** Any square sizing classes; the caller owns the scale. */
  className?: string;
};

/**
 * The account picture wherever it appears — the sidebar footer button and the
 * Account screen both render this, so an account with no picture never falls
 * back to two different placeholders.
 *
 * The fallback is the first character of the username rather than a generic
 * person glyph: in a single-user app a generic glyph carries no information,
 * whereas an initial at least distinguishes one install from another when the
 * user is looking at screenshots.
 */
export default function AccountAvatar({ avatar, username, className }: AccountAvatarProps) {
  const initial = username.trim().charAt(0).toUpperCase() || '?';

  return (
    <span
      className={cn(
        'flex flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-muted-foreground',
        className,
      )}
    >
      {avatar ? (
        <img src={avatar} alt="" className="h-full w-full object-cover" />
      ) : (
        <span aria-hidden className="font-medium leading-none">{initial}</span>
      )}
    </span>
  );
}
