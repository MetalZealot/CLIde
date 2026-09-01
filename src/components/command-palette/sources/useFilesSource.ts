import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '../../../utils/api';

export type FileResult = {
  path: string;
  name: string;
  relativePath: string;
};

type SearchPage = {
  results: FileResult[];
  nextCursor: string | null;
};

export function useFilesSource(
  projectId: string | undefined,
  query: string,
  enabled: boolean,
) {
  const [files, setFiles] = useState<FileResult[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const queryRef = useRef(query.trim());

  const search = useCallback(async (cursor: string | null, append: boolean) => {
    const normalizedQuery = query.trim();
    if (!enabled || !projectId || !normalizedQuery) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    queryRef.current = normalizedQuery;
    setLoading(true);
    try {
      const response = await api.searchProjectFiles(projectId, {
        query: normalizedQuery,
        cursor,
        limit: 100,
        entryType: 'file',
        signal: controller.signal,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'File search failed');
      if (controller.signal.aborted || queryRef.current !== normalizedQuery) return;
      const page = payload as SearchPage;
      setFiles((current) => append ? [...current, ...page.results] : page.results);
      setNextCursor(page.nextCursor);
    } catch (error) {
      if (controller.signal.aborted || (error as Error).name === 'AbortError') return;
      if (!append) setFiles([]);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [enabled, projectId, query]);

  useEffect(() => {
    controllerRef.current?.abort();
    setFiles([]);
    setNextCursor(null);
    const normalizedQuery = query.trim();
    queryRef.current = normalizedQuery;
    if (!enabled || !projectId || !normalizedQuery) {
      setLoading(false);
      return;
    }
    const timer = window.setTimeout(() => {
      void search(null, false);
    }, 200);
    return () => {
      window.clearTimeout(timer);
      controllerRef.current?.abort();
    };
  }, [enabled, projectId, query, search]);

  const loadMore = useCallback(() => {
    if (!loading && nextCursor) void search(nextCursor, true);
  }, [loading, nextCursor, search]);

  return { files, hasMore: Boolean(nextCursor), loading, loadMore };
}
