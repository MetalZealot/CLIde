import { useCallback, useEffect, useState } from 'react';
import { Download, Maximize2, Minimize2, X } from 'lucide-react';

import { authenticatedFetch } from '../../../../utils/api';
import type { CodeEditorFile } from '../../types/types';
import { getPreviewMimeType, type PreviewKind } from '../../utils/previewableFile';

import CodeEditorImageCanvas from './CodeEditorImageCanvas';

type CodeEditorMediaPreviewProps = {
  file: CodeEditorFile;
  kind: PreviewKind;
  // DB projectId used to build the raw-content URL; falls back to projectPath
  // for older callers, mirroring useCodeEditorDocument.
  projectId?: string;
  isSidebar: boolean;
  isFullscreen: boolean;
  onClose: () => void;
  onToggleFullscreen: () => void;
  labels: {
    loading: string;
    error: string;
    openInNewTab: string;
    download: string;
    fullscreen: string;
    exitFullscreen: string;
    close: string;
  };
};

// Reject a "PDF" whose bytes aren't actually a PDF before handing it to the
// same-origin iframe, so a mislabeled HTML/SVG file can't run in the app origin.
const PDF_HEADER_SCAN_BYTES = 1024;

const looksLikePdf = async (blob: Blob): Promise<boolean> => {
  const header = await blob.slice(0, PDF_HEADER_SCAN_BYTES).arrayBuffer();
  // PDFs must contain the "%PDF-" marker at the very start of the file.
  return new TextDecoder('latin1').decode(header).includes('%PDF-');
};

export default function CodeEditorMediaPreview({
  file,
  kind,
  projectId,
  isSidebar,
  isFullscreen,
  onClose,
  onToggleFullscreen,
  labels,
}: CodeEditorMediaPreviewProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Identifies which file the current `url` was loaded for. Rendering is gated on
  // this so a blob from a previously-opened file can never show under the new
  // file (the editor reuses this component instance across files).
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  // Fullscreen goes immersive: the header hides until the user asks for it back.
  const [chromeVisible, setChromeVisible] = useState(false);
  const sourceKey = `${projectId ?? ''}:${file.path}:${kind}`;

  useEffect(() => {
    if (!projectId) {
      setUrl(null);
      setLoadedKey(null);
      setError(labels.error);
      setLoading(false);
      return;
    }

    let objectUrl: string | null = null;
    const controller = new AbortController();

    const loadMedia = async () => {
      try {
        setLoading(true);
        setError(null);
        setUrl(null);

        // The content endpoint requires the auth header, so we fetch the bytes
        // ourselves and hand the media element a blob URL instead of a bare src.
        // Fetching a blob (rather than streaming) also lets <video>/<audio> seek.
        const contentUrl = `/api/file-tree/projects/${projectId}/files/content?path=${encodeURIComponent(file.path)}`;
        const response = await authenticatedFetch(contentUrl, { signal: controller.signal });

        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }

        const blob = await response.blob();

        // Pick the MIME type to expose to the browser. Preserve a valid
        // Content-Type from the server, but supply an extension-specific
        // default when it is missing or generic (application/octet-stream),
        // otherwise formats like webm/ogg/flac/svg won't render.
        const fallbackMime = getPreviewMimeType(file.name);
        const isGenericType = !blob.type || blob.type === 'application/octet-stream';
        const isMislabeledVideo = kind === 'video' && Boolean(fallbackMime) && !blob.type.startsWith('video/');
        let outType = isGenericType || isMislabeledVideo ? (fallbackMime ?? blob.type) : blob.type;

        if (kind === 'pdf') {
          // The PDF renders in a same-origin <iframe>, so verify the bytes are
          // really a PDF and pin the type to application/pdf. That forces the
          // browser's PDF handler and prevents a mislabeled HTML/SVG file from
          // executing scripts in the app's origin.
          if (!(await looksLikePdf(blob))) {
            throw new Error('File is not a valid PDF');
          }
          outType = 'application/pdf';
        }

        const typed = outType && outType !== blob.type ? new Blob([blob], { type: outType }) : blob;
        objectUrl = URL.createObjectURL(typed);

        // The cleanup may have already run (deps changed during an await), in
        // which case it revoked nothing because objectUrl was still null. Don't
        // publish a URL the cleanup will never revoke — drop it ourselves.
        if (controller.signal.aborted) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = null;
          return;
        }

        setUrl(objectUrl);
        setLoadedKey(sourceKey);
      } catch (loadError: unknown) {
        if (loadError instanceof Error && loadError.name === 'AbortError') {
          return;
        }
        console.error('Error loading preview:', loadError);
        setError(labels.error);
      } finally {
        setLoading(false);
      }
    };

    loadMedia();

    return () => {
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [file.path, file.name, projectId, kind, sourceKey, labels.error]);

  useEffect(() => {
    if (!isFullscreen) setChromeVisible(false);
  }, [isFullscreen]);

  // Only expose the blob once it matches the file currently being shown, so a
  // stale URL from the previous file is never rendered during a switch.
  const currentUrl = url && loadedKey === sourceKey ? url : null;

  // SVGs render safely inline via <img> (scripts don't execute there), but the
  // open-in-new-tab link is a top-level navigation. A blob URL inherits the
  // app's origin, so a user-controlled SVG with an embedded <script> would run
  // as same-origin script. Withhold the new-tab action for SVGs.
  const isSvg = getPreviewMimeType(file.name) === 'image/svg+xml';
  const canOpenInNewTab = Boolean(currentUrl) && !isSvg;

  const handleDownload = useCallback(() => {
    if (!currentUrl) return;
    const anchor = document.createElement('a');
    anchor.href = currentUrl;
    anchor.download = file.name;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  }, [currentUrl, file.name]);

  const immersive = !isSidebar && isFullscreen && !chromeVisible;

  const iconButtonClassName = 'flex items-center justify-center rounded-md p-1.5 text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white';

  const renderMedia = () => {
    if (!currentUrl) return null;
    switch (kind) {
      case 'image':
        return (
          <CodeEditorImageCanvas
            src={currentUrl}
            alt={file.name}
            onTap={isFullscreen && !isSidebar ? () => setChromeVisible((previous) => !previous) : undefined}
          />
        );
      case 'pdf':
        // Not sandboxed on purpose: the browser's built-in PDF viewer refuses to
        // load inside a sandboxed frame (any `sandbox` value yields a broken
        // viewer). Script execution is instead prevented upstream by validating
        // the PDF magic bytes and pinning the blob's MIME type to application/pdf.
        return <iframe src={currentUrl} title={file.name} className="h-full w-full border-0 bg-white" />;
      case 'video':
        return (
          <video src={currentUrl} controls className="max-h-full max-w-full" autoPlay={false}>
            {labels.error}
          </video>
        );
      case 'audio':
        return (
          <div className="flex w-full max-w-xl flex-col items-center gap-4 px-6">
            <p className="max-w-full truncate text-sm text-muted-foreground">{file.name}</p>
            <audio src={currentUrl} controls className="w-full">
              {labels.error}
            </audio>
          </div>
        );
      default:
        return null;
    }
  };

  const previewBody = (
    <div className={`relative flex h-full w-full flex-col items-center justify-center bg-muted/30 ${immersive ? 'p-0' : 'p-2'}`}>
      {loading && (
        <div className="text-sm text-muted-foreground">{labels.loading}</div>
      )}

      {!loading && currentUrl && renderMedia()}

      {!loading && !currentUrl && (
        <div className="flex flex-col items-center gap-3 p-8 text-center text-muted-foreground">
          <p className="text-sm">{error || labels.error}</p>
          <p className="break-all text-xs">{file.path}</p>
        </div>
      )}
    </div>
  );

  const headerActions = (
    <div className="flex shrink-0 items-center gap-0.5">
      {canOpenInNewTab && currentUrl && (
        <a
          href={currentUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={iconButtonClassName}
          aria-label={labels.openInNewTab}
          title={labels.openInNewTab}
        >
          <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      )}
      <button
        type="button"
        onClick={handleDownload}
        disabled={!currentUrl}
        className={`${iconButtonClassName} disabled:opacity-40`}
        aria-label={labels.download}
        title={labels.download}
      >
        <Download className="h-4 w-4" />
      </button>
      {!isSidebar && (
        <button
          type="button"
          onClick={onToggleFullscreen}
          className={iconButtonClassName}
          aria-label={isFullscreen ? labels.exitFullscreen : labels.fullscreen}
          title={isFullscreen ? labels.exitFullscreen : labels.fullscreen}
        >
          {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
      )}
      <button
        type="button"
        onClick={onClose}
        className={iconButtonClassName}
        aria-label={labels.close}
        title={labels.close}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );

  const header = (
    <div className="flex min-w-0 flex-shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5">
      <div className="min-w-0 flex-1 shrink">
        <h3 className="truncate text-sm font-medium text-gray-900 dark:text-white">{file.name}</h3>
        <p className="truncate text-xs text-gray-500 dark:text-gray-400" title={file.path}>{file.path}</p>
      </div>
      {headerActions}
    </div>
  );

  if (isSidebar) {
    return (
      <div className="flex h-full w-full flex-col bg-background">
        {header}
        {previewBody}
      </div>
    );
  }

  const containerClassName = isFullscreen
    ? 'fixed inset-0 safe-top z-[9999] bg-background flex flex-col'
    : 'fixed inset-0 safe-top z-[9999] md:bg-black/50 md:flex md:items-center md:justify-center md:p-4';

  const innerClassName = isFullscreen
    ? 'relative bg-background flex flex-col w-full h-full'
    : 'bg-background shadow-2xl flex flex-col w-full h-full md:rounded-lg md:shadow-2xl md:w-full md:max-w-6xl md:h-[80vh] md:max-h-[80vh]';

  return (
    <div className={containerClassName}>
      <div className={innerClassName}>
        {!immersive && header}
        {previewBody}
        {/* An image restores the header on tap; other media has no tap target,
            so it keeps a floating way out of immersive mode. */}
        {immersive && kind !== 'image' && (
          <button
            type="button"
            onClick={() => setChromeVisible(true)}
            className="absolute right-3 top-3 rounded-md bg-black/50 p-2 text-white hover:bg-black/70"
            aria-label={labels.exitFullscreen}
            title={labels.exitFullscreen}
          >
            <Minimize2 className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
