export type CodeEditorDiffInfo = {
  old_string?: string;
  new_string?: string;
  [key: string]: unknown;
};

export type CodeEditorFile = {
  name: string;
  path: string;
  // DB projectId; used by the editor to build `/api/projects/:projectId/file`
  // URLs for reading and saving content.
  projectId?: string;
  diffInfo?: CodeEditorDiffInfo | null;
  // Identity of the *document*, minted once when a file is opened and kept
  // across moves and renames. The editor reloads from disk when this changes,
  // so rewriting the path alone rebinds where saves go without discarding an
  // unsaved buffer. Optional: callers that don't mint one fall back to the
  // path, which is the pre-rebind behavior.
  documentId?: string;
  [key: string]: unknown;
};

export type CodeEditorSettingsState = {
  isDarkMode: boolean;
  wordWrap: boolean;
  minimapEnabled: boolean;
  showLineNumbers: boolean;
  fontSize: string;
};
