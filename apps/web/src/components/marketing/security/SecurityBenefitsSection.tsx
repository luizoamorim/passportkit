'use client';

import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { BENEFITS, SECURITY_SECTION } from '@/content/services-page-content';
import { debugEvent, publishDebug } from '../debug/animation-debug';
import styles from '../marketing.module.css';

gsap.registerPlugin(ScrollTrigger);

const FAN_COLOURS = ['#42e18e', '#2f8bff', '#7a5cf0', '#ffd645'];

export function SecurityBenefitsSection() {
  const sectionRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    const mm = gsap.matchMedia();

    // Reports section progress to the debug panel regardless of motion preference.
    const progressTracker = ScrollTrigger.create({
      trigger: section,
      start: 'top bottom',
      end: 'bottom top',
      onUpdate: (self) => publishDebug({ securityProgress: self.progress }),
    });

    mm.add('(prefers-reduced-motion: no-preference)', () => {
      debugEvent('security animation armed');
      const lines = section.querySelectorAll(`.${styles.headingLine}`);
      const fan = section.querySelector(`.${styles.fanWrap}`);
      const items = section.querySelectorAll(`.${styles.benefit}`);

      const tl = gsap.timeline({
        scrollTrigger: { trigger: section, start: 'top 78%', once: true },
      });

      tl.to(lines, {
        opacity: 1,
        filter: 'blur(0px)',
        y: 0,
        color: '#050505',
        duration: 0.9,
        stagger: 0.22,
        ease: 'power2.out',
      });

      if (fan) {
        tl.fromTo(
          fan,
          { opacity: 0, y: 170, x: -80, scale: 0.82, rotate: -7 },
          { opacity: 1, y: 0, x: 0, scale: 1.04, rotate: -3, duration: 1.1, ease: 'power3.out' },
          '-=0.55',
        );
      }

      tl.to(
        items,
        { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.6, stagger: 0.12, ease: 'power2.out' },
        '-=0.8',
      );

      return () => {
        tl.scrollTrigger?.kill();
        tl.kill();
        gsap.set([lines, fan, items].flat().filter(Boolean) as Element[], { clearProps: 'all' });
      };
    });

    return () => {
      progressTracker.kill();
      mm.revert();
    };
  }, []);

  return (
    <section ref={sectionRef} className={styles.security}>
      <div className={styles.securityGrid}>
        <div>
          <h2 className={styles.securityHeading}>
            {SECURITY_SECTION.headingLines.map((line) => (
              <span key={line} className={styles.headingLine}>{line}</span>
            ))}
          </h2>

          <div className={styles.fanWrap}>
            {/* PLACEHOLDER: replace with SECURITY_SECTION.fanImage once the asset exists. */}
            <div className={styles.fanPlaceholder} role="img" aria-label={SECURITY_SECTION.fanImage.alt}>
              {FAN_COLOURS.map((colour, index) => (
                <span
                  key={colour}
                  className={styles.fanCard}
                  style={{
                    background: `linear-gradient(135deg, ${colour}, ${colour}bb)`,
                    transform: `rotate(${-22 + index * 13}deg) translateY(${index * -8}px)`,
                    zIndex: index,
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        <div className={styles.benefitsWrap}>
          <ul className={styles.benefits}>
            {BENEFITS.map((benefit, index) => (
              <li key={benefit.id} className={styles.benefit}>
                <div className={styles.benefitHead}>
                  <span className={styles.benefitIcon} aria-hidden="true"><i /></span>
                  <h3 className={styles.benefitTitle}>{benefit.title}</h3>
                </div>
                <p className={styles.benefitBody}>{benefit.body}</p>
                {index < BENEFITS.length - 1 && <hr className={styles.benefitDivider} />}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
