import type { ToolStatus } from './components/ToolStatusBadge';

// Exact denial messages from the Claude runtime adapter and the approval banner — other providers can't reliably signal denial
const CLAUDE_DENIAL_MESSAGES = [
  'user denied tool use',
  'user denied the request',
  'user cancelled the request',
  'tool disallowed by settings',
  'permission request timed out',
  'permission request cancelled',
];

export function deriveToolStatus(toolResult: any): ToolStatus {
  if (!toolResult) return 'running';
  if (toolResult.isError) {
    const content = String(toolResult.content || '').toLowerCase().trim();
    if (CLAUDE_DENIAL_MESSAGES.some((msg) => content.includes(msg))) {
      return 'denied';
    }
    return 'error';
  }
  return 'completed';
}
