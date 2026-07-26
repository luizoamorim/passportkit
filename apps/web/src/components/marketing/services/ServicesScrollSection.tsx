'use client';

import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SERVICES_CTA, SERVICES_SECTION, SERVICE_CARDS } from '@/content/services-page-content';
import { CARD_RENDERERS } from './ServiceCards';
import { debugEvent, publishDebug } from '../debug/animation-debug';
import styles from '../marketing.module.css';

gsap.registerPlugin(ScrollTrigger);

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export function ServicesScrollSection() {
  const sectionRef = useRef<HTMLElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const wordWrapRef = useRef<HTMLDivElement | null>(null);
  const wordFillRef = useRef<HTMLSpanElement | null>(null);
  // Per-card 0..1 progress; drives each card's internal media.
  const [cardProgress, setCardProgress] = useState<number[]>(() => SERVICE_CARDS.map(() => 0));

  useEffect(() => {
    const mm = gsap.matchMedia();
    debugEvent('Services animation mounted');
    publishDebug({ gsapReady: typeof gsap.set === 'function' });

    // Single gate. The stylesheet layers the pinned layout on [data-enhanced] only,
    // so if this never matches the page still renders as a normal stacked flow.
    mm.add('(min-width: 1024px) and (prefers-reduced-motion: no-preference)', () => {
        debugEvent('media query matched');
        const section = sectionRef.current;
        const track = trackRef.current;
        const wordWrap = wordWrapRef.current;
        const wordFill = wordFillRef.current;
        if (!section || !track || !wordWrap || !wordFill) return;

        // Switch the stylesheet into pinned mode BEFORE measuring, so offsetTop and
        // offsetHeight are read against the absolute-positioned track.
        section.dataset.enhanced = 'true';
        debugEvent('data-enhanced applied');
        publishDebug({ enhanced: true });

        // Section height is derived from the track so the copy can grow freely.
        const layout = () => {
          const vh = window.innerHeight;
          const trackHeight = track.offsetHeight;
          section.style.height = `${trackHeight + vh * 1.7}px`;
          return { vh, trackHeight, travel: trackHeight + vh };
        };
        let metrics = layout();

        // Card windows, expressed in global progress, for local normalisation.
        const cardWindows = () =>
          Array.from(track.children).map((child) => {
            const el = child as HTMLElement;
            const start = el.offsetTop / metrics.travel;
            const end = (el.offsetTop + el.offsetHeight + metrics.vh) / metrics.travel;
            return { start, end };
          });
        let windows = cardWindows();

        const trigger = ScrollTrigger.create({
          trigger: section,
          start: 'top top',
          end: 'bottom bottom',
          scrub: 0.9,
          invalidateOnRefresh: true,
          onRefresh: () => {
            metrics = layout();
            windows = cardWindows();
          },
          onUpdate: (self) => {
            const p = self.progress;

            // Single continuous column travelling bottom-to-top.
            const translateY = -p * metrics.travel;
            gsap.set(track, { y: translateY, force3D: true });

            // Word settles into place over the first slice, then fills green → grey.
            const entry = clamp01(p / 0.08);
            gsap.set(wordWrap, {
              yPercent: -50,
              y: (1 - entry) * metrics.vh * 0.2,
              opacity: 0.7 + entry * 0.3,
            });
            const clipPercent = clamp01(p / 0.92) * 100;
            wordFill.style.clipPath = `inset(0 0 0 ${clipPercent}%)`;

            publishDebug({
              servicesProgress: p,
              trackTranslateY: translateY,
              wordClipPercent: clipPercent,
              scrollTriggerCount: ScrollTrigger.getAll().length,
            });

            // Re-render only on a meaningful delta; the track itself is moved via gsap.set
            // above, so per-frame React updates would be wasted work.
            const next = windows.map((w) => clamp01((p - w.start) / Math.max(0.0001, w.end - w.start)));
            setCardProgress((prev) =>
              next.some((value, i) => Math.abs(value - (prev[i] ?? 0)) > 0.004) ? next : prev,
            );
          },
        });

      // Revert to the plain stacked layout when the query stops matching (resize,
      // breakpoint change) so no stale transforms or heights survive.
      debugEvent('ScrollTrigger created');
      publishDebug({ scrollTriggerCount: ScrollTrigger.getAll().length });

      return () => {
        debugEvent('cleanup executed');
        publishDebug({ enhanced: false, scrollTriggerCount: Math.max(0, ScrollTrigger.getAll().length - 1) });
        trigger.kill();
        delete section.dataset.enhanced;
        section.style.height = '';
        gsap.set([track, wordWrap], { clearProps: 'all' });
        wordFill.style.clipPath = '';
        setCardProgress(SERVICE_CARDS.map(() => 0));
      };
    });

    return () => mm.revert();
  }, []);

  return (
    <section id="services" ref={sectionRef} className={styles.services}>
      <div className={styles.stage}>
        <h2 className={styles.servicesMobileTitle}>{SERVICES_SECTION.mobileTitle}</h2>

        <div className={styles.wordWrap} ref={wordWrapRef} aria-hidden="true">
          <span className={`${styles.word} ${styles.wordBase}`}>{SERVICES_SECTION.backgroundWord}</span>
          <span className={`${styles.word} ${styles.wordFill}`} ref={wordFillRef}>
            {SERVICES_SECTION.backgroundWord}
          </span>
        </div>

        <div className={styles.track} ref={trackRef}>
          {SERVICE_CARDS.map((card, index) => {
            const Renderer = CARD_RENDERERS[card.id];
            return Renderer ? <Renderer key={card.id} card={card} progress={cardProgress[index] ?? 0} /> : null;
          })}
          <a href={SERVICES_CTA.href} className={styles.ctaButton}>
            {SERVICES_CTA.label}
          </a>
        </div>
      </div>
    </section>
  );
}
