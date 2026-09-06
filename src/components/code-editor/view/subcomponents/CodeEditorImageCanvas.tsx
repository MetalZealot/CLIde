import { useCallback, useEffect, useRef, useState } from 'react';

type CodeEditorImageCanvasProps = {
  src: string;
  alt: string;
  // Fires on a single tap that was not part of a pan, pinch or double-tap.
  onTap?: () => void;
};

const MIN_SCALE = 1;
const MAX_SCALE = 8;
const DOUBLE_TAP_SCALE = 2.5;
const DOUBLE_TAP_MS = 280;
// A pointer that travels further than this is a drag, never a tap.
const TAP_SLOP_PX = 10;

type Transform = { scale: number; x: number; y: number };

const IDENTITY: Transform = { scale: 1, x: 0, y: 0 };

export default function CodeEditorImageCanvas({ src, alt, onTap }: CodeEditorImageCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [transform, setTransform] = useState<Transform>(IDENTITY);

  // Live pointer positions, keyed by pointerId. Two entries means a pinch.
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const gestureRef = useRef<{ distance: number; transform: Transform; focus: { x: number; y: number } } | null>(null);
  const panRef = useRef<{ start: { x: number; y: number }; transform: Transform } | null>(null);
  const tapRef = useRef<{ time: number; x: number; y: number; moved: boolean } | null>(null);
  const singleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setTransform(IDENTITY);
  }, [src]);

  useEffect(() => () => {
    if (singleTapTimerRef.current) clearTimeout(singleTapTimerRef.current);
  }, []);

  // Panning past this leaves the scaled image detached from the viewport edge.
  const clamp = useCallback((next: Transform): Transform => {
    const container = containerRef.current;
    const image = imageRef.current;
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next.scale));
    if (!container || !image) return { ...next, scale };

    const boundX = Math.max(0, (image.offsetWidth * scale - container.clientWidth) / 2);
    const boundY = Math.max(0, (image.offsetHeight * scale - container.clientHeight) / 2);

    return {
      scale,
      x: Math.min(boundX, Math.max(-boundX, next.x)),
      y: Math.min(boundY, Math.max(-boundY, next.y)),
    };
  }, []);

  // Focal-point zoom: `focus` is an offset from the container centre, and the
  // image point under it stays put across the scale change.
  const zoomTo = useCallback((from: Transform, scale: number, focus: { x: number; y: number }) => {
    const target = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
    const ratio = target / from.scale;
    return clamp({
      scale: target,
      x: focus.x - (focus.x - from.x) * ratio,
      y: focus.y - (focus.y - from.y) * ratio,
    });
  }, [clamp]);

  const toFocus = useCallback((clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: clientX - (rect.left + rect.width / 2), y: clientY - (rect.top + rect.height / 2) };
  }, []);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    const points = [...pointersRef.current.values()];
    if (points.length === 2) {
      panRef.current = null;
      tapRef.current = null;
      const [a, b] = points;
      gestureRef.current = {
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        transform,
        focus: toFocus((a.x + b.x) / 2, (a.y + b.y) / 2),
      };
      return;
    }

    if (points.length === 1) {
      panRef.current = { start: { x: event.clientX, y: event.clientY }, transform };
      tapRef.current = { time: Date.now(), x: event.clientX, y: event.clientY, moved: false };
    }
  }, [toFocus, transform]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    const points = [...pointersRef.current.values()];
    const gesture = gestureRef.current;

    if (points.length === 2 && gesture) {
      const [a, b] = points;
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (gesture.distance > 0) {
        setTransform(zoomTo(gesture.transform, gesture.transform.scale * (distance / gesture.distance), gesture.focus));
      }
      return;
    }

    const pan = panRef.current;
    if (points.length === 1 && pan) {
      const dx = event.clientX - pan.start.x;
      const dy = event.clientY - pan.start.y;
      if (tapRef.current && Math.hypot(dx, dy) > TAP_SLOP_PX) tapRef.current.moved = true;
      // At natural size there is nothing to pan; leave the gesture alone.
      if (pan.transform.scale > 1) {
        setTransform(clamp({ scale: pan.transform.scale, x: pan.transform.x + dx, y: pan.transform.y + dy }));
      }
    }
  }, [clamp, zoomTo]);

  const endPointer = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) gestureRef.current = null;
    if (pointersRef.current.size === 0) panRef.current = null;
  }, []);

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const tap = tapRef.current;
    tapRef.current = null;
    endPointer(event);

    if (!tap || tap.moved || Date.now() - tap.time > 400) return;

    if (singleTapTimerRef.current) {
      clearTimeout(singleTapTimerRef.current);
      singleTapTimerRef.current = null;
      const focus = toFocus(event.clientX, event.clientY);
      setTransform((current) => (
        current.scale > 1 ? IDENTITY : zoomTo(current, DOUBLE_TAP_SCALE, focus)
      ));
      return;
    }

    // Hold the tap open long enough to tell it apart from a double-tap.
    singleTapTimerRef.current = setTimeout(() => {
      singleTapTimerRef.current = null;
      onTap?.();
    }, DOUBLE_TAP_MS);
  }, [endPointer, onTap, toFocus, zoomTo]);

  // React registers `wheel` passively at the root, so preventDefault only takes
  // effect from a natively-bound non-passive listener.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const focus = toFocus(event.clientX, event.clientY);
      setTransform((current) => zoomTo(current, current.scale * Math.exp(-event.deltaY / 300), focus));
    };

    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, [toFocus, zoomTo]);

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full touch-none select-none overflow-hidden"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={endPointer}
    >
      <div className="flex h-full w-full items-center justify-center">
        <img
          ref={imageRef}
          src={src}
          alt={alt}
          draggable={false}
          onLoad={() => setTransform(IDENTITY)}
          className="max-h-full max-w-full object-contain"
          style={{
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
            cursor: transform.scale > 1 ? 'grab' : 'default',
          }}
        />
      </div>
    </div>
  );
}
