import type { BrowserToolObservation } from '@/shared/types.js';

// The endpoint reads only Playwright's metadata sections, never snapshot contents.
export function observeBrowserResult(tool: string, ok: boolean, result: any): BrowserToolObservation {
  const observation: BrowserToolObservation = { tool, ok };
  for (const item of result?.content ?? []) {
    if (item?.type !== 'text' || typeof item.text !== 'string') continue;
    const sections = item.text.split(/^### /m);
    for (const section of sections) {
      if (section.startsWith('Open tabs\n')
        || (section.startsWith('Result\n') && ['browser_tabs', 'browser_close'].includes(tool))) {
        const current = section.match(/^- (\d+): \(current\) /m);
        if (current) observation.pageIndex = Number(current[1]);
        if (section.includes('No open tabs.')) observation.noOpenTabs = true;
      }
      if (section.startsWith('Page\n')) {
        const url = section.match(/^- Page URL: (.+)$/m);
        if (url) observation.pageUrl = url[1];
      }
    }
  }
  return observation;
}

// Preserve page identity when tab indices shift; ambiguous pages have no preview.
export function selectMonitoredPage(context: any, previous: any, observation: BrowserToolObservation): any {
  const pages: any[] = context?.pages?.() ?? [];
  if (observation.noOpenTabs) return null;
  if (observation.pageIndex !== undefined) return pages[observation.pageIndex] ?? null;
  if (observation.pageUrl !== undefined) {
    if (pages.includes(previous) && previous.url() === observation.pageUrl) return previous;
    const matching = pages.filter((page) => page.url() === observation.pageUrl);
    return matching.length === 1 ? matching[0] : null;
  }
  return pages.includes(previous) ? previous : pages.length === 1 ? pages[0] : null;
}
