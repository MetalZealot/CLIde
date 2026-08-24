import { useCallback, useEffect, useRef, useState } from 'react';

import { authenticatedFetch } from '../../../../utils/api';
import type { CodeEditorFile } from '../../types/types';
import {
  prepareHtmlPreview,
  resolveHtmlPreviewReference,
  type HtmlPreviewAssetLoader,
} from '../../utils/htmlPreview';

type CodeEditorHtmlPreviewProps = {
  content: string;
  file: CodeEditorFile;
  projectId?: string;
  projectPath?: string;
  reloadKey: number;
  onFileOpen?: (filePath: string) => void;
  loadAsset?: HtmlPreviewAssetLoader;
  labels: {
    loading: string;
    error: string;
    assetWarning: (count: number) => string;
  };
};

const loadProjectAsset = (projectId: string): HtmlPreviewAssetLoader => async (filePath, signal) => {
  const url = `/api/file-tree/projects/${encodeURIComponent(projectId)}/files/content?path=${encodeURIComponent(filePath)}`;
  const response = await authenticatedFetch(url, { signal });
  if (!response.ok) throw new Error(`Asset request failed with status ${response.status}`);
  return response.blob();
};

const decodeFragment = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export default function CodeEditorHtmlPreview({
  content,
  file,
  projectId,
  projectPath,
  reloadKey,
  onFileOpen,
  loadAsset,
  labels,
}: CodeEditorHtmlPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId || !projectPath) {
      setHtml(null);
      setWarnings([]);
      setError(labels.error);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    let objectUrls: string[] = [];

    setHtml(null);
    setWarnings([]);
    setError(null);
    setLoading(true);

    void prepareHtmlPreview({
      content,
      filePath: file.path,
      projectPath,
      loadAsset: loadAsset ?? loadProjectAsset(projectId),
      signal: controller.signal,
    }).then((prepared) => {
      if (controller.signal.aborted) {
        prepared.objectUrls.forEach(URL.revokeObjectURL);
        return;
      }
      objectUrls = prepared.objectUrls;
      setHtml(prepared.html);
      setWarnings(prepared.warnings);
    }).catch((preparationError: unknown) => {
      if (preparationError instanceof Error && preparationError.name === 'AbortError') return;
      console.error('Error preparing HTML preview:', preparationError);
      setError(labels.error);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });

    return () => {
      controller.abort();
      objectUrls.forEach(URL.revokeObjectURL);
    };
  }, [content, file.path, labels.error, loadAsset, projectId, projectPath, reloadKey]);

  const handlePreviewLoad = useCallback(() => {
    const iframe = iframeRef.current;
    const previewDocument = iframe?.contentDocument;
    const previewWindow = iframe?.contentWindow;
    if (!previewDocument || !previewWindow || !projectPath) return;

    const handleClick = (event: MouseEvent) => {
      const target = event.target;
      if (!target || typeof (target as Element).closest !== 'function') return;
      const anchor = (target as Element).closest<HTMLAnchorElement>('a[data-clide-preview-href]');
      if (!anchor) return;

      event.preventDefault();
      const reference = anchor.dataset.clidePreviewHref ?? '';
      const resolved = resolveHtmlPreviewReference(reference, file.path, projectPath);

      if (resolved.kind === 'fragment') {
        previewDocument.getElementById(decodeFragment(resolved.fragment))?.scrollIntoView();
        return;
      }
      if (resolved.kind === 'project') {
        if (resolved.filePath === file.path && resolved.suffix.startsWith('#')) {
          previewDocument.getElementById(decodeFragment(resolved.suffix.slice(1)))?.scrollIntoView();
        } else {
          onFileOpen?.(resolved.filePath);
        }
        return;
      }
      if (resolved.kind === 'external') {
        const externalWindow = window.open(resolved.url, '_blank', 'noopener,noreferrer');
        if (externalWindow) externalWindow.opener = null;
      }
    };

    const blockFormSubmit = (event: SubmitEvent) => event.preventDefault();
    previewDocument.addEventListener('click', handleClick);
    previewDocument.addEventListener('submit', blockFormSubmit);
  }, [file.path, onFileOpen, projectPath]);

  return (
    <div className="relative flex h-full w-full flex-col bg-white">
      {warnings.length > 0 && (
        <div
          role="status"
          className="shrink-0 border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
          title={warnings.join('\n')}
        >
          {labels.assetWarning(warnings.length)}
        </div>
      )}

      {loading && (
        <div className="flex flex-1 items-center justify-center text-sm text-gray-600">{labels.loading}</div>
      )}

      {!loading && error && (
        <div role="alert" className="flex flex-1 items-center justify-center p-6 text-center text-sm text-red-700">
          {error}
        </div>
      )}

      {!loading && html && (
        <iframe
          ref={iframeRef}
          title={`${file.name} preview`}
          sandbox="allow-same-origin"
          referrerPolicy="no-referrer"
          srcDoc={html}
          onLoad={handlePreviewLoad}
          className="min-h-0 flex-1 border-0 bg-white"
        />
      )}
    </div>
  );
}
