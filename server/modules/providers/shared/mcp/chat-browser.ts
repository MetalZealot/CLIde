import { CodexMcpProvider } from '../../list/codex/codex-mcp.provider.js';
import { OpenCodeMcpProvider } from '../../list/opencode/opencode-mcp.provider.js';

const BROWSER_SERVER = 'cloudcli-browser';

// Runtime-only overrides keep simultaneous chats out of one another's browser connection.
export function scopeChatBrowserUrl(value: unknown, sessionId?: string | null): string | null {
  if (typeof value !== 'string' || !sessionId) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      || url.pathname !== '/api/browser-use-mcp/mcp') return null;
    url.searchParams.set('chatSessionId', sessionId);
    return url.toString();
  } catch {
    return null;
  }
}

// Claude already loads its effective MCP map before starting each query.
export function scopeClaudeChatBrowser(
  servers: Record<string, any>, sessionId?: string | null,
): Record<string, any> {
  const url = scopeChatBrowserUrl(servers[BROWSER_SERVER]?.url, sessionId);
  return url ? { ...servers, [BROWSER_SERVER]: { ...servers[BROWSER_SERVER], url } } : servers;
}

// Codex merges a single dotted URL override with the native configuration.
export async function codexChatBrowserConfig(workspacePath: string, sessionId?: string | null) {
  if (!sessionId) return {};
  try {
    const groups = await new CodexMcpProvider().listServers({ workspacePath });
    const server = [...groups.user, ...groups.project].reverse().find((item) => item.name === BROWSER_SERVER);
    const url = scopeChatBrowserUrl(server?.url, sessionId);
    return url ? { [`mcp_servers.${BROWSER_SERVER}.url`]: url } : {};
  } catch {
    return {};
  }
}

// OpenCode merges inline configuration after its file-backed configuration.
export async function openCodeChatBrowserEnv(workspacePath: string, sessionId?: string | null) {
  if (!sessionId) return {};
  try {
    const groups = await new OpenCodeMcpProvider().listServers({ workspacePath });
    const server = [...groups.user, ...groups.project].reverse().find((item) => item.name === BROWSER_SERVER);
    const inherited = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT || '{}');
    const current = inherited.mcp?.[BROWSER_SERVER];
    if (current?.type && current.type !== 'remote') return {};
    if (!current?.url && (process.env.OPENCODE_CONFIG || process.env.OPENCODE_CONFIG_DIR)) return {};
    const url = scopeChatBrowserUrl(current?.url ?? server?.url, sessionId);
    if (!url) return {};
    return {
      OPENCODE_CONFIG_CONTENT: JSON.stringify({
        ...inherited,
        mcp: { ...inherited.mcp, [BROWSER_SERVER]: { type: 'remote', ...current, url } },
      }),
    };
  } catch {
    return {};
  }
}
