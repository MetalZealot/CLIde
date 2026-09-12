export type BrowserSessionSummary = {
  id: string;
  chatSessionId?: string | null;
  status: 'ready' | 'stopped' | 'unavailable';
  activeToolCount?: number;
  pageAvailable?: boolean;
  url: string | null;
  title: string | null;
  screenshotDataUrl: string | null;
  screenshotVersion: number;
  createdAt: string;
  updatedAt: string;
  lastAction: string | null;
  message: string | null;
  createdBy: 'agent';
  profileName: string | null;
  device: 'desktop' | 'phone' | 'tablet';
  actions: Array<{ tool: string; ok: boolean; at: string }>;
  viewport: { width: number; height: number } | null;
};

/** Public Playwright response metadata, read before page text is inlined. */
export type BrowserToolObservation = {
  tool: string;
  ok: boolean;
  pageIndex?: number;
  pageUrl?: string;
  noOpenTabs?: boolean;
};
