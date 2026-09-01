import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import React from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { useFileOpenResolver } from '../../hooks/useFileOpenResolver';
import type { Project } from '../../types/app';
import { api } from '../../utils/api';
import { useFilesSource } from '../command-palette/sources/useFilesSource';
import { useFileMentions } from '../chat/hooks/useFileMentions';

import { useFileTreeData } from './hooks/useFileTreeData';
import { useFileTreeSearch } from './hooks/useFileTreeSearch';
import FileTreeBody from './view/FileTreeBody';

const project = {
  projectId: 'project-1',
  displayName: 'Project',
  fullPath: '/workspace/project',
} as Project;

const originalGetDirectoryPage = api.getDirectoryPage;
const originalSearchProjectFiles = api.searchProjectFiles;
const originalResolveProjectFile = api.resolveProjectFile;
let root: Root | null = null;
let host: HTMLDivElement | null = null;

const response = (body: unknown, ok = true) => ({
  ok,
  json: async () => body,
}) as Response;

async function mount(element: React.ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await React.act(async () => root?.render(element));
}

afterEach(async () => {
  await React.act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  api.getDirectoryPage = originalGetDirectoryPage;
  api.searchProjectFiles = originalSearchProjectFiles;
  api.resolveProjectFile = originalResolveProjectFile;
});

test('Files loads only the root, then deduplicates a repeated folder expansion', async () => {
  const calls: string[] = [];
  api.getDirectoryPage = async (_projectId: unknown, rawOptions?: unknown) => {
    const options = rawOptions as { path: string };
    calls.push(options.path);
    return response(options.path === ''
      ? {
          directoryPath: '/workspace/project',
          relativePath: '',
          entries: [{ name: 'src', path: '/workspace/project/src', type: 'directory' }],
          nextCursor: null,
        }
      : {
          directoryPath: '/workspace/project/src',
          relativePath: 'src',
          entries: [{ name: 'index.ts', path: '/workspace/project/src/index.ts', type: 'file' }],
          nextCursor: null,
        });
  };

  let current: ReturnType<typeof useFileTreeData> | null = null;
  function Harness() {
    current = useFileTreeData(project);
    return null;
  }
  await mount(<Harness />);
  await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.deepEqual(calls, ['']);

  await React.act(async () => {
    await Promise.all([
      current!.loadDirectory('/workspace/project/src'),
      current!.loadDirectory('/workspace/project/src'),
    ]);
  });

  assert.deepEqual(calls, ['', '/workspace/project/src']);
  assert.equal(current!.files[0]?.children?.[0]?.name, 'index.ts');
});

test('a canceled old-project root request cannot clear the new project loading state', async () => {
  const secondProject = {
    ...project,
    projectId: 'project-2',
    displayName: 'Second project',
    fullPath: '/workspace/second',
  } as Project;
  let resolveSecond: ((value: Response) => void) | undefined;
  api.getDirectoryPage = (projectId: unknown, rawOptions?: unknown) => {
    const options = rawOptions as { signal: AbortSignal };
    if (projectId === 'project-2') {
      return new Promise<Response>((resolve) => { resolveSecond = resolve; });
    }
    return new Promise<Response>((_resolve, reject) => {
      options.signal.addEventListener(
        'abort',
        () => reject(new DOMException('aborted', 'AbortError')),
        { once: true },
      );
    });
  };

  let current: ReturnType<typeof useFileTreeData> | null = null;
  function Harness({ selectedProject }: { selectedProject: Project }) {
    current = useFileTreeData(selectedProject);
    return null;
  }
  await mount(<Harness selectedProject={project} />);
  await React.act(async () => {
    root?.render(<Harness selectedProject={secondProject} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  assert.equal(current!.loading, true);
  await React.act(async () => {
    resolveSecond?.(response({
      directoryPath: '/workspace/second',
      relativePath: '',
      entries: [],
      nextCursor: null,
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  assert.equal(current!.loading, false);
});

test('remapping paths clears the loading state of an aborted folder request', async () => {
  api.getDirectoryPage = async (_projectId: unknown, rawOptions?: unknown) => {
    const options = rawOptions as { path: string; signal: AbortSignal };
    if (options.path === '') {
      return response({
        directoryPath: '/workspace/project',
        relativePath: '',
        entries: [{ name: 'src', path: '/workspace/project/src', type: 'directory' }],
        nextCursor: null,
      });
    }
    return new Promise<Response>((_resolve, reject) => {
      options.signal.addEventListener(
        'abort',
        () => reject(new DOMException('aborted', 'AbortError')),
        { once: true },
      );
    });
  };

  let current: ReturnType<typeof useFileTreeData> | null = null;
  function Harness() {
    current = useFileTreeData(project);
    return null;
  }
  await mount(<Harness />);
  await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  let load: Promise<void> | undefined;
  await React.act(async () => {
    load = current!.loadDirectory('/workspace/project/src');
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  assert.equal(current!.files[0]?.childrenLoading, true);

  await React.act(async () => {
    current!.remapPaths([{
      oldPath: '/workspace/project/src',
      newPath: '/workspace/project/source',
      type: 'directory',
    }]);
    await load;
  });
  assert.equal(current!.files[0]?.path, '/workspace/project/source');
  assert.equal(current!.files[0]?.childrenLoading, false);
});

test('a deep folder search result can reveal its ancestry in the browse tree', async () => {
  const calls: string[] = [];
  api.getDirectoryPage = async (_projectId: unknown, rawOptions?: unknown) => {
    const options = rawOptions as { path: string };
    calls.push(options.path);
    if (options.path === '') {
      return response({
        directoryPath: '/workspace/project',
        relativePath: '',
        entries: [{ name: 'packages', path: '/workspace/project/packages', type: 'directory' }],
        nextCursor: null,
      });
    }
    if (options.path === '/workspace/project/packages') {
      return response({
        directoryPath: '/workspace/project/packages',
        relativePath: 'packages',
        entries: [{ name: 'app', path: '/workspace/project/packages/app', type: 'directory' }],
        nextCursor: null,
      });
    }
    return response({
      directoryPath: '/workspace/project/packages/app',
      relativePath: 'packages/app',
      entries: [{ name: 'index.ts', path: '/workspace/project/packages/app/index.ts', type: 'file' }],
      nextCursor: null,
    });
  };

  let current: ReturnType<typeof useFileTreeData> | null = null;
  function Harness() {
    current = useFileTreeData(project);
    return null;
  }
  await mount(<Harness />);
  await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

  let revealed: string[] = [];
  await React.act(async () => {
    revealed = await current!.revealDirectory('/workspace/project/packages/app');
  });

  assert.deepEqual(revealed, [
    '/workspace/project/packages',
    '/workspace/project/packages/app',
  ]);
  assert.deepEqual(calls, [
    '',
    '/workspace/project/packages',
    '/workspace/project/packages/app',
  ]);
  assert.equal(current!.files[0]?.children?.[0]?.children?.[0]?.name, 'index.ts');
});

test('the Command Palette file source waits 200 ms and uses paged project search', async () => {
  const calls: Array<{ query: string; cursor: string | null }> = [];
  api.searchProjectFiles = async (
    _projectId: unknown,
    rawOptions?: unknown,
  ) => {
    const options = rawOptions as { query: string; cursor?: string | null };
    calls.push({ query: options.query, cursor: options.cursor ?? null });
    return response({
      results: [{
        name: calls.length === 1 ? 'README.md' : 'README-2.md',
        path: `/workspace/project/${calls.length === 1 ? 'README.md' : 'README-2.md'}`,
        relativePath: calls.length === 1 ? 'README.md' : 'README-2.md',
        type: 'file',
      }],
      nextCursor: calls.length === 1 ? 'next-page' : null,
    });
  };

  let current: ReturnType<typeof useFilesSource> | null = null;
  function Harness() {
    current = useFilesSource('project-1', 'read', true);
    return null;
  }
  await mount(<Harness />);
  assert.equal(calls.length, 0);
  await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 230)); });
  assert.deepEqual(calls, [{ query: 'read', cursor: null }]);
  assert.equal(current!.files[0]?.relativePath, 'README.md');

  await React.act(async () => {
    current!.loadMore();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  assert.deepEqual(calls[1], { query: 'read', cursor: 'next-page' });
  assert.equal(current!.files.length, 2);
});

test('a newer hyperlink cancels the old resolution and only the latest file opens', async () => {
  const pending = new Map<string, {
    signal: AbortSignal;
    resolve: (value: Response) => void;
  }>();
  api.resolveProjectFile = (
    _projectId: unknown,
    filePath: unknown,
    rawOptions?: unknown,
  ) => new Promise<Response>((resolve) => {
    const options = rawOptions as { signal: AbortSignal };
    pending.set(String(filePath), { signal: options.signal, resolve });
  });

  const opened: string[] = [];
  let openFile: ((path: string) => void) | null = null;
  function Harness() {
    openFile = useFileOpenResolver(project, (filePath) => opened.push(filePath));
    return null;
  }
  await mount(<Harness />);

  openFile!('first.md');
  openFile!('second.md');
  assert.equal(pending.get('first.md')?.signal.aborted, true);
  await React.act(async () => {
    pending.get('second.md')?.resolve(response({
      status: 'resolved',
      match: { path: '/workspace/project/second.md' },
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  pending.get('first.md')?.resolve(response({
    status: 'resolved',
    match: { path: '/workspace/project/first.md' },
  }));
  await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

  assert.deepEqual(opened, ['/workspace/project/second.md']);
});

test('a missing hyperlink opens the raw reference so the editor can show its error', async () => {
  api.resolveProjectFile = async () => response({ status: 'not-found', matches: [] });
  const opened: string[] = [];
  let openFile: ((path: string) => void) | null = null;
  function Harness() {
    openFile = useFileOpenResolver(project, (filePath) => opened.push(filePath));
    return null;
  }
  await mount(<Harness />);

  await React.act(async () => {
    openFile!('deleted.md');
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  assert.deepEqual(opened, ['deleted.md']);
});

test('a hyperlink without a selected project still reaches the editor', async () => {
  const opened: string[] = [];
  let openFile: ((path: string) => void) | null = null;
  function Harness() {
    openFile = useFileOpenResolver(null, (filePath) => opened.push(filePath));
    return null;
  }
  await mount(<Harness />);

  await React.act(async () => openFile!('README.md'));

  assert.deepEqual(opened, ['README.md']);
});

test('an ambiguous hyperlink opens nothing and reports a visible issue', async () => {
  api.resolveProjectFile = async () => response({
    status: 'ambiguous',
    matches: [{ relativePath: 'first/Button.tsx' }, { relativePath: 'second/Button.tsx' }],
  });
  const opened: string[] = [];
  const issues: Array<{ kind: string; reference: string }> = [];
  let openFile: ((path: string) => void) | null = null;
  function Harness() {
    openFile = useFileOpenResolver(
      project,
      (filePath) => opened.push(filePath),
      (issue) => issues.push(issue),
    );
    return null;
  }
  await mount(<Harness />);

  await React.act(async () => {
    openFile!('Button.tsx');
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  assert.deepEqual(opened, []);
  assert.deepEqual(issues, [{ kind: 'ambiguous', reference: 'Button.tsx' }]);
});

test('a whitespace-only Files query keeps the ordinary empty-project state', async () => {
  await mount(
    <FileTreeBody
      files={[]}
      filteredFiles={[]}
      searchQuery="   "
      searchLoading={false}
      searchError={null}
      hasMoreSearchResults={false}
      rootNextCursor={null}
      onLoadMoreSearchResults={() => undefined}
      onLoadMoreRoot={() => undefined}
      rowProps={{} as never}
      isMultiSelectable={false}
    />,
  );

  assert.match(host?.textContent ?? '', /fileTree\.noFilesFound/i);
  assert.doesNotMatch(host?.textContent ?? '', /fileTree\.noMatchesFound/i);
});

test('refreshing Files forces the active search to rebuild its server index', async () => {
  const refreshValues: boolean[] = [];
  api.searchProjectFiles = async (_projectId: unknown, rawOptions?: unknown) => {
    const options = rawOptions as { refresh?: boolean };
    refreshValues.push(Boolean(options.refresh));
    return response({ results: [], nextCursor: null });
  };

  function Harness({ revision }: { revision: number }) {
    const { setSearchQuery } = useFileTreeSearch({
      files: [],
      selectedProject: project,
      mutationRevision: revision,
    });
    React.useEffect(() => setSearchQuery('external'), [setSearchQuery]);
    return null;
  }

  await mount(<Harness revision={0} />);
  await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 230)); });
  assert.deepEqual(refreshValues, [false]);

  await React.act(async () => root?.render(<Harness revision={1} />));
  await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 230)); });
  assert.deepEqual(refreshValues, [false, true]);
});

test('@file mentions search only after the user types a project query', async () => {
  const queries: string[] = [];
  api.searchProjectFiles = async (_projectId: unknown, rawOptions?: unknown) => {
    const options = rawOptions as { query: string; respectGitignore: boolean };
    queries.push(options.query);
    assert.equal(options.respectGitignore, true);
    return response({
      results: [{
        name: 'README.md',
        path: '/workspace/project/README.md',
        relativePath: 'README.md',
        type: 'file',
      }],
      nextCursor: null,
    });
  };

  let current: ReturnType<typeof useFileMentions> | null = null;
  function Harness() {
    const [input, setInput] = React.useState('@read');
    const textareaRef = React.useRef<HTMLTextAreaElement>(null);
    current = useFileMentions({ selectedProject: project, input, setInput, textareaRef });
    return <textarea ref={textareaRef} value={input} onChange={() => undefined} />;
  }
  await mount(<Harness />);
  assert.deepEqual(queries, []);
  await React.act(async () => current!.setCursorPosition(5));
  await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 230)); });

  assert.deepEqual(queries, ['read']);
  assert.equal(current!.filteredFiles[0]?.path, 'README.md');
});
