import { useCallback, useEffect, useState } from 'react';
import { FileIcon, XIcon } from 'lucide-react';

import { ImageLightbox } from './ChatMessageImages';

interface ComposerAttachmentProps {
  file: File;
  onRemove: () => void;
  uploadProgress?: number;
  error?: string;
  expanded?: boolean;
  onExpand?: () => void;
  onClose?: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onPreviewAvailabilityChange?: (file: File, available: boolean) => void;
}

interface ComposerAttachmentGalleryProps {
  files: File[];
  onRemove: (index: number) => void;
  uploadingFiles: Map<string, number>;
  fileErrors: Map<string, string>;
}

const formatFileSize = (size: number) => {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

const ComposerAttachment = ({
  file,
  onRemove,
  uploadProgress,
  error,
  expanded = false,
  onExpand,
  onClose,
  onPrevious,
  onNext,
  onPreviewAvailabilityChange,
}: ComposerAttachmentProps) => {
  const [preview, setPreview] = useState<string | undefined>(undefined);
  const isImage = file.type.startsWith('image/');

  useEffect(() => {
    if (!isImage) {
      setPreview(undefined);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file, isImage]);

  useEffect(() => {
    onPreviewAvailabilityChange?.(file, Boolean(preview));
  }, [file, onPreviewAvailabilityChange, preview]);

  return (
    <div className="group relative max-w-full">
      {isImage ? (
        <button
          type="button"
          onClick={() => preview && onExpand?.()}
          aria-label={`Expand ${file.name}`}
          className="block overflow-hidden rounded-xl border border-border/50 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/60"
        >
          {preview
            ? <img src={preview} alt={file.name} className="h-20 w-20 cursor-zoom-in object-cover" />
            : <div className="h-20 w-20 animate-pulse bg-muted" />}
        </button>
      ) : (
        <div className="flex h-20 w-56 max-w-full items-center gap-3 rounded-xl border border-border/50 bg-background/80 px-3 shadow-sm">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FileIcon className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground" title={file.name}>{file.name}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
          </div>
        </div>
      )}
      {uploadProgress !== undefined && uploadProgress < 100 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-black/50">
          <div className="text-xs text-white">{uploadProgress}%</div>
        </div>
      )}
      {error && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-red-500/50">
          <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
      )}
      <button
        type="button"
        onClick={onRemove}
        className="absolute -right-1.5 -top-1.5 rounded-full border border-border/40 bg-background/90 p-1 text-foreground shadow-sm transition-opacity hover:bg-background focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
        aria-label={`Remove ${file.name}`}
      >
        <XIcon className="h-3 w-3" aria-hidden />
      </button>
      {expanded && preview && (
        <ImageLightbox
          src={preview}
          alt={file.name}
          onClose={() => onClose?.()}
          onPrevious={onPrevious}
          onNext={onNext}
        />
      )}
    </div>
  );
};

export function ComposerAttachmentGallery({
  files,
  onRemove,
  uploadingFiles,
  fileErrors,
}: ComposerAttachmentGalleryProps) {
  const [activeFile, setActiveFile] = useState<File | null>(null);
  const [availableImages, setAvailableImages] = useState<Set<File>>(() => new Set());

  const handlePreviewAvailabilityChange = useCallback((file: File, available: boolean) => {
    if (!available) {
      setActiveFile((current) => current === file ? null : current);
    }
    setAvailableImages((current) => {
      const hasImage = current.has(file);
      if (hasImage === available) {
        return current;
      }

      const next = new Set(current);
      if (available) {
        next.add(file);
      } else {
        next.delete(file);
      }
      return next;
    });
  }, []);

  const navigableImages = files.filter((file) => file.type.startsWith('image/') && availableImages.has(file));

  return (
    <div className="flex flex-wrap gap-2">
      {files.map((file, index) => {
        const galleryIndex = navigableImages.indexOf(file);
        const previousFile = galleryIndex > 0 ? navigableImages[galleryIndex - 1] : undefined;
        const nextFile = galleryIndex >= 0 && galleryIndex < navigableImages.length - 1
          ? navigableImages[galleryIndex + 1]
          : undefined;

        return (
          <ComposerAttachment
            key={`${file.name}:${file.size}:${file.lastModified}:${index}`}
            file={file}
            onRemove={() => onRemove(index)}
            uploadProgress={uploadingFiles.get(file.name)}
            error={fileErrors.get(file.name)}
            expanded={activeFile === file}
            onExpand={() => setActiveFile(file)}
            onClose={() => setActiveFile(null)}
            onPrevious={previousFile ? () => setActiveFile(previousFile) : undefined}
            onNext={nextFile ? () => setActiveFile(nextFile) : undefined}
            onPreviewAvailabilityChange={handlePreviewAvailabilityChange}
          />
        );
      })}
    </div>
  );
}

export default ComposerAttachment;
