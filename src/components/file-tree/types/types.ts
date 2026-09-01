import type { LucideIcon } from 'lucide-react';

export type FileTreeViewMode = 'simple' | 'compact' | 'detailed';

export type FileTreeItemType = 'file' | 'directory';

export interface FileTreeNode {
  name: string;
  type: FileTreeItemType;
  path: string;
  relativePath?: string;
  size?: number;
  modified?: string;
  permissionsRwx?: string;
  children?: FileTreeNode[];
  childrenLoaded?: boolean;
  childrenLoading?: boolean;
  childrenError?: string | null;
  childrenNextCursor?: string | null;
  [key: string]: unknown;
}

export type FileTreeDirectoryPage = {
  directoryPath: string;
  relativePath: string;
  entries: FileTreeNode[];
  nextCursor: string | null;
};

export type FileTreeSearchResult = {
  name: string;
  path: string;
  relativePath: string;
  type: FileTreeItemType;
};

export type FileTreeSearchPage = {
  results: FileTreeSearchResult[];
  nextCursor: string | null;
};

export interface FileTreeImageSelection {
  name: string;
  path: string;
  projectPath?: string;
  // DB projectId; used by ImageViewer to build the raw content URL.
  projectId: string;
}

export interface FileIconData {
  icon: LucideIcon;
  color: string;
}

export type FileIconMap = Record<string, FileIconData>;
