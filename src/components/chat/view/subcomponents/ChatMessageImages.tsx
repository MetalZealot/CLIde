import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

import { authenticatedFetch } from '../../../../utils/api';
import type { ChatImage } from '../../types/types';

type ChatMessageImagesProps = {
  images: ChatImage[];
  projectId?: string | null;
};

/**
 * Resolves one chat image to a displayable src. Inline data URLs are used
 * directly; path-based attachments are fetched as blobs (a bare <img src>
 * cannot carry the auth header) — first from the global assets route
 * (`~/.cloudcli/assets`), then from the project files route as a fallback for
 * sessions recorded before attachments moved to the global store.
 */
function useChatImageSrc(image: ChatImage, projectId?: string | null): { src: string | null; failed: boolean } {
  const [src, setSrc] = useState<string | null>(image.data || null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (image.data) {
      setSrc(image.data);
      setFailed(false);
      return;
    }

    const imagePath = image.path;
    if (!imagePath) {
      setSrc(null);
      setFailed(true);
      return;
    }

    const filename = imagePath.split(/[\\/]/).pop() || '';
    const candidateUrls = [
      `/api/assets/images/${encodeURIComponent(filename)}`,
      ...(projectId
        ? [`/api/file-tree/projects/${projectId}/files/content?path=${encodeURIComponent(imagePath)}`]
        : []),
    ];

    let objectUrl: string | null = null;
    const controller = new AbortController();

    const load = async () => {
      setFailed(false);
      for (const url of candidateUrls) {
        try {
          const response = await authenticatedFetch(url, { signal: controller.signal });
          if (!response.ok) {
            continue;
          }
          const blob = await response.blob();
          objectUrl = URL.createObjectURL(blob);
          setSrc(objectUrl);
          return;
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            return;
          }
        }
      }
      setSrc(null);
      setFailed(true);
    };

    void load();

    return () => {
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [image.data, image.path, projectId]);

  return { src, failed };
}

/**
 * Fullscreen image overlay in the claude.ai style: dark backdrop, centered
 * image, closes on backdrop click, close button, or Escape.
 */
type ImageLightboxProps = {
  src: string;
  alt: string;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
};

export function ImageLightbox({ src, alt, onClose, onPrevious, onNext }: ImageLightboxProps) {
  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      } else if (event.key === 'ArrowLeft' && onPrevious) {
        event.preventDefault();
        event.stopPropagation();
        onPrevious();
      } else if (event.key === 'ArrowRight' && onNext) {
        event.preventDefault();
        event.stopPropagation();
        onNext();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose, onNext, onPrevious]);

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={alt}
    >
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        aria-label="Close image preview"
        className="absolute right-4 top-4 z-10 flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        <X className="h-6 w-6" aria-hidden />
      </button>
      {onPrevious && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onPrevious();
          }}
          aria-label="Previous image"
          className="absolute left-2 top-1/2 z-10 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-white sm:left-4"
        >
          <ChevronLeft className="h-7 w-7" aria-hidden />
        </button>
      )}
      {onNext && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onNext();
          }}
          aria-label="Next image"
          className="absolute right-2 top-1/2 z-10 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-white sm:right-4"
        >
          <ChevronRight className="h-7 w-7" aria-hidden />
        </button>
      )}
      <img
        src={src}
        alt={alt}
        onClick={(event) => event.stopPropagation()}
        className="max-h-[90vh] max-w-[92vw] rounded-lg object-contain shadow-2xl"
      />
    </div>,
    document.body,
  );
}

type ChatMessageImageProps = {
  image: ChatImage;
  imageKey: string;
  projectId?: string | null;
  expanded: boolean;
  onExpand: () => void;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onAvailabilityChange: (imageKey: string, available: boolean) => void;
};

function ChatMessageImage({
  image,
  imageKey,
  projectId,
  expanded,
  onExpand,
  onClose,
  onPrevious,
  onNext,
  onAvailabilityChange,
}: ChatMessageImageProps) {
  const { src, failed } = useChatImageSrc(image, projectId);
  const alt = image.name || 'Attached image';

  useEffect(() => {
    onAvailabilityChange(imageKey, Boolean(src && !failed));
  }, [failed, imageKey, onAvailabilityChange, src]);

  if (failed) {
    return (
      <div className="flex h-28 w-28 items-center justify-center rounded-xl border border-border/50 bg-muted px-2 text-center text-[10px] text-muted-foreground">
        {alt}
      </div>
    );
  }

  if (!src) {
    return <div className="h-28 w-28 animate-pulse rounded-xl border border-border/50 bg-muted" />;
  }

  return (
    <>
      <button
        type="button"
        onClick={onExpand}
        aria-label={`Expand ${alt}`}
        className="block overflow-hidden rounded-xl border border-border/50 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/60"
      >
        <img
          src={src}
          alt={alt}
          className="h-28 w-28 cursor-zoom-in object-cover transition-transform duration-200 hover:scale-105"
        />
      </button>
      {expanded && (
        <ImageLightbox
          src={src}
          alt={alt}
          onClose={onClose}
          onPrevious={onPrevious}
          onNext={onNext}
        />
      )}
    </>
  );
}

/**
 * Image attachments for a user turn, rendered claude.ai-style: standalone
 * rounded square cards shown above the message bubble. Each thumbnail
 * expands to a fullscreen lightbox on click.
 */
export default function ChatMessageImages({ images, projectId }: ChatMessageImagesProps) {
  const [activeImageKey, setActiveImageKey] = useState<string | null>(null);
  const [availableImageKeys, setAvailableImageKeys] = useState<Set<string>>(() => new Set());

  const handleAvailabilityChange = useCallback((imageKey: string, available: boolean) => {
    if (!available) {
      setActiveImageKey((current) => current === imageKey ? null : current);
    }
    setAvailableImageKeys((current) => {
      const hasImage = current.has(imageKey);
      if (hasImage === available) {
        return current;
      }

      const next = new Set(current);
      if (available) {
        next.add(imageKey);
      } else {
        next.delete(imageKey);
      }
      return next;
    });
  }, []);

  if (!images || images.length === 0) {
    return null;
  }

  const keyedImages = images.map((image, index) => ({
    image,
    key: `${image.path || image.name || 'image'}:${index}`,
  }));
  const navigableKeys = keyedImages
    .filter(({ key }) => availableImageKeys.has(key))
    .map(({ key }) => key);

  return (
    <div className="flex flex-wrap justify-end gap-2">
      {keyedImages.map(({ image, key }) => {
        const galleryIndex = navigableKeys.indexOf(key);
        const previousKey = galleryIndex > 0 ? navigableKeys[galleryIndex - 1] : undefined;
        const nextKey = galleryIndex >= 0 && galleryIndex < navigableKeys.length - 1
          ? navigableKeys[galleryIndex + 1]
          : undefined;

        return (
          <ChatMessageImage
            key={key}
            image={image}
            imageKey={key}
            projectId={projectId}
            expanded={activeImageKey === key}
            onExpand={() => setActiveImageKey(key)}
            onClose={() => setActiveImageKey(null)}
            onPrevious={previousKey ? () => setActiveImageKey(previousKey) : undefined}
            onNext={nextKey ? () => setActiveImageKey(nextKey) : undefined}
            onAvailabilityChange={handleAvailabilityChange}
          />
        );
      })}
    </div>
  );
}
