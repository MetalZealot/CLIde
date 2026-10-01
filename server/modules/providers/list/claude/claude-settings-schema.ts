/**
 * The SDK's `Settings` interface, read from the installed `sdk.d.ts`, so a key
 * a release adds arrives with a control and its own help text without anyone
 * writing either.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

export type ClaudeSettingControl =
  | { kind: 'boolean' }
  | { kind: 'number' }
  | { kind: 'string' }
  | { kind: 'enum'; options: string[] }
  /** Objects, arrays and unions: no generated control. */
  | { kind: 'complex' };

export type ClaudeSettingSchema = {
  key: string;
  control: ClaudeSettingControl;
  /** The key's doc comment, `@` tags dropped; empty when the SDK ships none. */
  description: string;
};

const classify = (type: string): ClaudeSettingControl => {
  const trimmed = type.trim().replace(/;$/, '');
  if (trimmed === 'boolean' || trimmed === 'number' || trimmed === 'string') return { kind: trimmed };
  const literals = trimmed.split('|').map((part) => part.trim());
  if (literals.every((part) => /^'[^']*'$/.test(part))) {
    return { kind: 'enum', options: literals.map((part) => part.slice(1, -1)) };
  }
  return { kind: 'complex' };
};

/** Top-level members only: the interface's own indent is four spaces. */
export const parseClaudeSettingsDeclarations = (source: string): ClaudeSettingSchema[] => {
  const lines = source.replace(/\r/g, '').split('\n');
  const start = lines.findIndex((line) => line.startsWith('export declare interface Settings {'));
  if (start < 0) return [];

  const schema: ClaudeSettingSchema[] = [];
  let comment: string[] | null = null;
  let pending: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('}')) break;
    if (/^ {4}\/\*\*/.test(line)) {
      comment = [];
      continue;
    }
    if (comment && /^ {5}\*\//.test(line)) {
      pending = comment;
      comment = null;
      continue;
    }
    if (comment) {
      comment.push(line.replace(/^\s*\*\s?/, ''));
      continue;
    }
    const member = /^ {4}([A-Za-z_]\w*)\??: (.*)$/.exec(line);
    if (member) {
      const description = pending
        .filter((text) => !text.startsWith('@'))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      schema.push({ key: member[1], control: classify(member[2]), description });
      pending = [];
    }
  }
  return schema;
};

let cached: Map<string, ClaudeSettingSchema> | null = null;

/** Parsed once per process; an SDK upgrade needs a restart anyway. */
export const readClaudeSettingsSchema = (): Map<string, ClaudeSettingSchema> => {
  if (cached) return cached;
  try {
    // The package exports neither ./package.json nor ./sdk.d.ts, so resolve
    // the main entry and read the declarations beside it.
    const entry = createRequire(import.meta.url).resolve('@anthropic-ai/claude-agent-sdk');
    const source = readFileSync(path.join(path.dirname(entry), 'sdk.d.ts'), 'utf8');
    cached = new Map(parseClaudeSettingsDeclarations(source).map((item) => [item.key, item]));
  } catch (error) {
    console.error('Could not read the Claude Agent SDK settings declarations:', error);
    cached = new Map();
  }
  return cached;
};
