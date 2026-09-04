import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { appConfigDb } from '@/modules/database/index.js';
import { providerMcpService } from '@/modules/providers/index.js';
import { getModuleDirectory } from '@/shared/utils.js';

import {
  browserRuntime,
  type BrowserContextLease,
  type BrowserDevicePreset,
  type BrowserLeaseReleaseReason,
  type BrowserOrientation,
  type BrowserRuntimeReadiness,
} from './browser-use-runtime.service.js';

const __dirname = getModuleDirectory(import.meta.url);
const IS_PLATFORM = process.env.VITE_IS_PLATFORM === 'true';
const BROWSER_USE_SETTINGS_KEY = 'browser_use_settings';
const BROWSER_USE_MCP_TOKEN_KEY = 'browser_use_mcp_token';

type BrowserUseRuntime = 'cloud' | 'local';
export type BrowserUseSessionStatus = 'ready' | 'stopped' | 'unavailable';

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
  viewport: {
    width: number;
    height: number;
  } | null;
  cursor: {
    x: number;
    y: number;
    actor: 'agent';
  } | null;
};

type PublicBrowserUseSession = Omit<BrowserUseSession, 'ownerId'>;

export type AgentBrowserSessionSummary = {
  id: string;
  status: BrowserUseSessionStatus;
  url: string | null;
  title: string | null;
  updatedAt: string;
  lastAction: string | null;
  message: string | null;
  device: BrowserDevicePreset;
  viewport: BrowserUseSession['viewport'];
  cursor: BrowserUseSession['cursor'];
};

export type AgentBrowserTab = {
  index: number;
  url: string;
  active: boolean;
};

// The active page within a leased context; the context itself lives on the lease.
type RuntimeHandle = {
  context: any;
  page: any;
};

type BrowserUseSettings = {
  enabled: boolean;
};

const sessions = new Map<string, BrowserUseSession>();
const handles = new Map<string, RuntimeHandle>();

const DEFAULT_SETTINGS: BrowserUseSettings = {
  enabled: false,
};
const AGENT_OWNER_ID = 'agent';
const MCP_SERVER_NAME = 'cloudcli-browser';
const LEGACY_MCP_SERVER_NAMES = ['cloudcli-browser-use'];
const SCREENSHOT_DATA_URL_PREFIX = 'data:image/jpeg;base64,';
const MAX_AGENT_TABS = 8;
export const SNAPSHOT_TEXT_MAX_CHARS = 12_000;

// Keep the default three-session list and tab-list results within the MCP
// transport's 4 KiB ordinary-result budget while preserving useful metadata.
const AGENT_SESSION_STRING_BYTES = {
  url: 384,
  title: 192,
  lastAction: 128,
  message: 256,
  tabUrl: 256,
} as const;

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

function getMcpCommand(): { command: string; args: string[] } {
  const mcpScriptPath = path.join(__dirname, 'browser-use-mcp.js');
  if (fs.existsSync(mcpScriptPath)) {
    return {
      command: process.execPath,
      args: [mcpScriptPath],
    };
  }

  return {
    command: 'cloudcli',
    args: ['browser-use-mcp'],
  };
}

function getMcpApiUrl(): string {
  const port = process.env.SERVER_PORT || process.env.PORT || '3001';
  return `http://127.0.0.1:${port}/api/browser-use-mcp`;
}

async function removeMcpServerFromAllProviders(name: string) {
  const results = await providerMcpService.removeMcpServerFromAllProviders({
    name,
    scope: 'user',
  });
  return results.map((result) => ({ ...result, name }));
}

function normalizeUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new Error('URL is required.');
  }

  const withProtocol = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  const parsed = new URL(withProtocol);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http and https URLs are supported.');
  }

  return parsed.toString();
}

export function publicBrowserSession(session: BrowserUseSession): PublicBrowserUseSession {
  const { ownerId: _ownerId, ...publicFields } = session;
  return publicFields;
}

function truncateUtf8(value: string | null, maxBytes: number): string | null {
  if (value === null || Buffer.byteLength(value, 'utf8') <= maxBytes) {
    return value;
  }

  const suffix = '…';
  const suffixBytes = Buffer.byteLength(suffix, 'utf8');
  let result = '';
  let resultBytes = 0;

  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, 'utf8');
    if (resultBytes + characterBytes + suffixBytes > maxBytes) {
      break;
    }
    result += character;
    resultBytes += characterBytes;
  }

  return `${result}${suffix}`;
}

export function agentSessionSummary(session: BrowserUseSession): AgentBrowserSessionSummary {
  return {
    id: session.id,
    status: session.status,
    url: truncateUtf8(session.url, AGENT_SESSION_STRING_BYTES.url),
    title: truncateUtf8(session.title, AGENT_SESSION_STRING_BYTES.title),
    updatedAt: session.updatedAt,
    lastAction: truncateUtf8(session.lastAction, AGENT_SESSION_STRING_BYTES.lastAction),
    message: truncateUtf8(session.message, AGENT_SESSION_STRING_BYTES.message),
    device: session.device,
    viewport: session.viewport,
    cursor: session.cursor,
  };
}

export function agentSnapshotResult(session: BrowserUseSession, text: string) {
  return {
    session: agentSessionSummary(session),
    text: text.slice(0, SNAPSHOT_TEXT_MAX_CHARS),
  };
}

export function agentScreenshotResult(session: BrowserUseSession) {
  if (!session.screenshotDataUrl?.startsWith(SCREENSHOT_DATA_URL_PREFIX)) {
    throw new Error('Browser screenshot is not available.');
  }

  return {
    session: agentSessionSummary(session),
    data: session.screenshotDataUrl.slice(SCREENSHOT_DATA_URL_PREFIX.length),
    mimeType: 'image/jpeg' as const,
  };
}

export function agentTabsResult(session: BrowserUseSession, tabs: AgentBrowserTab[]) {
  const activeTab = tabs.find((tab) => tab.active);
  const selectedTabs = tabs.slice(0, MAX_AGENT_TABS);
  if (activeTab && !selectedTabs.includes(activeTab)) {
    selectedTabs[selectedTabs.length - 1] = activeTab;
    selectedTabs.sort((left, right) => left.index - right.index);
  }

  return {
    session: agentSessionSummary(session),
    tabs: selectedTabs.map((tab) => ({
      ...tab,
      url: truncateUtf8(tab.url, AGENT_SESSION_STRING_BYTES.tabUrl) || '',
    })),
    totalTabs: tabs.length,
    tabsTruncated: tabs.length > selectedTabs.length,
  };
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
  handles.delete(lease.id);
  const session = sessions.get(lease.id);
  if (!session || session.status !== 'ready') {
    return;
  }
  session.status = 'stopped';
  session.updatedAt = new Date().toISOString();
  session.lastAction = RELEASE_MESSAGES[reason].lastAction;
  session.message = RELEASE_MESSAGES[reason].message;
});

// Every leased context gets a panel row, whether the tools reached it through
// the MCP endpoint or the legacy dispatcher; the lease id is the row's id.
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
    cursor: null,
  };
  sessions.set(session.id, session);
  return session;
}

function readDevice(value: unknown): BrowserDevicePreset | null {
  return value === 'desktop' || value === 'phone' || value === 'tablet' ? value : null;
}

function readOrientation(value: unknown): BrowserOrientation | null {
  return value === 'portrait' || value === 'landscape' ? value : null;
}

async function captureSession(session: BrowserUseSession, page: any): Promise<void> {
  const screenshot = await page.screenshot({ type: 'jpeg', quality: 72, fullPage: false });
  session.screenshotDataUrl = `data:image/jpeg;base64,${Buffer.from(screenshot).toString('base64')}`;
  session.title = await page.title().catch(() => null);
  session.url = page.url() || session.url;
  session.viewport = page.viewportSize?.() || session.viewport;
  session.updatedAt = new Date().toISOString();
}

async function getActionPoint(page: any, input: { selector?: string; text?: string; x?: number; y?: number }) {
  if (typeof input.x === 'number' && typeof input.y === 'number') {
    return { x: input.x, y: input.y };
  }

  const locator = input.selector
    ? page.locator(input.selector).first()
    : input.text
      ? page.getByText(input.text, { exact: false }).first()
      : null;

  if (!locator) {
    return null;
  }

  const box = await locator.boundingBox().catch(() => null);
  if (!box) {
    return null;
  }

  return {
    x: Math.round(box.x + box.width / 2),
    y: Math.round(box.y + box.height / 2),
  };
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

  async registerAgentMcp() {
    const { command, args } = getMcpCommand();
    await Promise.all(LEGACY_MCP_SERVER_NAMES.map((name) => removeMcpServerFromAllProviders(name)));
    const results = await providerMcpService.addMcpServerToAllProviders({
      name: MCP_SERVER_NAME,
      scope: 'user',
      transport: 'stdio',
      command,
      args,
      env: {
        CLOUDCLI_BROWSER_USE_MCP_TOKEN: getOrCreateMcpToken(),
        CLOUDCLI_BROWSER_USE_API_URL: getMcpApiUrl(),
      },
    });
    return { name: MCP_SERVER_NAME, command, args, results };
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

  async listSessions() {
    await browserRuntime.expireIdle();
    return [...sessions.values()]
      .filter((session) => session.ownerId === AGENT_OWNER_ID)
      .map(publicBrowserSession);
  },

  async createAgentSession(options?: { profileName?: string | null; device?: unknown; orientation?: unknown }) {
    const settings = readSettings();
    if (!settings.enabled) {
      throw new Error('Browser agent tools are disabled.');
    }

    const readiness = browserRuntime.getReadiness();
    if (!readiness.playwrightInstalled || !readiness.chromiumInstalled) {
      const now = new Date().toISOString();
      const session: BrowserUseSession = {
        id: `unavailable-${now}`,
        ownerId: AGENT_OWNER_ID,
        createdBy: 'agent',
        runtime: getRuntime(),
        status: 'unavailable',
        url: null,
        title: null,
        screenshotDataUrl: null,
        createdAt: now,
        updatedAt: now,
        lastAction: 'create',
        message: getSetupMessage(settings, readiness),
        profileName: null,
        device: readDevice(options?.device) || 'desktop',
        viewport: null,
        cursor: null,
      };
      return agentSessionSummary(session);
    }

    const lease = await browserRuntime.acquireContext({
      profileName: options?.profileName,
      device: readDevice(options?.device),
      orientation: readOrientation(options?.orientation),
    });
    const page = lease.context.pages()[0] || await lease.context.newPage();
    const session = createSessionRecord(lease);
    handles.set(session.id, { context: lease.context, page });
    await captureSession(session, page);
    return agentSessionSummary(session);
  },

  // The MCP endpoint leases a context per authenticated transport session; the
  // page belongs to Playwright MCP, so nothing is opened or captured here.
  async openAgentContext(request: {
    device?: unknown;
    orientation?: unknown;
    profileName?: string | null;
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
      profileName: request.profileName,
      device: readDevice(request.device),
      orientation: readOrientation(request.orientation),
    });
    createSessionRecord(lease);
    return lease;
  },

  async listAgentSessions() {
    const settings = readSettings();
    if (!settings.enabled) {
      return [];
    }
    await browserRuntime.expireIdle();
    return [...sessions.values()]
      .filter((session) => session.ownerId === AGENT_OWNER_ID)
      .map(agentSessionSummary);
  },

  async getAgentSession(sessionId: string) {
    const settings = readSettings();
    if (!settings.enabled) {
      throw new Error('Browser agent tools are disabled.');
    }
    const session = sessions.get(sessionId);
    if (!session || session.ownerId !== AGENT_OWNER_ID) {
      throw new Error('Browser session not found.');
    }
    browserRuntime.touch(sessionId);
    return session;
  },

  async agentNavigate(sessionId: string, rawUrl: string) {
    const session = await this.getAgentSession(sessionId);
    if (session.status !== 'ready') {
      throw new Error(session.message || 'Browser session is not available.');
    }

    const handle = handles.get(sessionId);
    if (!handle?.page) {
      throw new Error('Browser runtime handle is not available.');
    }

    const url = normalizeUrl(rawUrl);
    await handle.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    session.lastAction = `navigate:${url}`;
    session.cursor = null;
    await captureSession(session, handle.page);
    return agentSessionSummary(session);
  },

  async agentSnapshot(sessionId: string) {
    const session = await this.getAgentSession(sessionId);
    const handle = handles.get(sessionId);
    if (!handle?.page) {
      throw new Error('Browser runtime handle is not available.');
    }
    session.lastAction = 'snapshot';
    await captureSession(session, handle.page);
    const text = await handle.page.locator('body').innerText({ timeout: 5_000 }).catch(() => '');
    return agentSnapshotResult(session, text);
  },

  async agentScreenshot(sessionId: string) {
    const session = await this.getAgentSession(sessionId);
    const handle = handles.get(sessionId);
    if (!handle?.page) {
      throw new Error('Browser runtime handle is not available.');
    }
    session.lastAction = 'screenshot';
    await captureSession(session, handle.page);
    return agentScreenshotResult(session);
  },

  async agentClick(sessionId: string, input: { selector?: string; text?: string; x?: number; y?: number }) {
    const session = await this.getAgentSession(sessionId);
    const handle = handles.get(sessionId);
    if (!handle?.page) {
      throw new Error('Browser runtime handle is not available.');
    }
    const point = await getActionPoint(handle.page, input);

    if (input.selector) {
      await handle.page.locator(input.selector).first().click({ timeout: 10_000 });
    } else if (input.text) {
      await handle.page.getByText(input.text, { exact: false }).first().click({ timeout: 10_000 });
    } else if (typeof input.x === 'number' && typeof input.y === 'number') {
      await handle.page.mouse.click(input.x, input.y);
    } else {
      throw new Error('Provide selector, text, or x/y coordinates.');
    }

    session.lastAction = 'click';
    session.cursor = point ? { ...point, actor: 'agent' } : null;
    await captureSession(session, handle.page);
    return agentSessionSummary(session);
  },

  async agentType(sessionId: string, input: { selector?: string; text: string; submit?: boolean }) {
    const session = await this.getAgentSession(sessionId);
    const handle = handles.get(sessionId);
    if (!handle?.page) {
      throw new Error('Browser runtime handle is not available.');
    }

    if (input.selector) {
      await handle.page.locator(input.selector).first().fill(input.text, { timeout: 10_000 });
      session.cursor = await getActionPoint(handle.page, input).then((point) => (
        point ? { ...point, actor: 'agent' as const } : null
      ));
    } else {
      await handle.page.keyboard.type(input.text);
    }
    if (input.submit) {
      await handle.page.keyboard.press('Enter');
    }

    session.lastAction = 'type';
    await captureSession(session, handle.page);
    return agentSessionSummary(session);
  },

  async agentFillForm(sessionId: string, fields: Array<{ selector: string; value: string }>) {
    const session = await this.getAgentSession(sessionId);
    const handle = handles.get(sessionId);
    if (!handle?.page) {
      throw new Error('Browser runtime handle is not available.');
    }
    for (const field of fields) {
      await handle.page.locator(field.selector).first().fill(field.value, { timeout: 10_000 });
    }
    session.lastAction = 'fill_form';
    if (fields[0]) {
      session.cursor = await getActionPoint(handle.page, { selector: fields[0].selector }).then((point) => (
        point ? { ...point, actor: 'agent' as const } : null
      ));
    }
    await captureSession(session, handle.page);
    return agentSessionSummary(session);
  },

  async agentPressKey(sessionId: string, key: string) {
    const session = await this.getAgentSession(sessionId);
    const handle = handles.get(sessionId);
    if (!handle?.page) {
      throw new Error('Browser runtime handle is not available.');
    }
    await handle.page.keyboard.press(key);
    session.lastAction = `press_key:${key}`;
    await captureSession(session, handle.page);
    return agentSessionSummary(session);
  },

  async agentSelectOption(sessionId: string, selector: string, values: string[]) {
    const session = await this.getAgentSession(sessionId);
    const handle = handles.get(sessionId);
    if (!handle?.page) {
      throw new Error('Browser runtime handle is not available.');
    }
    await handle.page.locator(selector).first().selectOption(values, { timeout: 10_000 });
    session.lastAction = 'select_option';
    session.cursor = await getActionPoint(handle.page, { selector }).then((point) => (
      point ? { ...point, actor: 'agent' as const } : null
    ));
    await captureSession(session, handle.page);
    return agentSessionSummary(session);
  },

  async agentWaitFor(sessionId: string, input: { text?: string; url?: string; timeoutMs?: number }) {
    const session = await this.getAgentSession(sessionId);
    const handle = handles.get(sessionId);
    if (!handle?.page) {
      throw new Error('Browser runtime handle is not available.');
    }
    const timeout = Math.max(250, Math.min(input.timeoutMs || 5_000, 30_000));
    if (input.text) {
      await handle.page.getByText(input.text, { exact: false }).first().waitFor({ timeout });
    } else if (input.url) {
      await handle.page.waitForURL(input.url, { timeout });
    } else {
      await handle.page.waitForTimeout(timeout);
    }
    session.lastAction = 'wait_for';
    await captureSession(session, handle.page);
    return agentSessionSummary(session);
  },

  async agentTabs(sessionId: string, input: { action?: 'list' | 'new' | 'select' | 'close'; index?: number; url?: string }) {
    const session = await this.getAgentSession(sessionId);
    const handle = handles.get(sessionId);
    if (!handle?.context || !handle?.page) {
      throw new Error('Browser runtime handle is not available.');
    }
    const action = input.action || 'list';
    if (action === 'new') {
      const page = await handle.context.newPage();
      handles.set(sessionId, { ...handle, page });
      if (input.url) {
        await this.agentNavigate(sessionId, input.url);
      }
    } else if (action === 'select') {
      const page = handle.context.pages()[input.index || 0];
      if (!page) {
        throw new Error('Tab not found.');
      }
      handles.set(sessionId, { ...handle, page });
    } else if (action === 'close') {
      const pages = handle.context.pages();
      const page = pages[input.index ?? pages.indexOf(handle.page)];
      if (!page) {
        throw new Error('Tab not found.');
      }
      await page.close();
      handles.set(sessionId, { ...handle, page: handle.context.pages()[0] || await handle.context.newPage() });
    }
    const updatedHandle = handles.get(sessionId);
    await captureSession(session, updatedHandle?.page || handle.page);
    return agentTabsResult(
      session,
      handle.context.pages().map((page: any, index: number) => ({
        index,
        url: page.url(),
        active: page === (updatedHandle?.page || handle.page),
      })),
    );
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

  async agentStopSession(sessionId: string) {
    const session = await this.getAgentSession(sessionId);
    const result = await this.stopSession(sessionId);
    return {
      stopped: result.stopped,
      session: agentSessionSummary(session),
    };
  },

  async stopAllSessions() {
    await browserRuntime.closeAll();
  },
};

process.once('beforeExit', () => {
  void browserUseService.stopAllSessions();
});
