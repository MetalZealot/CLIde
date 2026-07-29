import type { KeyboardEvent } from 'react';
import { Folder, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { FileTreeNode } from '../types/types';
import FileTreeEmptyState from './FileTreeEmptyState';
import FileTreeList from './FileTreeList';
import type { FileTreeSharedRowProps } from './FileTreeNode';

type FileTreeBodyProps = {
  files: FileTreeNode[];
  filteredFiles: FileTreeNode[];
  searchQuery: string;
  rowProps: FileTreeSharedRowProps;
  isMultiSelectable: boolean;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
};

export default function FileTreeBody({
  files,
  filteredFiles,
  searchQuery,
  rowProps,
  isMultiSelectable,
  onKeyDown,
}: FileTreeBodyProps) {
  const { t } = useTranslation();

  return (
    <>
      {files.length === 0 ? (
        <FileTreeEmptyState
          icon={Folder}
          title={t('fileTree.noFilesFound')}
          description={t('fileTree.checkProjectPath')}
        />
      ) : filteredFiles.length === 0 && searchQuery ? (
        <FileTreeEmptyState
          icon={Search}
          title={t('fileTree.noMatchesFound')}
          description={t('fileTree.tryDifferentSearch')}
        />
      ) : (
        <FileTreeList
          items={filteredFiles}
          rowProps={rowProps}
          treeLabel={t('fileTree.treeLabel', 'Project files')}
          isMultiSelectable={isMultiSelectable}
          onKeyDown={onKeyDown}
        />
      )}
    </>
  );
}
