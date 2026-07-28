import type { KeyboardEvent } from 'react';
import type { FileTreeNode as FileTreeNodeType } from '../types/types';
import FileTreeNode, { type FileTreeSharedRowProps } from './FileTreeNode';

type FileTreeListProps = {
  items: FileTreeNodeType[];
  rowProps: FileTreeSharedRowProps;
  treeLabel: string;
  isMultiSelectable: boolean;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
};

export default function FileTreeList({
  items,
  rowProps,
  treeLabel,
  isMultiSelectable,
  onKeyDown,
}: FileTreeListProps) {
  return (
    // Keyboard is handled once for the whole tree rather than per row: arrow
    // navigation needs the flattened visible order, which only `FileTree` has.
    <div
      role="tree"
      aria-label={treeLabel}
      aria-multiselectable={isMultiSelectable}
      onKeyDown={onKeyDown}
    >
      {items.map((item) => (
        <FileTreeNode key={item.path} item={item} level={0} {...rowProps} />
      ))}
    </div>
  );
}
