/** Claude's subagent-launching tool is `Agent`; `Task` is its former name. */
const SUBAGENT_TOOL_NAMES = new Set(['Agent', 'Task']);

export function isSubagentTool(toolName: string | undefined | null): boolean {
  return Boolean(toolName && SUBAGENT_TOOL_NAMES.has(toolName));
}
