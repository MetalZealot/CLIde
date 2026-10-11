import type { ChatMessage } from '../chat/types/types';

// Claude names MCP tools `mcp__<server>__<tool>`, OpenCode `<server>_<tool>`, Codex the bare tool.
const BROWSER_TOOL = /^(?:mcp__cloudcli-browser__|cloudcli[-_]browser_)?(browser_[a-z_]+)$/;

/** The Playwright tool a call names, or null when it is not a browser call. */
export function browserToolOf(toolName: unknown): string | null {
  return BROWSER_TOOL.exec(String(toolName ?? ''))?.[1] ?? null;
}

export const isBrowserCall = (message: ChatMessage): boolean =>
  Boolean(message.isToolUse && browserToolOf(message.toolName));

const readInput = (value: unknown): Record<string, any> => {
  if (value && typeof value === 'object') return value as Record<string, any>;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

/** Host and path, without the scheme; the raw text when it is not a URL. */
export function shortUrl(url: unknown): string {
  const text = String(url ?? '');
  try {
    const parsed = new URL(text);
    return `${parsed.host}${parsed.pathname === '/' ? '' : parsed.pathname}`;
  } catch {
    return text;
  }
}

const quoted = (text: unknown): string => {
  const value = String(text ?? '').trim();
  return value ? `“${value.length > 60 ? `${value.slice(0, 59)}…` : value}”` : '';
};

const sentence = (tool: string): string => {
  const words = tool.replace(/^browser_/, '').replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** One line saying what a browser call did, past tense. Typed text is never shown. */
export function describeBrowserStep(message: ChatMessage): string {
  const tool = browserToolOf(message.toolName) ?? '';
  const input = readInput(message.toolInput);
  const element = quoted(input.element ?? input.target);
  switch (tool) {
    case 'browser_navigate': return `Opened ${shortUrl(input.url)}`.trim();
    case 'browser_navigate_back': return 'Went back';
    case 'browser_click': return `${input.doubleClick ? 'Double-clicked' : 'Clicked'} ${element || 'the page'}`;
    case 'browser_type': return `Typed into ${element || 'a field'}`;
    case 'browser_fill_form': {
      const count = Array.isArray(input.fields) ? input.fields.length : 0;
      return count ? `Filled ${count} field${count === 1 ? '' : 's'}` : 'Filled a form';
    }
    case 'browser_press_key': return `Pressed ${input.key || 'a key'}`;
    case 'browser_hover': return `Hovered over ${element || 'the page'}`;
    case 'browser_select_option': return `Chose ${quoted([].concat(input.values ?? []).join(', ')) || 'an option'}${element ? ` in ${element}` : ''}`;
    case 'browser_drag': return `Dragged ${quoted(input.startElement) || 'an item'} to ${quoted(input.endElement) || 'a target'}`;
    case 'browser_take_screenshot': return 'Took a screenshot';
    case 'browser_snapshot': return 'Read the page';
    case 'browser_evaluate': return 'Ran a script on the page';
    case 'browser_wait_for':
      if (input.text) return `Waited for ${quoted(input.text)}`;
      if (input.textGone) return `Waited for ${quoted(input.textGone)} to go`;
      return input.time ? `Waited ${input.time}s` : 'Waited';
    case 'browser_resize': return input.width && input.height ? `Resized to ${input.width}×${input.height}` : 'Resized the window';
    case 'browser_tabs':
      return ({ list: 'Listed tabs', new: 'Opened a tab', close: 'Closed a tab', select: 'Switched tabs' } as Record<string, string>)[input.action] ?? 'Managed tabs';
    case 'browser_console_messages': return 'Read the console';
    case 'browser_network_requests':
    case 'browser_network_request': return 'Read network requests';
    case 'browser_handle_dialog': return input.accept === false ? 'Dismissed a dialog' : 'Accepted a dialog';
    case 'browser_use_device': return input.device ? `Switched to ${input.device} view` : 'Switched device';
    case 'browser_close': return 'Closed the page';
    default: return sentence(tool);
  }
}

/** The last page a run opened, from its own calls. */
export function lastBrowserUrl(messages: readonly ChatMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (browserToolOf(messages[index].toolName) !== 'browser_navigate') continue;
    const url = readInput(messages[index].toolInput).url;
    if (url) return shortUrl(url);
  }
  return null;
}
