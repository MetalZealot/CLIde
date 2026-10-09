import { useCallback, useEffect, useRef } from 'react';

import { api } from '../utils/api';
import type { Project } from '../types/app';
import type { FileOpenOptions } from '../components/code-editor/types/types';

type OnFileOpen = (filePath: string, diffInfo?: any, options?: FileOpenOptions) => void;

export type FileOpenResolutionIssue = {
  kind: 'ambiguous' | 'error';
  reference: string;
};

type FileResolution =
  | { status: 'resolved'; match: { path: string; relativePath: string; type: 'file' | 'directory' } }
  | { status: 'not-found'; matches: [] }
  | { status: 'ambiguous'; matches: Array<{ relativePath: string }> };

/**
 * Resolves a chat or palette file reference without loading the recursive tree.
 * A newer click, project change, or unmount aborts the old request, so a late
 * response can never take over the editor minutes after the original click.
 */
export function useFileOpenResolver(
  selectedProject: Project | null | undefined,
  onFileOpen: OnFileOpen,
  onResolutionIssue?: (issue: FileOpenResolutionIssue) => void,
  /** Receives a folder inside the project, which has no editor to open in. */
  onDirectory?: (directoryPath: string) => void,
): OnFileOpen {
  const projectId = selectedProject?.projectId;
  const activeRequestRef = useRef<{
    key: string;
    controller: AbortController;
    generation: number;
  } | null>(null);
  const generationRef = useRef(0);

  useEffect(() => () => {
    activeRequestRef.current?.controller.abort();
    activeRequestRef.current = null;
  }, [projectId]);

  return useCallback((filePath: string, diffInfo?: any, options?: FileOpenOptions) => {
    const reference = filePath.replace(/\\/g, '/').trim();
    if (!reference) return;
    if (!projectId) {
      onFileOpen(filePath, diffInfo, options);
      return;
    }
    const key = `${projectId}\u0000${reference}`;
    if (activeRequestRef.current?.key === key) return;

    activeRequestRef.current?.controller.abort();
    const controller = new AbortController();
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    activeRequestRef.current = { key, controller, generation };

    void api.resolveProjectFile(projectId, reference, { signal: controller.signal })
      .then(async (response) => {
        const resolution = await response.json() as FileResolution & { error?: string };
        if (controller.signal.aborted || activeRequestRef.current?.generation !== generation) return;
        if (!response.ok) throw new Error(resolution.error || 'Could not resolve file reference');
        if (resolution.status === 'resolved' && resolution.match.type === 'directory') {
          const insideProject = !resolution.match.relativePath.startsWith('/');
          if (onDirectory && insideProject) onDirectory(resolution.match.path);
          else onResolutionIssue?.({ kind: 'error', reference });
          return;
        }
        if (resolution.status === 'resolved') {
          onFileOpen(resolution.match.path, diffInfo, options);
          return;
        }
        if (resolution.status === 'not-found') {
          onFileOpen(filePath, diffInfo, options);
          return;
        }
        if (resolution.status === 'ambiguous') {
          onResolutionIssue?.({ kind: 'ambiguous', reference });
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || (error as Error).name === 'AbortError') return;
        console.error('File reference resolution failed:', error);
        onResolutionIssue?.({ kind: 'error', reference });
      })
      .finally(() => {
        if (activeRequestRef.current?.generation === generation) {
          activeRequestRef.current = null;
        }
      });
  }, [onDirectory, onFileOpen, onResolutionIssue, projectId]);
}
