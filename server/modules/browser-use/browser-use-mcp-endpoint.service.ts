import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { browserRuntime, type BrowserRuntime } from './browser-use-runtime.service.js';
import { browserUseService } from './browser-use.service.js';

// One authenticated MCP transport, one CLIde context lease, one Playwright MCP
// server. The lease id is the transport's session id, so the panel row, the
// browser context and the MCP session are one identity.

// `browser_run_code_unsafe` is a core tool no configuration removes, so the
// transport is the only thing keeping server-code execution off the endpoint.
const DENIED_TOOLS = new Set(['browser_run_code_unsafe']);

// Playwright MCP writes traces and saved images beside the process's working
// directory unless it is told otherwise, so every session gets its own directory
// under CLIde's config home and loses it on close.
const OUTPUT_ROOT = path.join(os.homedir(), '.cloudcli', 'browser-use', 'output');

// Core tools only; every optional capability is opt-in policy.
const mcpConfig = (sessionId: string) => ({
  capabilities: [] as [],
  outputDir: path.join(OUTPUT_ROOT, sessionId),
});

type JsonRpcMessage = Record<string, any>;

type McpServerConnection = {
  connect(transport: any): Promise<void>;
  close(): Promise<void>;
};

type LeasedContext = {
  id: string;
  context: any;
};

export type BrowserMcpContextRequest = {
  device?: string | null;
  orientation?: string | null;
  profileName?: string | null;
};

type BrowserMcpEndpointOptions = {
  runtime?: BrowserRuntime;
  openContext?: (request: BrowserMcpContextRequest) => Promise<LeasedContext>;
  createConnection?: (context: any, sessionId: string) => Promise<McpServerConnection>;
};

async function createPlaywrightMcpConnection(context: any, sessionId: string): Promise<McpServerConnection> {
  // Imported on first connection so the Playwright tree stays out of startup.
  const { createConnection } = await import('@playwright/mcp');
  return createConnection(mcpConfig(sessionId), async () => context) as unknown as McpServerConnection;
}

function readHeader(value: unknown): string {
  if (Array.isArray(value)) {
    return String(value[0] || '').trim();
  }
  return typeof value === 'string' ? value.trim() : '';
}

function readQuery(value: unknown): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

function isInitialize(body: unknown): boolean {
  return Array.isArray(body) ? body.some((message) => isInitializeRequest(message)) : isInitializeRequest(body);
}

function jsonRpcError(code: number, message: string) {
  return { jsonrpc: '2.0' as const, error: { code, message }, id: null };
}

function filterDeniedTools(message: JsonRpcMessage): JsonRpcMessage {
  const tools = message?.result?.tools;
  if (!Array.isArray(tools)) {
    return message;
  }
  return {
    ...message,
    result: {
      ...message.result,
      tools: tools.filter((tool: { name?: string }) => !DENIED_TOOLS.has(String(tool?.name))),
    },
  };
}

// The public MCP Transport interface is the only observation and policy point:
// denied calls never reach Playwright MCP, and denied tools never reach a client.
function guardTransport(inner: any) {
  const wrapper: any = {
    get sessionId() {
      return inner.sessionId;
    },
    setProtocolVersion: (version: string) => inner.setProtocolVersion?.(version),
    start: () => inner.start(),
    close: () => inner.close(),
    send: (message: JsonRpcMessage, options?: unknown) => inner.send(filterDeniedTools(message), options),
  };

  inner.onmessage = (message: JsonRpcMessage, extra?: unknown) => {
    const toolName = message?.method === 'tools/call' ? String(message?.params?.name || '') : '';
    if (toolName && DENIED_TOOLS.has(toolName)) {
      void inner.send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          content: [{ type: 'text', text: `Tool ${toolName} is not available in CLIde.` }],
          isError: true,
        },
      });
      return;
    }
    wrapper.onmessage?.(message, extra);
  };
  inner.onclose = () => wrapper.onclose?.();
  inner.onerror = (error: Error) => wrapper.onerror?.(error);
  return wrapper;
}

export function createBrowserMcpEndpoint(options: BrowserMcpEndpointOptions = {}) {
  const runtime = options.runtime || browserRuntime;
  const openContext = options.openContext
    || ((request: BrowserMcpContextRequest) => browserUseService.openAgentContext(request));
  const createConnection = options.createConnection || createPlaywrightMcpConnection;
  const transports = new Map<string, { transport: any; connection: McpServerConnection }>();

  async function closeSession(id: string, closeOptions: { releaseContext: boolean }): Promise<boolean> {
    const entry = transports.get(id);
    if (!entry) {
      return false;
    }
    transports.delete(id);
    await entry.connection.close().catch(() => undefined);
    await entry.transport.close?.().catch(() => undefined);
    if (closeOptions.releaseContext) {
      await runtime.releaseContext(id);
    }
    await fs.rm(path.join(OUTPUT_ROOT, id), { recursive: true, force: true }).catch(() => undefined);
    return true;
  }

  // Expiry, panel Stop and shutdown all release the lease; the transport follows it.
  runtime.onRelease((lease) => {
    void closeSession(lease.id, { releaseContext: false });
  });

  async function openSession(req: any, res: any): Promise<void> {
    const lease = await openContext({
      device: readQuery(req.query?.device),
      orientation: readQuery(req.query?.orientation),
      profileName: readQuery(req.query?.profile),
    });

    let transport: any;
    try {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => lease.id,
        onsessionclosed: (id: string) => {
          void closeSession(id, { releaseContext: true });
        },
      });
      const connection = await createConnection(lease.context, lease.id);
      await connection.connect(guardTransport(transport));
      transports.set(lease.id, { transport, connection });
    } catch (error) {
      await transport?.close?.().catch(() => undefined);
      await runtime.releaseContext(lease.id);
      throw error;
    }

    await transport.handleRequest(req, res, req.body);
  }

  return {
    async handleRequest(req: any, res: any): Promise<void> {
      const sessionId = readHeader(req.headers['mcp-session-id']);
      if (sessionId) {
        const entry = transports.get(sessionId);
        if (!entry) {
          res.status(404).json(jsonRpcError(-32001, 'Browser MCP session not found.'));
          return;
        }
        runtime.touch(sessionId);
        await entry.transport.handleRequest(req, res, req.body);
        return;
      }

      if (req.method !== 'POST' || !isInitialize(req.body)) {
        res.status(400).json(jsonRpcError(-32000, 'Browser MCP requires an initialize request or an mcp-session-id header.'));
        return;
      }

      await openSession(req, res);
    },

    listSessionIds(): string[] {
      return [...transports.keys()];
    },

    closeSession(id: string): Promise<boolean> {
      return closeSession(id, { releaseContext: true });
    },
  };
}

export type BrowserMcpEndpoint = ReturnType<typeof createBrowserMcpEndpoint>;

export const browserMcpEndpoint = createBrowserMcpEndpoint();
