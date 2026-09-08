import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// cross-spawn: drop-in spawn with Windows .cmd/PATHEXT resolution.
import spawn from 'cross-spawn';

const require = createRequire(import.meta.url);

// Browser process, context and profile lifecycle. The action service and, later,
// the Playwright MCP context getter only ever hold a lease from here; nothing
// else launches or closes a browser.

export type BrowserDevicePreset = 'desktop' | 'phone' | 'tablet';
export type BrowserOrientation = 'portrait' | 'landscape';

// What a preset resolves to: a name from Playwright's device registry, or an
// explicit size. A custom size on a touch preset keeps that preset's registry
// descriptor for user agent, pixel density and touch, and overrides only the
// viewport.
export type BrowserViewportProfile =
  | { mode: 'device'; device: string }
  | { mode: 'custom'; width: number; height: number };
export type BrowserViewportProfiles = Record<BrowserDevicePreset, BrowserViewportProfile>;

export type BrowserDeviceDescriptorInfo = {
  name: string;
  width: number;
  height: number;
  isMobile: boolean;
  hasTouch: boolean;
  deviceScaleFactor: number;
};

export type BrowserContextRequest = {
  profileName?: string | null;
  device?: BrowserDevicePreset | null;
  orientation?: BrowserOrientation | null;
  // Callers that already own an identity for the session pass it here so the
  // lease, the panel row and that identity stay one id.
  id?: string;
};

// One leased context. `id` is opaque and doubles as the panel session id.
export type BrowserContextLease = {
  id: string;
  profileName: string | null;
  device: BrowserDevicePreset;
  orientation: BrowserOrientation;
  viewport: { width: number; height: number };
  context: any;
  createdAt: number;
  lastUsedAt: number;
};

export type BrowserLeaseReleaseReason = 'released' | 'expired' | 'shutdown' | 'disconnected';

export type BrowserRuntimeReadiness = {
  playwrightInstalled: boolean;
  chromiumInstalled: boolean;
  chromiumExecutablePath: string | null;
  installInProgress: boolean;
  installMessage: string | null;
};

type PlaywrightLike = {
  chromium: {
    launch(options: Record<string, unknown>): Promise<any>;
    launchPersistentContext(userDataDir: string, options: Record<string, unknown>): Promise<any>;
    executablePath(): string;
  };
  devices: Record<string, Record<string, unknown> | undefined>;
};

type BrowserRuntimeOptions = {
  loadPlaywright?: () => PlaywrightLike | null;
  maxSessions?: number;
  sessionTtlMs?: number;
  profileRoot?: string;
  now?: () => number;
  loadViewportProfiles?: () => BrowserViewportProfiles | null;
};

type RuntimeProbe = Omit<BrowserRuntimeReadiness, 'installInProgress' | 'installMessage'>;

const DEFAULT_MAX_SESSIONS = Number.parseInt(process.env.CLOUDCLI_BROWSER_USE_MAX_SESSIONS_PER_OWNER || '3', 10);
const DEFAULT_SESSION_TTL_MS = Number.parseInt(process.env.CLOUDCLI_BROWSER_USE_SESSION_TTL_MS || String(30 * 60 * 1000), 10);
const DEFAULT_PROFILE_ROOT = path.join(os.homedir(), '.cloudcli', 'browser-use', 'profiles');
const RUNTIME_READINESS_CACHE_TTL_MS = 30_000;
const INSTALL_COMMAND_TIMEOUT_MS = Number.parseInt(
  process.env.CLOUDCLI_BROWSER_USE_INSTALL_TIMEOUT_MS || String(10 * 60 * 1000),
  10,
);
const LAUNCH_OPTIONS = {
  headless: true,
  args: ['--disable-dev-shm-usage'],
};
const DESKTOP_VIEWPORT = { width: 1440, height: 900 };
// Playwright's public device registry supplies touch, UA and pixel density.
const TOUCH_BASE_DESCRIPTORS: Record<Exclude<BrowserDevicePreset, 'desktop'>, string> = {
  phone: 'Pixel 7',
  tablet: 'Galaxy Tab S4',
};
// A landscape twin exists for most registry devices but not all, so an
// unmatched orientation is reached by swapping the axes.
const LANDSCAPE_SUFFIX = ' landscape';

export const DEFAULT_VIEWPORT_PROFILES: BrowserViewportProfiles = {
  desktop: { mode: 'custom', width: DESKTOP_VIEWPORT.width, height: DESKTOP_VIEWPORT.height },
  phone: { mode: 'device', device: TOUCH_BASE_DESCRIPTORS.phone },
  tablet: { mode: 'device', device: TOUCH_BASE_DESCRIPTORS.tablet },
};

export const MIN_VIEWPORT_EDGE = 240;
export const MAX_VIEWPORT_EDGE = 4000;
// A screenshot is resized to roughly this long edge before a model reads it, so
// a wider viewport costs the same and arrives softer. Advisory, not a limit.
export const RECOMMENDED_MAX_VIEWPORT_EDGE = 1568;

function clampViewportEdge(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.min(MAX_VIEWPORT_EDGE, Math.max(MIN_VIEWPORT_EDGE, Math.round(parsed)));
}

// Anything that reaches a context option passes through here: stored settings,
// request bodies and test doubles alike.
export function normalizeViewportProfile(value: unknown): BrowserViewportProfile | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.mode === 'device') {
    const device = typeof candidate.device === 'string' ? candidate.device.trim() : '';
    return device ? { mode: 'device', device } : null;
  }
  if (candidate.mode === 'custom') {
    const width = clampViewportEdge(candidate.width);
    const height = clampViewportEdge(candidate.height);
    return width && height ? { mode: 'custom', width, height } : null;
  }
  return null;
}

export function normalizeViewportProfiles(value: unknown): BrowserViewportProfiles {
  const source = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    desktop: normalizeViewportProfile(source.desktop) || DEFAULT_VIEWPORT_PROFILES.desktop,
    phone: normalizeViewportProfile(source.phone) || DEFAULT_VIEWPORT_PROFILES.phone,
    tablet: normalizeViewportProfile(source.tablet) || DEFAULT_VIEWPORT_PROFILES.tablet,
  };
}

function withOrientation(
  contextOptions: Record<string, unknown>,
  orientation: BrowserOrientation,
): Record<string, unknown> {
  const viewport = contextOptions.viewport as { width: number; height: number } | undefined;
  if (!viewport) {
    return contextOptions;
  }
  const isLandscape = viewport.width >= viewport.height;
  if (isLandscape === (orientation === 'landscape')) {
    return contextOptions;
  }
  return { ...contextOptions, viewport: { width: viewport.height, height: viewport.width } };
}

function loadPlaywrightPackage(): PlaywrightLike | null {
  try {
    return require('playwright');
  } catch {
    return null;
  }
}

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const output: string[] = [];
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(() => reject(new Error(
        `${command} ${args.join(' ')} timed out after ${INSTALL_COMMAND_TIMEOUT_MS}ms.`,
      )));
    }, INSTALL_COMMAND_TIMEOUT_MS);
    timer.unref?.();

    // stdio config above guarantees the pipes exist; cross-spawn's types
    // just don't narrow them the way node's spawn overloads do.
    child.stdout?.on('data', (chunk) => output.push(String(chunk)));
    child.stderr?.on('data', (chunk) => output.push(String(chunk)));
    child.on('error', (error) => finish(() => reject(error)));
    child.on('close', (code) => finish(() => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(output.join('').trim() || `${command} ${args.join(' ')} exited with code ${code}`));
    }));
  });
}

function formatInstallError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('sudo') && message.includes('password')) {
    return 'Installing Chromium system dependencies requires administrator privileges. Run `npx playwright install-deps chromium` on the machine where CloudCLI runs, then try again.';
  }
  return message || 'Failed to install Browser runtime.';
}

// Consumed by the action service for the session's display name.
export function normalizeProfileName(profileName?: string | null): string | null {
  const normalized = String(profileName || '').trim();
  return normalized ? normalized.slice(0, 80) : null;
}

// Consumed by the action service and tests; the slug is the profile lock key and
// its directory name, and it can never leave `profileRoot`.
export function resolveProfileDirectory(profileName: string, profileRoot = DEFAULT_PROFILE_ROOT): { slug: string; directory: string } {
  const slug = profileName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  if (!slug || /^\.+$/.test(slug)) {
    throw new Error('Profile name must contain a letter or digit.');
  }

  const root = path.resolve(profileRoot);
  const directory = path.resolve(root, slug);
  if (directory !== root && !directory.startsWith(`${root}${path.sep}`)) {
    throw new Error('Profile name resolves outside the profile directory.');
  }
  return { slug, directory };
}

export function createBrowserRuntime(options: BrowserRuntimeOptions = {}) {
  const loadPlaywright = options.loadPlaywright || loadPlaywrightPackage;
  const maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;
  const sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
  const profileRoot = options.profileRoot || DEFAULT_PROFILE_ROOT;
  const now = options.now || Date.now;
  // Set by the settings service, which owns the stored profiles; read on every
  // context creation so a saved change reaches the next session without a restart.
  let loadViewportProfiles = options.loadViewportProfiles || ((): BrowserViewportProfiles | null => null);

  const leases = new Map<string, BrowserContextLease>();
  const lockedProfiles = new Map<string, string>();
  const releaseListeners = new Set<(lease: BrowserContextLease, reason: BrowserLeaseReleaseReason) => void>();
  const swapListeners = new Set<(lease: BrowserContextLease) => void>();
  // Temporary contexts share one headless browser; persistent profiles own theirs.
  let sharedBrowser: Promise<any> | null = null;
  let sharedBrowserGeneration = 0;
  let expiryTimer: NodeJS.Timeout | null = null;
  let installPromise: Promise<{ success: boolean; message: string }> | null = null;
  let lastInstallMessage: string | null = null;
  let probeCache: { value: RuntimeProbe; updatedAt: number } | null = null;

  function probe(): RuntimeProbe {
    const playwright = loadPlaywright();
    const readiness: RuntimeProbe = {
      playwrightInstalled: Boolean(playwright),
      chromiumInstalled: false,
      chromiumExecutablePath: null,
    };
    if (!playwright) {
      return readiness;
    }

    try {
      const executablePath = playwright.chromium.executablePath();
      readiness.chromiumExecutablePath = executablePath;
      readiness.chromiumInstalled = Boolean(executablePath && fs.existsSync(executablePath));
    } catch {
      readiness.chromiumInstalled = false;
    }
    return readiness;
  }

  function getReadiness(probeOptions: { force?: boolean } = {}): BrowserRuntimeReadiness {
    const at = now();
    const canUseCache = !probeOptions.force
      && !installPromise
      && probeCache
      && at - probeCache.updatedAt < RUNTIME_READINESS_CACHE_TTL_MS;
    const value = canUseCache && probeCache ? probeCache.value : probe();
    if (!canUseCache && !installPromise) {
      probeCache = { value, updatedAt: at };
    }
    return {
      ...value,
      installInProgress: Boolean(installPromise),
      installMessage: lastInstallMessage,
    };
  }

  function requirePlaywright(): PlaywrightLike {
    const playwright = loadPlaywright();
    if (!playwright) {
      throw new Error('Playwright is not installed.');
    }
    return playwright;
  }

  // Browser binaries only. The Playwright package is a CLIde dependency and is
  // never installed at runtime: a worktree's node_modules may be main's.
  async function installBrowsers(): Promise<{ success: boolean; message: string }> {
    if (installPromise) {
      return installPromise;
    }

    probeCache = null;
    installPromise = (async () => {
      try {
        let cliPath: string;
        try {
          cliPath = path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js');
        } catch {
          throw new Error('Playwright is missing from CLIde\'s dependencies. Reinstall CLIde\'s packages, then try again.');
        }

        if (process.platform === 'linux') {
          lastInstallMessage = 'Installing Chromium system dependencies...';
          await runCommand(process.execPath, [cliPath, 'install-deps', 'chromium']);
        }

        lastInstallMessage = 'Installing Chromium runtime...';
        await runCommand(process.execPath, [cliPath, 'install', 'chromium']);

        lastInstallMessage = 'Browser runtime installed.';
        return { success: true, message: lastInstallMessage };
      } catch (error) {
        lastInstallMessage = formatInstallError(error);
        return { success: false, message: lastInstallMessage };
      }
    })();

    try {
      return await installPromise;
    } finally {
      installPromise = null;
      probeCache = null;
    }
  }

  function viewportProfileFor(device: BrowserDevicePreset): BrowserViewportProfile {
    let configured: BrowserViewportProfiles | null = null;
    try {
      configured = loadViewportProfiles();
    } catch (error: any) {
      console.warn('[Browser] Failed to read viewport profiles:', error?.message || error);
    }
    return normalizeViewportProfile(configured?.[device]) || DEFAULT_VIEWPORT_PROFILES[device];
  }

  function descriptorOptions(playwright: PlaywrightLike, name: string): Record<string, unknown> {
    const descriptor = playwright.devices[name];
    if (!descriptor) {
      throw new Error(`Playwright has no "${name}" device descriptor.`);
    }
    const { defaultBrowserType: _browserType, ...contextOptions } = descriptor;
    return contextOptions;
  }

  function contextOptionsFor(playwright: PlaywrightLike, device: BrowserDevicePreset, orientation: BrowserOrientation) {
    const profile = viewportProfileFor(device);

    if (profile.mode === 'device') {
      const twin = `${profile.device}${LANDSCAPE_SUFFIX}`;
      const useTwin = orientation === 'landscape' && Boolean(playwright.devices[twin]);
      const contextOptions = descriptorOptions(playwright, useTwin ? twin : profile.device);
      return useTwin ? contextOptions : withOrientation(contextOptions, orientation);
    }

    const base = device === 'desktop' ? {} : descriptorOptions(playwright, TOUCH_BASE_DESCRIPTORS[device]);
    return withOrientation(
      { ...base, viewport: { width: profile.width, height: profile.height } },
      orientation,
    );
  }

  function listDeviceDescriptors(): BrowserDeviceDescriptorInfo[] {
    const playwright = loadPlaywright();
    if (!playwright) {
      return [];
    }
    // Landscape twins are derived from their base entry, so only bases are offered.
    return Object.entries(playwright.devices)
      .filter(([name]) => !name.endsWith(LANDSCAPE_SUFFIX))
      .flatMap(([name, descriptor]) => {
        const viewport = descriptor?.viewport as { width?: unknown; height?: unknown } | undefined;
        const width = clampViewportEdge(viewport?.width);
        const height = clampViewportEdge(viewport?.height);
        if (!width || !height) {
          return [];
        }
        return [{
          name,
          width,
          height,
          isMobile: descriptor?.isMobile === true,
          hasTouch: descriptor?.hasTouch === true,
          deviceScaleFactor: typeof descriptor?.deviceScaleFactor === 'number' ? descriptor.deviceScaleFactor : 1,
        }];
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async function getSharedBrowser(playwright: PlaywrightLike): Promise<any> {
    if (!sharedBrowser) {
      const generation = ++sharedBrowserGeneration;
      sharedBrowser = playwright.chromium.launch(LAUNCH_OPTIONS).then((browser) => {
        browser.on?.('disconnected', () => {
          if (generation !== sharedBrowserGeneration) {
            return;
          }
          sharedBrowser = null;
          for (const lease of leases.values()) {
            if (!lease.profileName) {
              void dropLease(lease, 'disconnected', { closeContext: false });
            }
          }
        });
        return browser;
      });
      sharedBrowser.catch(() => {
        sharedBrowser = null;
      });
    }
    return sharedBrowser;
  }

  async function closeSharedBrowserIfIdle(): Promise<void> {
    if (!sharedBrowser || [...leases.values()].some((lease) => !lease.profileName)) {
      return;
    }
    const pending = sharedBrowser;
    sharedBrowser = null;
    sharedBrowserGeneration += 1;
    const browser = await pending.catch(() => null);
    await browser?.close?.().catch(() => undefined);
  }

  function updateExpiryTimer(): void {
    if (leases.size === 0) {
      if (expiryTimer) {
        clearInterval(expiryTimer);
        expiryTimer = null;
      }
      return;
    }
    if (!expiryTimer && Number.isFinite(sessionTtlMs) && sessionTtlMs > 0) {
      expiryTimer = setInterval(() => {
        void expireIdle();
      }, Math.min(sessionTtlMs, 60_000));
      expiryTimer.unref?.();
    }
  }

  async function dropLease(
    lease: BrowserContextLease,
    reason: BrowserLeaseReleaseReason,
    dropOptions: { closeContext: boolean },
  ): Promise<void> {
    if (!leases.delete(lease.id)) {
      return;
    }
    if (lease.profileName) {
      const { slug } = resolveProfileDirectory(lease.profileName, profileRoot);
      if (lockedProfiles.get(slug) === lease.id) {
        lockedProfiles.delete(slug);
      }
    }
    if (dropOptions.closeContext) {
      await lease.context?.close?.().catch(() => undefined);
    }
    await closeSharedBrowserIfIdle();
    updateExpiryTimer();
    for (const listener of releaseListeners) {
      try {
        listener(lease, reason);
      } catch (error: any) {
        console.warn('[Browser] Release listener failed:', error?.message || error);
      }
    }
  }

  async function acquireContext(request: BrowserContextRequest = {}): Promise<BrowserContextLease> {
    await expireIdle();
    if (leases.size >= maxSessions) {
      throw new Error(`Browser is limited to ${maxSessions} active agent sessions.`);
    }

    const playwright = requirePlaywright();
    const device = request.device || 'desktop';
    const orientation = request.orientation || (device === 'desktop' ? 'landscape' : 'portrait');
    const profileName = normalizeProfileName(request.profileName);
    const contextOptions = contextOptionsFor(playwright, device, orientation);
    const id = request.id || randomUUID();
    let context: any;

    if (profileName) {
      const { slug, directory } = resolveProfileDirectory(profileName, profileRoot);
      const holder = lockedProfiles.get(slug);
      if (holder) {
        throw new Error(`Browser profile "${profileName}" is already in use by another session.`);
      }
      lockedProfiles.set(slug, id);
      try {
        fs.mkdirSync(directory, { recursive: true });
        context = await playwright.chromium.launchPersistentContext(directory, {
          ...LAUNCH_OPTIONS,
          ...contextOptions,
        });
      } catch (error) {
        lockedProfiles.delete(slug);
        throw error;
      }
    } else {
      const browser = await getSharedBrowser(playwright);
      try {
        context = await browser.newContext(contextOptions);
      } catch (error) {
        await closeSharedBrowserIfIdle();
        throw error;
      }
    }

    const at = now();
    const viewport = (contextOptions as { viewport?: { width: number; height: number } }).viewport || DESKTOP_VIEWPORT;
    const lease: BrowserContextLease = {
      id,
      profileName,
      device,
      orientation,
      viewport: { ...viewport },
      context,
      createdAt: at,
      lastUsedAt: at,
    };
    leases.set(id, lease);
    updateExpiryTimer();
    return lease;
  }

  // Touch, user agent and pixel density are fixed when a context is created, so
  // changing device means a new context under the same lease: same id, same
  // profile lock, same panel row, no pages.
  async function swapContext(
    id: string,
    request: { device?: BrowserDevicePreset | null; orientation?: BrowserOrientation | null },
  ): Promise<BrowserContextLease> {
    const lease = leases.get(id);
    if (!lease) {
      throw new Error('Browser session not found.');
    }

    const playwright = requirePlaywright();
    const device = request.device || lease.device;
    const orientation = request.orientation || (device === 'desktop' ? 'landscape' : 'portrait');
    if (device === lease.device && orientation === lease.orientation) {
      return lease;
    }

    const contextOptions = contextOptionsFor(playwright, device, orientation);
    const previous = lease.context;
    let context: any;

    if (lease.profileName) {
      // A profile directory admits one context at a time, so the old one goes first.
      const { directory } = resolveProfileDirectory(lease.profileName, profileRoot);
      await previous?.close?.().catch(() => undefined);
      context = await playwright.chromium.launchPersistentContext(directory, {
        ...LAUNCH_OPTIONS,
        ...contextOptions,
      });
    } else {
      const browser = await getSharedBrowser(playwright);
      context = await browser.newContext(contextOptions);
      await previous?.close?.().catch(() => undefined);
    }

    const viewport = (contextOptions as { viewport?: { width: number; height: number } }).viewport || DESKTOP_VIEWPORT;
    lease.context = context;
    lease.device = device;
    lease.orientation = orientation;
    lease.viewport = { ...viewport };
    lease.lastUsedAt = now();
    for (const listener of swapListeners) {
      try {
        listener(lease);
      } catch (error: any) {
        console.warn('[Browser] Swap listener failed:', error?.message || error);
      }
    }
    return lease;
  }

  async function expireIdle(): Promise<BrowserContextLease[]> {
    const at = now();
    const expired = [...leases.values()].filter((lease) => at - lease.lastUsedAt > sessionTtlMs);
    await Promise.all(expired.map((lease) => dropLease(lease, 'expired', { closeContext: true })));
    return expired;
  }

  return {
    getReadiness,
    installBrowsers,
    acquireContext,
    swapContext,
    expireIdle,

    listDeviceDescriptors,

    setViewportProfileLoader(loader: () => BrowserViewportProfiles | null): void {
      loadViewportProfiles = loader;
    },

    getLease(id: string): BrowserContextLease | null {
      return leases.get(id) || null;
    },

    touch(id: string): void {
      const lease = leases.get(id);
      if (lease) {
        lease.lastUsedAt = now();
      }
    },

    listLeases(): BrowserContextLease[] {
      return [...leases.values()];
    },

    async releaseContext(id: string): Promise<boolean> {
      const lease = leases.get(id);
      if (!lease) {
        return false;
      }
      await dropLease(lease, 'released', { closeContext: true });
      return true;
    },

    onRelease(listener: (lease: BrowserContextLease, reason: BrowserLeaseReleaseReason) => void): () => void {
      releaseListeners.add(listener);
      return () => releaseListeners.delete(listener);
    },

    onSwap(listener: (lease: BrowserContextLease) => void): () => void {
      swapListeners.add(listener);
      return () => swapListeners.delete(listener);
    },

    // Shutdown: every context and the shared browser go, listeners hear 'shutdown'.
    async closeAll(): Promise<void> {
      await Promise.all([...leases.values()].map((lease) => dropLease(lease, 'shutdown', { closeContext: true })));
      await closeSharedBrowserIfIdle();
    },
  };
}

export type BrowserRuntime = ReturnType<typeof createBrowserRuntime>;

// Consumed by the action service; Phase 2's MCP context getter leases from it too.
export const browserRuntime = createBrowserRuntime();
