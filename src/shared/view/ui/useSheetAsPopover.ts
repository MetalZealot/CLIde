import { useDeviceSettings } from '../../../hooks/useDeviceSettings';

/** Sheets are a touch idiom; wider than a phone they render as anchored popovers. */
export function useSheetAsPopover() {
  return !useDeviceSettings({ trackPWA: false }).isMobile;
}
