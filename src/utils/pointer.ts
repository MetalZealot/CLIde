// Coarse primary pointer = phones/tablets (including the installed PWA), where
// the soft keyboard's Enter should insert a newline rather than send. Evaluated
// per call; callers that need a stable value should memoize at mount.
export const isTouchPrimaryDevice = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(pointer: coarse)').matches;
