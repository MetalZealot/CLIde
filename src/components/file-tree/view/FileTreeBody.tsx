import type { KeyboardEvent } from 'react';
import { Folder, Loader2, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { FileTreeNode } from '../types/types';

import FileTreeEmptyState from './FileTreeEmptyState';
import FileTreeList from './FileTreeList';
import type { FileTreeSharedRowProps } from './FileTreeNode';

type FileTreeBodyProps = {
  files: FileTreeNode[];
  filteredFiles: FileTreeNode[];
  searchQuery: string;
  searchLoading: boolean;
  searchError: string | null;
  hasMoreSearchResults: boolean;
  rootNextCursor: string | null;
  onLoadMoreSearchResults: () => void;
  onLoadMoreRoot: () => void;
  rowProps: FileTreeSharedRowProps;
  isMultiSelectable: boolean;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
};

export default function FileTreeBody({
  files,
  filteredFiles,
  searchQuery,
  searchLoading,
  searchError,
  hasMoreSearchResults,
  rootNextCursor,
  onLoadMoreSearchResults,
  onLoadMoreRoot,
  rowProps,
  isMultiSelectable,
  onKeyDown,
}: FileTreeBodyProps) {
  const { t } = useTranslation();
  const hasSearchQuery = Boolean(searchQuery.trim());

  return (
    <>
      {hasSearchQuery && searchLoading && filteredFiles.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('fileTree.searching', 'Searching project…')}
        </div>
      ) : hasSearchQuery && searchError ? (
        <FileTreeEmptyState
          icon={Search}
          title={t('fileTree.searchFailed', 'Search failed')}
          description={searchError}
        />
      ) : files.length === 0 && !hasSearchQuery ? (
        <FileTreeEmptyState
          icon={Folder}
          title={t('fileTree.noFilesFound')}
          description={t('fileTree.checkProjectPath')}
        />
      ) : filteredFiles.length === 0 && hasSearchQuery ? (
        <FileTreeEmptyState
          icon={Search}
          title={t('fileTree.noMatchesFound')}
          description={t('fileTree.tryDifferentSearch')}
        />
      ) : (
        <>
          <FileTreeList
            items={filteredFiles}
            rowProps={rowProps}
            treeLabel={t('fileTree.treeLabel', 'Project files')}
            isMultiSelectable={isMultiSelectable}
            onKeyDown={onKeyDown}
          />
          {(hasSearchQuery ? hasMoreSearchResults : Boolean(rootNextCursor)) && (
            <button
              type="button"
              disabled={searchLoading}
              onClick={hasSearchQuery ? onLoadMoreSearchResults : onLoadMoreRoot}
              className="my-1 w-full rounded-md py-2 text-sm font-medium text-primary hover:bg-accent disabled:opacity-50"
            >
              {searchLoading
                ? t('fileTree.loadingChildren', 'Loading…')
                : t('fileTree.loadMore', 'Load more')}
            </button>
          )}
        </>
      )}
    </>
  );
}
