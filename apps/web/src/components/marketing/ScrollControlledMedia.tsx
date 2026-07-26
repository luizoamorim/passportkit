'use client';

import { useEffect, useRef } from 'react';

type Props = {
  /** Frame sequence descriptor. Files must be named `${dir}/frame-0001.${ext}`. */
  frames: { dir: string; count: number; ext: string };
  /** 0..1 local progress for this card. Drives which frame is painted. */
  progress: number;
  className?: string;
  alt: string;
};

const framePath = (dir: string, index: number, ext: string) =>
  `${dir}/frame-${String(index + 1).padStart(4, '0')}.${ext}`;

/**
 * Paints an image sequence onto a single canvas so only one bitmap is ever in the DOM.
 * Frames decode lazily and the last decoded frame is reused until the next one is ready,
 * which keeps scrubbing smooth without blocking the scroll thread.
 */
export function ScrollControlledMedia({ frames, progress, className, alt }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imagesRef = useRef<(HTMLImageElement | undefined)[]>([]);
  const rafRef = useRef<number | null>(null);
  const lastDrawn = useRef(-1);

  useEffect(() => {
    imagesRef.current = new Array(frames.count);
    // Preload only the opening frames; the rest stream in on demand.
    for (let i = 0; i < Math.min(4, frames.count); i += 1) {
      const img = new Image();
      img.src = framePath(frames.dir, i, frames.ext);
      imagesRef.current[i] = img;
    }
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      imagesRef.current = [];
    };
  }, [frames.count, frames.dir, frames.ext]);

  useEffect(() => {
    const index = Math.min(frames.count - 1, Math.max(0, Math.round(progress * (frames.count - 1))));
    if (index === lastDrawn.current) return;

    let img = imagesRef.current[index];
    if (!img) {
      img = new Image();
      img.src = framePath(frames.dir, index, frames.ext);
      imagesRef.current[index] = img;
    }

    const paint = () => {
      const canvas = canvasRef.current;
      const source = img;
      if (!canvas || !source || !source.complete || source.naturalWidth === 0) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      if (canvas.width !== source.naturalWidth) canvas.width = source.naturalWidth;
      if (canvas.height !== source.naturalHeight) canvas.height = source.naturalHeight;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(source, 0, 0);
      lastDrawn.current = index;
    };

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (img.complete) rafRef.current = requestAnimationFrame(paint);
    else img.onload = () => { rafRef.current = requestAnimationFrame(paint); };
  }, [progress, frames.count, frames.dir, frames.ext]);

  return <canvas ref={canvasRef} className={className} role="img" aria-label={alt} />;
}
