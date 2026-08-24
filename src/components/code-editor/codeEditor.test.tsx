import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { createRoot } from 'react-dom/client';

import {
  prepareHtmlPreview,
  resolveHtmlPreviewReference,
} from './utils/htmlPreview';
import CodeEditorHtmlPreview from './view/subcomponents/CodeEditorHtmlPreview';

const PROJECT_PATH = '/workspace/project';
const HTML_PATH = '/workspace/project/pages/index.html';

test('resolves preview references inside the project without using the CLIde origin', () => {
  assert.deepEqual(
    resolveHtmlPreviewReference('../README.md#setup', HTML_PATH, PROJECT_PATH),
    { kind: 'project', filePath: '/workspace/project/README.md', suffix: '#setup' },
  );
  assert.deepEqual(
    resolveHtmlPreviewReference('/assets/logo.svg?v=2', HTML_PATH, PROJECT_PATH),
    { kind: 'project', filePath: '/workspace/project/assets/logo.svg', suffix: '?v=2' },
  );
  assert.deepEqual(
    resolveHtmlPreviewReference('#details', HTML_PATH, PROJECT_PATH),
    { kind: 'fragment', fragment: 'details' },
  );
  assert.deepEqual(
    resolveHtmlPreviewReference('https://example.com/docs', HTML_PATH, PROJECT_PATH),
    { kind: 'external', url: 'https://example.com/docs' },
  );
  assert.deepEqual(resolveHtmlPreviewReference('javascript:alert(1)', HTML_PATH, PROJECT_PATH), { kind: 'blocked' });
  assert.deepEqual(resolveHtmlPreviewReference('http://example.com', HTML_PATH, PROJECT_PATH), { kind: 'blocked' });
  assert.deepEqual(resolveHtmlPreviewReference('../../outside.txt', HTML_PATH, PROJECT_PATH), { kind: 'blocked' });
});

test('prepares static HTML with authenticated project assets and no executable document capabilities', async () => {
  const requestedPaths: string[] = [];
  const createdBlobs: Blob[] = [];
  const assets = new Map<string, Blob>([
    ['/workspace/project/pages/styles/site.css', new Blob([
      '@import "./nested.css"; .card { background: url("../images/bg.jpg"); }',
    ], { type: 'text/css' })],
    ['/workspace/project/pages/styles/nested.css', new Blob([
      '@font-face { src: url("../fonts/preview.woff2"); }',
    ], { type: 'text/css' })],
    ['/workspace/project/pages/images/bg.jpg', new Blob(['background'], { type: 'image/jpeg' })],
    ['/workspace/project/pages/fonts/preview.woff2', new Blob(['font'], { type: 'font/woff2' })],
    ['/workspace/project/pages/images/logo.svg', new Blob(['<svg/>'], { type: 'image/svg+xml' })],
    ['/workspace/project/pages/images/inline.png', new Blob(['inline'], { type: 'image/png' })],
  ]);
  const controller = new AbortController();

  const prepared = await prepareHtmlPreview({
    content: `<!doctype html>
      <html><head>
        <meta http-equiv="refresh" content="0;url=/api/auth/logout">
        <link rel="stylesheet" href="./styles/site.css">
        <style>.hero { background-image: url("./images/inline.png"); }</style>
        <script>window.parent.document.body.textContent = 'owned';</script>
      </head><body onload="alert(1)">
        <iframe src="/api/auth/user"></iframe>
        <form action="/api/auth/logout"><button formaction="/api/auth/logout">Submit</button></form>
        <img src="./images/logo.svg" onerror="alert(1)">
        <a href="../README.md">Read me</a>
      </body></html>`,
    filePath: HTML_PATH,
    projectPath: PROJECT_PATH,
    signal: controller.signal,
    loadAsset: async (filePath) => {
      requestedPaths.push(filePath);
      const asset = assets.get(filePath);
      if (!asset) throw new Error(`Missing fixture ${filePath}`);
      return asset;
    },
    createObjectUrl: (blob) => {
      createdBlobs.push(blob);
      return `blob:preview-${createdBlobs.length}`;
    },
    revokeObjectUrl: () => {},
  });

  assert.deepEqual([...new Set(requestedPaths)].sort(), [...assets.keys()].sort());
  assert.equal(prepared.warnings.length, 0);
  assert.equal(prepared.objectUrls.length, assets.size);

  const document = new window.DOMParser().parseFromString(prepared.html, 'text/html');
  assert.equal(document.querySelector('script, iframe, frame, object, embed'), null);
  assert.equal(document.querySelector('meta[http-equiv="refresh"]'), null);
  assert.match(document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ?? '', /script-src 'none'/);
  assert.equal(document.body.hasAttribute('onload'), false);
  assert.equal(document.querySelector('img')?.hasAttribute('onerror'), false);
  assert.match(document.querySelector('img')?.getAttribute('src') ?? '', /^blob:preview-/);
  assert.equal(document.querySelector('form')?.hasAttribute('action'), false);
  assert.equal(document.querySelector('button')?.hasAttribute('formaction'), false);
  assert.equal(document.querySelector('a')?.getAttribute('href'), '#');
  assert.equal(document.querySelector('a')?.getAttribute('data-clide-preview-href'), '../README.md');

  const rewrittenStylesheets = await Promise.all(
    createdBlobs.filter((blob) => blob.type === 'text/css').map((blob) => blob.text()),
  );
  assert.ok(rewrittenStylesheets.every((css) => !css.includes('../images/') && !css.includes('../fonts/')));
  assert.ok(rewrittenStylesheets.some((css) => css.includes('blob:preview-')));
});

test('reports blocked or missing project assets instead of requesting outside paths', async () => {
  const requestedPaths: string[] = [];
  const prepared = await prepareHtmlPreview({
    content: '<img src="../../outside.png"><img src="./missing.png">',
    filePath: HTML_PATH,
    projectPath: PROJECT_PATH,
    signal: new AbortController().signal,
    loadAsset: async (filePath) => {
      requestedPaths.push(filePath);
      throw new Error('not found');
    },
    createObjectUrl: () => 'blob:unused',
    revokeObjectUrl: () => {},
  });

  assert.deepEqual(requestedPaths, ['/workspace/project/pages/missing.png']);
  assert.deepEqual(prepared.warnings.sort(), ['../../outside.png', './missing.png']);
  const document = new window.DOMParser().parseFromString(prepared.html, 'text/html');
  assert.ok([...document.querySelectorAll('img')].every((image) => !image.hasAttribute('src')));
});

test('renders the preview inline with scripts omitted from the iframe sandbox', async () => {
  const originalCreateObjectUrl = URL.createObjectURL;
  const originalRevokeObjectUrl = URL.revokeObjectURL;
  const revoked: string[] = [];
  let assetLoads = 0;
  URL.createObjectURL = () => `blob:inline-${assetLoads}`;
  URL.revokeObjectURL = (url) => revoked.push(url);

  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const renderPreview = async (reloadKey: number) => {
    await React.act(async () => {
      root.render(
        <CodeEditorHtmlPreview
          content='<img src="./logo.png"><p>Preview</p>'
          file={{ name: 'index.html', path: HTML_PATH, projectId: 'project-1' }}
          projectId="project-1"
          projectPath={PROJECT_PATH}
          reloadKey={reloadKey}
          loadAsset={async () => {
            assetLoads += 1;
            return new Blob(['image'], { type: 'image/png' });
          }}
          labels={{
            loading: 'Loading',
            error: 'Error',
            assetWarning: (count) => `${count} missing`,
          }}
        />,
      );
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
  };

  try {
    await renderPreview(0);
    const iframe = host.querySelector('iframe');
    assert.ok(iframe);
    assert.equal(iframe.getAttribute('sandbox'), 'allow-same-origin');
    assert.doesNotMatch(iframe.getAttribute('sandbox') ?? '', /allow-scripts|allow-forms|allow-popups/);
    assert.match(iframe.getAttribute('srcdoc') ?? '', /Content-Security-Policy/);

    await renderPreview(1);
    assert.equal(assetLoads, 2);
    assert.ok(revoked.length >= 1);
  } finally {
    await React.act(async () => root.unmount());
    host.remove();
    URL.createObjectURL = originalCreateObjectUrl;
    URL.revokeObjectURL = originalRevokeObjectUrl;
  }
});
