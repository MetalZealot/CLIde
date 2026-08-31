import { useCallback, useEffect, useRef, useState } from 'react';

import type { Project } from '../../../types/app';
import { api } from '../../../utils/api';
import type { FileTreeNode, FileTreeSearchPage } from '../types/types';

const SEARCH_DELAY_MS = 200;
const SEARCH_PAGE_SIZE = 100;

type UseFileTreeSearchArgs = {
  files: FileTreeNode[];
  selectedProject: Project | null;
  mutationRevision: number;
};

type UseFileTreeSearchResult = {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  filteredFiles: FileTreeNode[];
  searchLoading: boolean;
  searchError: string | null;
  hasMoreSearchResults: boolean;
  loadMoreSearchResults: () => void;
};

function toFileTreeNodes(page: FileTreeSearchPage): FileTreeNode[] {
  return page.results.map((result) => ({
    ...result,
    childrenLoaded: result.type === 'directory' ? false : undefined,
  }));
}

export function useFileTreeSearch({
  files,
  selectedProject,
  mutationRevision,
}: UseFileTreeSearchArgs): UseFileTreeSearchResult {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<FileTreeNode[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const requestGenerationRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const previousMutationRevisionRef = useRef(mutationRevision);

  const query = searchQuery.trim();
  const projectId = selectedProject?.projectId;

  const runSearch = useCallback(async (
    cursor: string | null,
    append: boolean,
    refresh = false,
  ) => {
    if (!projectId || !query) return;
    if (append && loadingMoreRef.current) return;

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const generation = append ? requestGenerationRef.current : requestGenerationRef.current + 1;
    if (!append) requestGenerationRef.current = generation;
    loadingMoreRef.current = append;
    setSearchLoading(true);
    setSearchError(null);

    try {
      const response = await api.searchProjectFiles(projectId, {
        query,
        cursor,
        limit: SEARCH_PAGE_SIZE,
        entryType: 'all',
        refresh,
        signal: controller.signal,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Project search failed');
      if (controller.signal.aborted || requestGenerationRef.current !== generation) return;
      const page = payload as FileTreeSearchPage;
      const incoming = toFileTreeNodes(page);
      setSearchResults((current) => append ? [...current, ...incoming] : incoming);
      setNextCursor(page.nextCursor);
    } catch (error) {
      if (controller.signal.aborted || (error as Error).name === 'AbortError') return;
      setSearchError((error as Error).message);
      if (!append) setSearchResults([]);
    } finally {
      if (!controller.signal.aborted && requestGenerationRef.current === generation) {
        setSearchLoading(false);
      }
      loadingMoreRef.current = false;
    }
  }, [projectId, query]);

  useEffect(() => {
    controllerRef.current?.abort();
    setNextCursor(null);
    setSearchError(null);
    if (!projectId || !query) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    const refresh = previousMutationRevisionRef.current !== mutationRevision;
    previousMutationRevisionRef.current = mutationRevision;
    const timer = window.setTimeout(() => {
      void runSearch(null, false, refresh);
    }, SEARCH_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      controllerRef.current?.abort();
    };
  }, [projectId, query, mutationRevision, runSearch]);

  const loadMoreSearchResults = useCallback(() => {
    if (nextCursor) void runSearch(nextCursor, true);
  }, [nextCursor, runSearch]);

  return {
    searchQuery,
    setSearchQuery,
    filteredFiles: query ? searchResults : files,
    searchLoading,
    searchError,
    hasMoreSearchResults: Boolean(nextCursor),
    loadMoreSearchResults,
  };
}
