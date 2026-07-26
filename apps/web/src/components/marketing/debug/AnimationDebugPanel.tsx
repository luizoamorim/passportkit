'use client';

import { useEffect, useRef, useState } from 'react';
import { debugState, isDebugEnabled, publishDebug } from './animation-debug';

/** TEMPORARY. Development-only overlay; renders nothing in a production build. */
export function AnimationDebugPanel() {
  const [, force] = useState(0);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (!isDebugEnabled) return;

    const readEnv = () => {
      publishDebug({
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      });
    };
    readEnv();
    window.addEventListener('resize', readEnv);

    const tick = () => {
      force((n) => (n + 1) % 1000);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener('resize', readEnv);
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, []);

  if (!isDebugEnabled) return null;

  const s = debugState;
  const row = (label: string, value: string | number | boolean, ok?: boolean) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14 }}>
      <span style={{ opacity: 0.62 }}>{label}</span>
      <span style={{ color: ok === undefined ? '#fff' : ok ? '#42e18e' : '#ff6b6b', fontWeight: 600 }}>
        {typeof value === 'boolean' ? String(value) : value}
      </span>
    </div>
  );

  return (
    <aside
      data-testid="anim-debug"
      aria-hidden="true"
      style={{
        position: 'fixed',
        right: 12,
        bottom: 12,
        zIndex: 9999,
        width: 268,
        padding: '11px 13px',
        borderRadius: 10,
        background: 'rgba(8,10,18,0.92)',
        color: '#fff',
        font: '11px/1.65 ui-monospace, SFMono-Regular, Menlo, monospace',
        pointerEvents: 'none',
        backdropFilter: 'blur(6px)',
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 5, letterSpacing: '0.04em' }}>SERVICES ANIM DEBUG</div>
      {row('viewport', `${s.viewportWidth}×${s.viewportHeight}`)}
      {row('reduced-motion', s.reducedMotion, !s.reducedMotion)}
      {row('data-enhanced', s.enhanced, s.enhanced)}
      {row('gsap ready', s.gsapReady, s.gsapReady)}
      {row('ScrollTriggers', s.scrollTriggerCount, s.scrollTriggerCount > 0)}
      {row('services progress', s.servicesProgress.toFixed(3))}
      {row('track translateY', `${s.trackTranslateY.toFixed(0)}px`)}
      {row('word clip', `${s.wordClipPercent.toFixed(1)}%`)}
      {row('security progress', s.securityProgress.toFixed(3))}
      <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.16)', opacity: 0.72 }}>
        {s.events.slice(-3).map((event, i) => (
          <div key={`${event}-${i}`}>· {event}</div>
        ))}
      </div>
    </aside>
  );
}
