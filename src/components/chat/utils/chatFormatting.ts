import type { MemoryCitation } from '../types/types';

export function decodeHtmlEntities(text: string) {
  if (!text) return text;
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

export function normalizeInlineCodeFences(text: string) {
  if (!text || typeof text !== 'string') return text;
  try {
    return text.replace(/```[ \t]*([^\n\r]+?)[ \t]*```/g, '`$1`');
  } catch {
    return text;
  }
}

export type ExtractedMemoryCitation = {
  text: string;
  citations: MemoryCitation[];
};

/** Abbreviates a token count for a chip or a one-line label ("158K", "1.2M"). */
export const formatTokenCount = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) {
    return '0';
  }

  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  }

  if (value >= 10_000) {
    return `${Math.round(value / 1_000)}K`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }

  return value.toLocaleString();
};

export function formatMemoryCitationSource(source: string): string {
  return source.replace(/:(\d+)-(\d+)$/, ':$1–$2');
}

/**
 * Separates Codex's reserved memory provenance envelope from a displayed reply.
 *
 * The harness persists this metadata inside the assistant's final output text.
 * Keep the raw transcript intact, but expose its useful source entries as
 * structured UI metadata instead of rendering the XML envelope and rollout ids.
 * Requiring the complete structure at the very end avoids treating ordinary
 * XML-like prose as internal metadata.
 */
export function extractInternalMemoryCitation(text: string): ExtractedMemoryCitation {
  if (!text || typeof text !== 'string') return { text, citations: [] };

  const closingTag = '</oai-mem-citation>';
  const trimmed = text.trimEnd();
  if (!trimmed.endsWith(closingTag)) return { text, citations: [] };

  const openingTag = '<oai-mem-citation>';
  const openingIndex = trimmed.lastIndexOf(openingTag);
  if (openingIndex < 0) return { text, citations: [] };

  const candidate = trimmed.slice(openingIndex);
  const isCompleteEnvelope =
    /^<oai-mem-citation>\s*<citation_entries>[\s\S]*<\/citation_entries>\s*<rollout_ids>[\s\S]*<\/rollout_ids>\s*<\/oai-mem-citation>$/.test(
      candidate,
    );
  if (!isCompleteEnvelope) return { text, citations: [] };

  const entriesMatch = /<citation_entries>\s*([\s\S]*?)\s*<\/citation_entries>/.exec(candidate);
  const citations = (entriesMatch?.[1] || '')
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry): MemoryCitation => {
      const noteMatch = /^(.+?)\|note=\[(.*)\]$/.exec(entry);
      return noteMatch
        ? { source: noteMatch[1].trim(), note: noteMatch[2].trim() || undefined }
        : { source: entry };
    })
    .filter((entry) => entry.source.length > 0);

  return {
    text: trimmed.slice(0, openingIndex).trimEnd(),
    citations,
  };
}

export function unescapeWithMathProtection(text: string) {
  if (!text || typeof text !== 'string') return text;

  const mathBlocks: string[] = [];
  const placeholderPrefix = '__MATH_BLOCK_';
  const placeholderSuffix = '__';

  let processedText = text.replace(/\$\$([\s\S]*?)\$\$|\$([^\$\n]+?)\$/g, (match) => {
    const index = mathBlocks.length;
    mathBlocks.push(match);
    return `${placeholderPrefix}${index}${placeholderSuffix}`;
  });

  processedText = processedText.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r');

  processedText = processedText.replace(
    new RegExp(`${placeholderPrefix}(\\d+)${placeholderSuffix}`, 'g'),
    (match, index) => {
      return mathBlocks[parseInt(index, 10)];
    },
  );

  return processedText;
}

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function formatUsageLimitText(text: string) {
  try {
    if (typeof text !== 'string') return text;
    return text.replace(/Claude AI usage limit reached\|(\d{10,13})/g, (match, ts) => {
      let timestampMs = parseInt(ts, 10);
      if (!Number.isFinite(timestampMs)) return match;
      if (timestampMs < 1e12) timestampMs *= 1000;
      const reset = new Date(timestampMs);

      const timeStr = new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(reset);

      const offsetMinutesLocal = -reset.getTimezoneOffset();
      const sign = offsetMinutesLocal >= 0 ? '+' : '-';
      const abs = Math.abs(offsetMinutesLocal);
      const offH = Math.floor(abs / 60);
      const offM = abs % 60;
      const gmt = `GMT${sign}${offH}${offM ? ':' + String(offM).padStart(2, '0') : ''}`;
      const tzId = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      const cityRaw = tzId.split('/').pop() || '';
      const city = cityRaw
        .replace(/_/g, ' ')
        .toLowerCase()
        .replace(/\b\w/g, (char) => char.toUpperCase());
      const tzHuman = city ? `${gmt} (${city})` : gmt;

      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const dateReadable = `${reset.getDate()} ${months[reset.getMonth()]} ${reset.getFullYear()}`;

      return `Claude usage limit reached. Your limit will reset at **${timeStr} ${tzHuman}** - ${dateReadable}`;
    });
  } catch {
    return text;
  }
}

export interface LeadingCommandMatch {
  command: string;
  /** Whitespace the user typed between the command and its argument. */
  separator: string;
  rest: string;
}

/**
 * Only a command at the very start of the composer counts: that is the only
 * position a runtime parses one, so marking a mid-message token would promise
 * a dispatch that never happens. Names are matched whole, prefix included, so
 * this holds for Claude's `/name` and Codex's `$name` alike.
 */
export function splitLeadingCommand(
  text: string,
  commandNames: ReadonlySet<string>,
): LeadingCommandMatch | null {
  const match = /^(\S+)([^\S\n]*)([\s\S]*)$/.exec(text);
  if (!match || !commandNames.has(match[1])) {
    return null;
  }

  return { command: match[1], separator: match[2], rest: match[3] };
}
