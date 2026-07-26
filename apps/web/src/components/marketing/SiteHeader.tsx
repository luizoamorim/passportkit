'use client';

import { useState } from 'react';
import { HEADER_CTA, SITE_NAV } from '@/content/services-page-content';
import styles from './marketing.module.css';

/** Fixed overlay header. Desktop shows the pill nav; below 1024px a compact bar. */
export function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      <header className={styles.header}>
        <a href="#top" className={styles.logo}>
          <span className={styles.logoMark} aria-hidden="true" />
          Payard
        </a>

        <nav className={styles.navPill} aria-label="Primary">
          {SITE_NAV.map((item) => (
            <a key={item.label} href={item.href} className={styles.navLink}>
              {item.label}
              {'hasChevron' in item && item.hasChevron && <span className={styles.chevron} aria-hidden="true" />}
            </a>
          ))}
          <a href={HEADER_CTA.primary.href} className={styles.navCta}>
            {HEADER_CTA.primary.label}
          </a>
        </nav>

        <div className={styles.headerRight}>
          <a href={HEADER_CTA.signIn.href} className={styles.btnGhost}>{HEADER_CTA.signIn.label}</a>
          <a href={HEADER_CTA.signUp.href} className={styles.btnSolid}>{HEADER_CTA.signUp.label}</a>
        </div>
      </header>

      <div className={styles.headerMobile}>
        <a href="#top" className={styles.logo}>
          <span className={styles.logoMark} aria-hidden="true" />
          Payard
        </a>
        <button
          type="button"
          className={styles.menuButton}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span aria-hidden="true" />
          <span aria-hidden="true" />
        </button>
      </div>

      {menuOpen && (
        <nav className={styles.mobilePanel} aria-label="Mobile">
          {SITE_NAV.map((item) => (
            <a key={item.label} href={item.href} onClick={() => setMenuOpen(false)}>{item.label}</a>
          ))}
          <a href={HEADER_CTA.signIn.href} onClick={() => setMenuOpen(false)}>{HEADER_CTA.signIn.label}</a>
          <a href={HEADER_CTA.signUp.href} onClick={() => setMenuOpen(false)}>{HEADER_CTA.signUp.label}</a>
        </nav>
      )}
    </>
  );
}
