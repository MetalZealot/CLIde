import { randomBytes } from 'node:crypto';

import { appConfigDb } from '@/modules/database/index.js';
import { providerMcpService } from '@/modules/providers/index.js';

import {
  browserRuntime,
  type BrowserContextLease,
  type BrowserDevicePreset,
  type BrowserLeaseReleaseReason,
  type BrowserOrientation,
  type BrowserRuntimeReadiness,
} from './browser-use-runtime.service.js';

const IS_PLATFORM = process.env.VITE_IS_PLATFORM === 'true';
const BROWSER_USE_SETTINGS_KEY = 'browser_use_settings';
const BROWSER_USE_MCP_TOKEN_KEY = 'browser_use_mcp_token';

type BrowserUseRuntime = 'cloud' | 'local';
export type BrowserUseSessionStatus = 'ready' | 'stopped' | 'unavailable';

export type BrowserAgentAction = {
  tool: string;
  ok: boolean;
  at: string;
};

export type BrowserUseSession = {
  id: string;
  ownerId: string;
  createdBy: 'agent';
  runtime: BrowserUseRuntime;
  status: BrowserUseSessionStatus;
  url: string | null;
  title: string | null;
  screenshotDataUrl: string | null;
  createdAt: string;
  updatedAt: string;
  lastAction: string | null;
  message: string | null;
  profileName: string | null;
  device: BrowserDevicePreset;
  // Bumped on every capture so the panel can poll metadata and fetch the image
  // only when it actually changed.
  screenshotVersion: number;
  actions: BrowserAgentAction[];
  viewport: {
    width: number;
    height: number;
  } | null;
};

type PublicBrowserUseSession = Omit<BrowserUseSession, 'ownerId'>;

type BrowserUseSettings = {
  enabled: boolean;
};

const sessions = new Map<string, BrowserUseSession>();
const MAX_STOPPED_SESSIONS = 5;

const DEFAULT_SETTINGS: BrowserUseSettings = {
  enabled: false,
};
const AGENT_OWNER_ID = 'agent';
const MCP_SERVER_NAME = 'cloudcli-browser';
const LEGACY_MCP_SERVER_NAMES = ['cloudcli-browser-use'];
const MAX_RECORDED_ACTIONS = 20;
// One trailing capture per window: a burst of calls costs a single screenshot.
const CAPTURE_DEBOUNCE_MS = 700;
function getRuntime(): BrowserUseRuntime {
  return IS_PLATFORM ? 'cloud' : 'local';
}

function readSettings(): BrowserUseSettings {
  try {
    const raw = appConfigDb.get(BROWSER_USE_SETTINGS_KEY);
    if (!raw) {
      return DEFAULT_SETTINGS;
    }

    const parsed = JSON.parse(raw) as Partial<BrowserUseSettings>;
    return {
      enabled: parsed.enabled === true,
    };
  } catch (error: any) {
    console.warn('[Browser] Failed to read settings:', error?.message || error);
    return DEFAULT_SETTINGS;
  }
}

function writeSettings(settings: BrowserUseSettings): BrowserUseSettings {
  const normalized = {
    enabled: settings.enabled === true,
  };

  appConfigDb.set(BROWSER_USE_SETTINGS_KEY, JSON.stringify(normalized));
  return normalized;
}

function getOrCreateMcpToken(): string {
  const existing = appConfigDb.get(BROWSER_USE_MCP_TOKEN_KEY);
  if (existing) {
    return existing;
  }
  const token = randomBytes(32).toString('hex');
  appConfigDb.set(BROWSER_USE_MCP_TOKEN_KEY, token);
  return token;
}

function getSetupMessage(settings: BrowserUseSettings, readiness: BrowserRuntimeReadiness): string {
  if (!settings.enabled) {
    return 'Browser is disabled in settings.';
  }

  if (!readiness.playwrightInstalled) {
    return 'Install Playwright and Chromium to use browser sessions.';
  }

  if (!readiness.chromiumInstalled) {
    return 'Playwright is installed, but Chromium is missing. Install the Chromium runtime to continue.';
  }

  return readiness.installMessage || 'Browser runtime is not ready.';
}

// Providers reach the official Playwright MCP tools over Streamable HTTP on the
// loopback interface; the bearer token is the only credential.
function getMcpEndpointUrl(): string {
  const port = process.env.SERVER_PORT || process.env.PORT || '3001';
  return `http://127.0.0.1:${port}/api/browser-use-mcp/mcp`;
}

async function removeMcpServerFromAllProviders(name: string) {
  const results = await providerMcpService.removeMcpServerFromAllProviders({
    name,
    scope: 'user',
  });
  return results.map((result) => ({ ...result, name }));
}

export function publicBrowserSession(session: BrowserUseSession): PublicBrowserUseSession {
  const { ownerId: _ownerId, ...publicFields } = session;
  return publicFields;
}

const RELEASE_MESSAGES: Record<BrowserLeaseReleaseReason, { lastAction: string; message: string }> = {
  released: { lastAction: 'stop', message: 'Browser session stopped. Create a new session to continue browsing.' },
  expired: { lastAction: 'expire', message: 'Browser session expired after inactivity.' },
  shutdown: { lastAction: 'shutdown', message: 'Browser session stopped during server shutdown.' },
  disconnected: { lastAction: 'disconnect', message: 'Browser process exited. Create a new session to continue browsing.' },
};

// Every lease release, whatever triggered it, lands here so the panel row and
// the runtime never disagree about whether a session is alive.
browserRuntime.onRelease((lease, reason) => {
  const session = sessions.get(lease.id);
  if (!session || session.status !== 'ready') {
    return;
  }
  session.status = 'stopped';
  session.updatedAt = new Date().toISOString();
  session.lastAction = RELEASE_MESSAGES[reason].lastAction;
  session.message = RELEASE_MESSAGES[reason].message;
  pruneStoppedSessions(sessions);
});

// A stopped row is history, and only an explicit delete removed one, so a long
// session accumulated a row per agent connection. Newest first, so the row that
// just stopped always survives.
export function pruneStoppedSessions(
  entries: Map<string, BrowserUseSession>,
  max = MAX_STOPPED_SESSIONS,
): void {
  const stopped = [...entries.values()]
    .filter((entry) => entry.status === 'stopped')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  for (const entry of stopped.slice(max)) {
    entries.delete(entry.id);
  }
}

// Every leased context gets a panel row; the lease id is the row's id.
function createSessionRecord(lease: BrowserContextLease): BrowserUseSession {
  const createdAt = new Date(lease.createdAt).toISOString();
  const session: BrowserUseSession = {
    id: lease.id,
    ownerId: AGENT_OWNER_ID,
    createdBy: 'agent',
    runtime: getRuntime(),
    status: 'ready',
    url: null,
    title: null,
    screenshotDataUrl: null,
    createdAt,
    updatedAt: createdAt,
    lastAction: 'create',
    message: 'Browser session is ready.',
    profileName: lease.profileName,
    device: lease.device,
    viewport: { ...lease.viewport },
    screenshotVersion: 0,
    actions: [],
  };
  sessions.set(session.id, session);
  return session;
}

// A device swap keeps the lease id, so the panel row follows it rather than
// being replaced.
browserRuntime.onSwap((lease) => {
  const session = sessions.get(lease.id);
  if (!session) {
    return;
  }
  session.device = lease.device;
  session.viewport = { ...lease.viewport };
  session.url = null;
  session.title = null;
  session.lastAction = `device:${lease.device}`;
  session.message = `Switched to ${lease.device} emulation. Pages were replaced; navigate again.`;
  session.updatedAt = new Date().toISOString();
});

function readDevice(value: unknown): BrowserDevicePreset | null {
  return value === 'desktop' || value === 'phone' || value === 'tablet' ? value : null;
}

function readOrientation(value: unknown): BrowserOrientation | null {
  return value === 'portrait' || value === 'landscape' ? value : null;
}

async function captureSession(session: BrowserUseSession, page: any): Promise<void> {
  const screenshot = await page.screenshot({ type: 'jpeg', quality: 72, fullPage: false });
  session.screenshotDataUrl = `data:image/jpeg;base64,${Buffer.from(screenshot).toString('base64')}`;
  session.screenshotVersion += 1;
  session.title = await page.title().catch(() => null);
  session.url = page.url() || session.url;
  session.viewport = page.viewportSize?.() || session.viewport;
  session.updatedAt = new Date().toISOString();
}

// Playwright MCP owns the pages, so the panel reads whichever one the agent is
// most likely looking at: the newest page that has actually navigated.
function monitoredPage(context: any): any {
  const pages: any[] = context?.pages?.() || [];
  if (pages.length === 0) {
    return null;
  }
  const loaded = pages.filter((page) => {
    const url = typeof page?.url === 'function' ? page.url() : '';
    return url && url !== 'about:blank';
  });
  const candidates = loaded.length > 0 ? loaded : pages;
  return candidates[candidates.length - 1];
}

const captureTimers = new Map<string, NodeJS.Timeout>();

async function captureFromLease(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  const lease = browserRuntime.getLease(sessionId);
  if (!session || !lease || session.status !== 'ready') {
    return;
  }
  const page = monitoredPage(lease.context);
  if (!page) {
    return;
  }
  try {
    await captureSession(session, page);
  } catch (error: any) {
    // A page can navigate or close mid-capture; the next action captures again.
    console.warn('[Browser] Monitor capture failed:', error?.message || error);
  }
}

function scheduleCapture(sessionId: string): void {
  if (captureTimers.has(sessionId)) {
    return;
  }
  const timer = setTimeout(() => {
    captureTimers.delete(sessionId);
    void captureFromLease(sessionId);
  }, CAPTURE_DEBOUNCE_MS);
  timer.unref?.();
  captureTimers.set(sessionId, timer);
}

export const browserUseService = {
  async getSettings() {
    return readSettings();
  },

  async updateSettings(settings: Partial<BrowserUseSettings>) {
    const current = readSettings();
    const nextSettings = {
      enabled: typeof settings.enabled === 'boolean' ? settings.enabled : current.enabled,
    };

    const next = writeSettings(nextSettings);
    if (next.enabled) {
      await this.registerAgentMcp();
    } else if (current.enabled) {
      await this.unregisterAgentMcp();
      await this.stopAllSessions();
    }
    return next;
  },

  async getStatus() {
    const settings = readSettings();
    const readiness = browserRuntime.getReadiness();
    const available = settings.enabled && readiness.playwrightInstalled && readiness.chromiumInstalled;

    return {
      enabled: settings.enabled,
      runtime: getRuntime(),
      available,
      playwrightInstalled: readiness.playwrightInstalled,
      chromiumInstalled: readiness.chromiumInstalled,
      installInProgress: readiness.installInProgress,
      sessionCount: sessions.size,
      message: available
        ? 'Browser runtime is available.'
        : getSetupMessage(settings, readiness),
    };
  },

  // Called at boot: the endpoint URL carries this server's port and the bearer
  // token, so a provider's stored registration is only correct for the server
  // that wrote it.
  async syncAgentMcpRegistration() {
    if (!readSettings().enabled) {
      return { registered: false as const };
    }
    const result = await this.registerAgentMcp();
    return { registered: true as const, ...result };
  },

  async registerAgentMcp() {
    const url = getMcpEndpointUrl();
    await Promise.all(LEGACY_MCP_SERVER_NAMES.map((name) => removeMcpServerFromAllProviders(name)));
    const results = await providerMcpService.addMcpServerToAllProviders({
      name: MCP_SERVER_NAME,
      scope: 'user',
      transport: 'http',
      url,
      headers: { Authorization: `Bearer ${getOrCreateMcpToken()}` },
      // The endpoint is bearer-guarded and its tool list is already filtered, so
      // these need no second gate. `approve` pre-approves them; `auto` still
      // routes through a review that a session with approvals off auto-denies.
      toolsApprovalMode: 'approve',
    });
    return { name: MCP_SERVER_NAME, url, results };
  },

  getMcpToken() {
    return getOrCreateMcpToken();
  },

  async unregisterAgentMcp() {
    const results = (await Promise.all(
      [MCP_SERVER_NAME, ...LEGACY_MCP_SERVER_NAMES].map((name) => removeMcpServerFromAllProviders(name)),
    )).flat();
    return { name: MCP_SERVER_NAME, results };
  },

  async installRuntime() {
    const result = await browserRuntime.installBrowsers();
    return {
      ...result,
      status: await this.getStatus(),
    };
  },

  async listSessions(options: { view?: 'summary' } = {}) {
    await browserRuntime.expireIdle();
    const visible = [...sessions.values()].filter((session) => session.ownerId === AGENT_OWNER_ID);
    // The summary view is what the panel polls, so it carries no image bytes;
    // screenshotVersion tells it when to fetch one.
    return options.view === 'summary'
      ? visible.map((session) => ({ ...publicBrowserSession(session), screenshotDataUrl: null }))
      : visible.map(publicBrowserSession);
  },

  async getSession(sessionId: string) {
    const session = sessions.get(sessionId);
    if (!session || session.ownerId !== AGENT_OWNER_ID) {
      throw new Error('Browser session not found.');
    }
    return publicBrowserSession(session);
  },

  // Called by the MCP endpoint on the first tool call that needs a page, not on
  // connect; the page belongs to Playwright MCP, so nothing is opened or
  // captured here.
  async openAgentContext(request: {
    device?: unknown;
    orientation?: unknown;
    profileName?: string | null;
    id?: string;
  } = {}): Promise<BrowserContextLease> {
    const settings = readSettings();
    if (!settings.enabled) {
      throw new Error('Browser agent tools are disabled.');
    }

    const readiness = browserRuntime.getReadiness();
    if (!readiness.playwrightInstalled || !readiness.chromiumInstalled) {
      throw new Error(getSetupMessage(settings, readiness));
    }

    const lease = await browserRuntime.acquireContext({
      id: request.id,
      profileName: request.profileName,
      device: readDevice(request.device),
      orientation: readOrientation(request.orientation),
    });
    createSessionRecord(lease);
    return lease;
  },

  // Called at the MCP transport boundary for every tool call that reaches
  // Playwright MCP, so the panel reflects agent work without the agent
  // reporting it.
  recordAgentAction(sessionId: string, action: { tool: string; ok: boolean }) {
    const session = sessions.get(sessionId);
    if (!session) {
      return;
    }
    const at = new Date().toISOString();
    session.actions = [...session.actions, { tool: action.tool, ok: action.ok, at }].slice(-MAX_RECORDED_ACTIONS);
    session.lastAction = action.tool;
    session.updatedAt = at;
    scheduleCapture(sessionId);
  },

  async stopSession(sessionId: string) {
    const session = sessions.get(sessionId);
    if (!session || session.ownerId !== AGENT_OWNER_ID) {
      return { stopped: false };
    }

    await browserRuntime.releaseContext(sessionId);
    return { stopped: true, session: publicBrowserSession(session) };
  },

  async deleteSession(sessionId: string) {
    const session = sessions.get(sessionId);
    if (!session || session.ownerId !== AGENT_OWNER_ID) {
      return { deleted: false };
    }

    await browserRuntime.releaseContext(sessionId);
    sessions.delete(sessionId);
    return { deleted: true, sessionId };
  },

  async stopAllSessions() {
    await browserRuntime.closeAll();
  },
};

process.once('beforeExit', () => {
  void browserUseService.stopAllSessions();
});
