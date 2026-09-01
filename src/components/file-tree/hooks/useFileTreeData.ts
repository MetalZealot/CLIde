import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '../../../utils/api';
import { remapChangedPath } from '../../../utils/filePathChange';
import type { FilePathChange, Project } from '../../../types/app';
import type { FileTreeDirectoryPage, FileTreeNode } from '../types/types';

const DIRECTORY_PAGE_SIZE = 200;

type UseFileTreeDataResult = {
  files: FileTreeNode[];
  loading: boolean;
  rootNextCursor: string | null;
  mutationRevision: number;
  loadDirectory: (path: string) => Promise<void>;
  loadMoreDirectory: (path: string) => Promise<void>;
  loadMoreRoot: () => Promise<void>;
  revealDirectory: (path: string) => Promise<string[]>;
  refreshDirectories: (paths?: string[]) => void;
  remapPaths: (changes: FilePathChange[]) => void;
};

type RequestFailure = Error & { code?: string };

function findNode(nodes: FileTreeNode[], targetPath: string): FileTreeNode | undefined {
  const normalizedTarget = targetPath.replace(/\\/g, '/');
  for (const node of nodes) {
    if (node.path.replace(/\\/g, '/') === normalizedTarget) return node;
    if (node.children?.length) {
      const match = findNode(node.children, targetPath);
      if (match) return match;
    }
  }
  return undefined;
}

function updateDirectory(
  nodes: FileTreeNode[],
  targetPath: string,
  update: (node: FileTreeNode) => FileTreeNode,
): FileTreeNode[] {
  let changed = false;
  const next = nodes.map((node) => {
    if (node.path === targetPath) {
      changed = true;
      return update(node);
    }
    if (!node.children?.length) return node;
    const children = updateDirectory(node.children, targetPath, update);
    if (children === node.children) return node;
    changed = true;
    return { ...node, children };
  });
  return changed ? next : nodes;
}

function retainLoadedChildren(
  entries: FileTreeNode[],
  previousEntries: FileTreeNode[],
): FileTreeNode[] {
  const previousByPath = new Map(previousEntries.map((entry) => [entry.path, entry]));
  return entries.map((entry) => {
    if (entry.type !== 'directory') return entry;
    const previous = previousByPath.get(entry.path);
    return {
      ...entry,
      children: previous?.children,
      childrenLoaded: previous?.childrenLoaded ?? false,
      childrenLoading: false,
      childrenError: null,
      childrenNextCursor: previous?.childrenNextCursor ?? null,
    };
  });
}

function appendUniqueEntries(previous: FileTreeNode[], incoming: FileTreeNode[]): FileTreeNode[] {
  const existingPaths = new Set(previous.map((entry) => entry.path));
  return [...previous, ...incoming.filter((entry) => !existingPaths.has(entry.path))];
}

function collectLoadedDirectories(nodes: FileTreeNode[], into: string[] = []): string[] {
  for (const node of nodes) {
    if (node.type !== 'directory') continue;
    if (node.childrenLoaded) into.push(node.path);
    if (node.children?.length) collectLoadedDirectories(node.children, into);
  }
  return into;
}

async function readDirectoryPage(
  projectId: string,
  directoryPath: string,
  cursor: string | null,
  signal: AbortSignal,
): Promise<FileTreeDirectoryPage> {
  const response = await api.getDirectoryPage(projectId, {
    path: directoryPath,
    cursor,
    limit: DIRECTORY_PAGE_SIZE,
    signal,
  });
  const payload = await response.json();
  if (!response.ok) {
    const failure = new Error(payload.error || 'Failed to load directory') as RequestFailure;
    failure.code = payload.code;
    throw failure;
  }
  return payload as FileTreeDirectoryPage;
}

export function useFileTreeData(selectedProject: Project | null): UseFileTreeDataResult {
  const projectId = selectedProject?.projectId;
  const [files, setFiles] = useState<FileTreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [rootNextCursor, setRootNextCursor] = useState<string | null>(null);
  const [mutationRevision, setMutationRevision] = useState(0);
  const filesRef = useRef<FileTreeNode[]>([]);
  const rootPathRef = useRef('');
  const rootNextCursorRef = useRef<string | null>(null);
  const versionsRef = useRef(new Map<string, number>());
  const inFlightRef = useRef(new Map<string, Promise<void>>());
  const controllersRef = useRef(new Map<string, { path: string; controller: AbortController }>());

  const commitFiles = useCallback((update: (current: FileTreeNode[]) => FileTreeNode[]) => {
    const next = update(filesRef.current);
    filesRef.current = next;
    setFiles(next);
  }, []);

  const setRootCursor = useCallback((cursor: string | null) => {
    rootNextCursorRef.current = cursor;
    setRootNextCursor(cursor);
  }, []);

  const abortPathRequests = useCallback((directoryPath: string) => {
    for (const [key, request] of controllersRef.current) {
      if (request.path !== directoryPath) continue;
      request.controller.abort();
      controllersRef.current.delete(key);
      inFlightRef.current.delete(key);
    }
  }, []);

  const loadPage = useCallback((directoryPath: string, cursor: string | null, append: boolean) => {
    if (!projectId) return Promise.resolve();
    const requestKey = `${directoryPath}\u0000${cursor ?? 'first'}`;
    const existing = inFlightRef.current.get(requestKey);
    if (existing) return existing;

    if (!append) abortPathRequests(directoryPath);
    const nextVersion = append
      ? versionsRef.current.get(directoryPath) ?? 1
      : (versionsRef.current.get(directoryPath) ?? 0) + 1;
    versionsRef.current.set(directoryPath, nextVersion);
    const controller = new AbortController();
    controllersRef.current.set(requestKey, { path: directoryPath, controller });

    if (directoryPath === '') {
      if (!append) setLoading(true);
    } else {
      commitFiles((current) => updateDirectory(current, directoryPath, (node) => ({
        ...node,
        childrenLoading: true,
        childrenError: null,
      })));
    }

    let restartChangedDirectory = false;
    const request = readDirectoryPage(projectId, directoryPath, cursor, controller.signal)
      .then((page) => {
        if (controller.signal.aborted || versionsRef.current.get(directoryPath) !== nextVersion) return;
        if (directoryPath === '') {
          rootPathRef.current = page.directoryPath;
          commitFiles((current) => {
            const incoming = retainLoadedChildren(page.entries, current);
            return append ? appendUniqueEntries(current, incoming) : incoming;
          });
          setRootCursor(page.nextCursor);
          return;
        }
        commitFiles((current) => updateDirectory(current, directoryPath, (node) => {
          const incoming = retainLoadedChildren(page.entries, node.children ?? []);
          return {
            ...node,
            children: append ? appendUniqueEntries(node.children ?? [], incoming) : incoming,
            childrenLoaded: true,
            childrenLoading: false,
            childrenError: null,
            childrenNextCursor: page.nextCursor,
          };
        }));
      })
      .catch((error: RequestFailure) => {
        if (controller.signal.aborted || error.name === 'AbortError') return;
        if (append && error.code === 'FILE_TREE_DIRECTORY_CHANGED') {
          restartChangedDirectory = true;
          return;
        }
        if (directoryPath !== '') {
          commitFiles((current) => updateDirectory(current, directoryPath, (node) => ({
            ...node,
            childrenLoading: false,
            childrenError: error.message,
          })));
        }
      })
      .finally(() => {
        if (controllersRef.current.get(requestKey)?.controller === controller) {
          controllersRef.current.delete(requestKey);
        }
        if (inFlightRef.current.get(requestKey) === request) {
          inFlightRef.current.delete(requestKey);
        }
        if (
          directoryPath === ''
          && !controller.signal.aborted
          && versionsRef.current.get(directoryPath) === nextVersion
        ) {
          setLoading(false);
        }
        if (restartChangedDirectory) void loadPage(directoryPath, null, false);
      });

    inFlightRef.current.set(requestKey, request);
    return request;
  }, [abortPathRequests, commitFiles, projectId, setRootCursor]);

  const loadDirectory = useCallback(async (directoryPath: string) => {
    const node = findNode(filesRef.current, directoryPath);
    if (!node || node.childrenLoaded) return;
    await loadPage(directoryPath, null, false);
  }, [loadPage]);

  const loadMoreDirectory = useCallback(async (directoryPath: string) => {
    const node = findNode(filesRef.current, directoryPath);
    if (!node?.childrenNextCursor) return;
    await loadPage(directoryPath, node.childrenNextCursor, true);
  }, [loadPage]);

  const loadMoreRoot = useCallback(async () => {
    if (!rootNextCursorRef.current) return;
    await loadPage('', rootNextCursorRef.current, true);
  }, [loadPage]);

  const revealDirectory = useCallback(async (directoryPath: string): Promise<string[]> => {
    const normalizedRoot = rootPathRef.current.replace(/\\/g, '/').replace(/\/$/, '');
    const normalizedTarget = directoryPath.replace(/\\/g, '/').replace(/\/$/, '');
    if (
      !normalizedRoot
      || normalizedTarget === normalizedRoot
      || !normalizedTarget.startsWith(`${normalizedRoot}/`)
    ) {
      return [];
    }

    const segments = normalizedTarget.slice(normalizedRoot.length + 1).split('/').filter(Boolean);
    const revealedPaths: string[] = [];
    let parentPath = '';
    let nextPath = normalizedRoot;

    for (const segment of segments) {
      nextPath = `${nextPath}/${segment}`;
      let node = findNode(filesRef.current, nextPath);

      if (!node && parentPath === '') {
        while (!node && rootNextCursorRef.current) {
          await loadPage('', rootNextCursorRef.current, true);
          node = findNode(filesRef.current, nextPath);
        }
      } else if (!node) {
        let parent = findNode(filesRef.current, parentPath);
        if (!parent?.childrenLoaded) {
          await loadPage(parentPath, null, false);
          parent = findNode(filesRef.current, parentPath);
        }
        while (!node && parent?.childrenNextCursor) {
          await loadPage(parentPath, parent.childrenNextCursor, true);
          parent = findNode(filesRef.current, parentPath);
          node = findNode(filesRef.current, nextPath);
        }
        node = findNode(filesRef.current, nextPath);
      }

      if (!node || node.type !== 'directory') {
        throw new Error(`Could not reveal folder "${directoryPath}"`);
      }
      revealedPaths.push(node.path);
      parentPath = node.path;
    }

    if (parentPath) await loadDirectory(parentPath);
    return revealedPaths;
  }, [loadDirectory, loadPage]);

  const reloadDirectory = useCallback(async (directoryPath: string) => {
    if (!projectId) return;
    abortPathRequests(directoryPath);
    const version = (versionsRef.current.get(directoryPath) ?? 0) + 1;
    versionsRef.current.set(directoryPath, version);
    const previousEntries = directoryPath === ''
      ? filesRef.current
      : findNode(filesRef.current, directoryPath)?.children ?? [];
    const desiredCount = Math.max(previousEntries.length, DIRECTORY_PAGE_SIZE);
    const requestKey = `refresh\u0000${directoryPath}`;
    const controller = new AbortController();
    controllersRef.current.set(requestKey, { path: directoryPath, controller });

    try {
      let cursor: string | null = null;
      let nextCursor: string | null = null;
      const entries: FileTreeNode[] = [];
      do {
        const page = await readDirectoryPage(projectId, directoryPath, cursor, controller.signal);
        if (directoryPath === '') rootPathRef.current = page.directoryPath;
        entries.push(...page.entries);
        nextCursor = page.nextCursor;
        cursor = page.nextCursor;
      } while (cursor && entries.length < desiredCount);

      if (controller.signal.aborted || versionsRef.current.get(directoryPath) !== version) return;
      const refreshed = retainLoadedChildren(entries, previousEntries);
      if (directoryPath === '') {
        commitFiles(() => refreshed);
        setRootCursor(nextCursor);
      } else {
        commitFiles((current) => updateDirectory(current, directoryPath, (node) => ({
          ...node,
          children: refreshed,
          childrenLoaded: true,
          childrenLoading: false,
          childrenError: null,
          childrenNextCursor: nextCursor,
        })));
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        console.error('Error refreshing directory:', error);
      }
    } finally {
      if (controllersRef.current.get(requestKey)?.controller === controller) {
        controllersRef.current.delete(requestKey);
      }
    }
  }, [abortPathRequests, commitFiles, projectId, setRootCursor]);

  const refreshDirectories = useCallback((paths?: string[]) => {
    const loadedPaths = paths ?? ['', ...collectLoadedDirectories(filesRef.current)];
    const uniquePaths = [...new Set(loadedPaths.map((entry) =>
      entry === rootPathRef.current ? '' : entry,
    ))];
    setMutationRevision((current) => current + 1);
    void (async () => {
      for (const directoryPath of uniquePaths) {
        await reloadDirectory(directoryPath);
      }
    })();
  }, [reloadDirectory]);

  const remapPaths = useCallback((changes: FilePathChange[]) => {
    if (changes.length === 0) return;
    for (const request of controllersRef.current.values()) request.controller.abort();
    controllersRef.current.clear();
    inFlightRef.current.clear();
    versionsRef.current.clear();
    commitFiles((current) => {
      const remapNode = (node: FileTreeNode): FileTreeNode => {
        const remappedPath = remapChangedPath(node.path, changes) ?? node.path;
        return {
          ...node,
          path: remappedPath,
          children: node.children?.map(remapNode),
          childrenLoading: false,
        };
      };
      return current.map(remapNode);
    });
    setMutationRevision((current) => current + 1);
  }, [commitFiles]);

  useEffect(() => {
    const controllers = controllersRef.current;
    const inFlight = inFlightRef.current;
    for (const request of controllers.values()) request.controller.abort();
    controllers.clear();
    inFlight.clear();
    versionsRef.current.clear();
    filesRef.current = [];
    rootPathRef.current = '';
    setFiles([]);
    setRootCursor(null);
    setLoading(Boolean(projectId));
    if (projectId) void loadPage('', null, false);

    return () => {
      for (const request of controllers.values()) request.controller.abort();
      controllers.clear();
      inFlight.clear();
    };
  }, [loadPage, projectId, setRootCursor]);

  return {
    files,
    loading,
    rootNextCursor,
    mutationRevision,
    loadDirectory,
    loadMoreDirectory,
    loadMoreRoot,
    revealDirectory,
    refreshDirectories,
    remapPaths,
  };
}
