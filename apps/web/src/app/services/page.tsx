import type { Metadata } from 'next';
import { SiteHeader } from '@/components/marketing/SiteHeader';
import { ServicesScrollSection } from '@/components/marketing/services/ServicesScrollSection';
import { SecurityBenefitsSection } from '@/components/marketing/security/SecurityBenefitsSection';
import { AnimationDebugPanel } from '@/components/marketing/debug/AnimationDebugPanel';
import styles from '@/components/marketing/marketing.module.css';

export const metadata: Metadata = {
  title: 'Services — Payard',
  description: 'Financial services: accounts, global payments, currency exchange and transactions.',
};

/**
 * Standalone marketing page. Kept on its own route so the migrated Passport Kit Node
 * landing at `/` is untouched; promote it by pointing `/` at these components.
 */
export default function ServicesPage() {
  return (
    <div className={styles.page} id="top">
      <SiteHeader />
      <main>
        <ServicesScrollSection />
        <SecurityBenefitsSection />
      </main>
      {/* TEMPORARY: development-only diagnostics overlay. */}
      <AnimationDebugPanel />
    </div>
  );
}
