import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '../../../shared/view/ui';
import { authenticatedFetch } from '../../../utils/api';
import type { FileTreeImageSelection } from '../types/types';

type ImageViewerProps = {
  file: FileTreeImageSelection;
  onClose: () => void;
};

export default function ImageViewer({ file, onClose }: ImageViewerProps) {
  const imagePath = `/api/file-tree/projects/${file.projectId}/files/content?path=${encodeURIComponent(file.path)}`;
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let objectUrl: string | null = null;
    const controller = new AbortController();

    const loadImage = async () => {
      try {
        setLoading(true);
        setError(null);
        setImageUrl(null);

        const response = await authenticatedFetch(imagePath, {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }

        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);
        setImageUrl(objectUrl);
      } catch (loadError: unknown) {
        if (loadError instanceof Error && loadError.name === 'AbortError') {
          return;
        }
        console.error('Error loading image:', loadError);
        setError('Unable to load image');
      } finally {
        setLoading(false);
      }
    };

    loadImage();

    return () => {
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [imagePath]);

  // Window capture runs before the composer's document-level Escape-to-Stop listener.
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', handleEscape, { capture: true });
    return () => window.removeEventListener('keydown', handleEscape, { capture: true });
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={file.name}
        className="mx-4 max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-lg bg-white shadow-xl dark:bg-gray-800"
      >
        <div className="flex items-center justify-between gap-3 border-b p-4">
          <h3 className="min-w-0 truncate text-lg font-semibold text-gray-900 dark:text-white" title={file.name}>
            {file.name}
          </h3>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close" className="h-8 w-8 shrink-0 p-0">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex min-h-[400px] items-center justify-center bg-gray-50 p-4 dark:bg-gray-900">
          {loading && (
            <div className="text-center text-gray-500 dark:text-gray-400">
              <p>Loading image...</p>
            </div>
          )}
          {!loading && imageUrl && (
            <img
              src={imageUrl}
              alt={file.name}
              className="max-h-[70vh] max-w-full rounded-lg object-contain shadow-md"
            />
          )}
          {!loading && !imageUrl && (
            <div className="text-center text-gray-500 dark:text-gray-400">
              <p>{error || 'Unable to load image'}</p>
              <p className="mt-2 break-all text-sm">{file.path}</p>
            </div>
          )}
        </div>

        <div className="border-t bg-gray-50 p-4 dark:bg-gray-800">
          <p className="break-all text-sm text-gray-600 dark:text-gray-400">{file.path}</p>
        </div>
      </div>
    </div>
  );
}
