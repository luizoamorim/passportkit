import Link from 'next/link';
import { LandingAuth } from '@/components/wallet/LandingAuth';
import {
  ARCHITECTURE,
  BRAND,
  HERO,
  INTEGRATIONS,
  NAV,
  PROBLEM,
  WHY_NOW,
} from '@/content/site-content';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#F0F2F6]">
      {/* Nav */}
      <nav className="bg-white border-b border-[#DDE1EA]">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#4A9EFF] to-[#3DDBD9] flex items-center justify-center">
              <span className="text-white text-xs font-bold">PK</span>
            </div>
            <div>
              <span className="font-bold text-[#0D1428] text-sm">{BRAND.name}</span>
              <span className="hidden sm:inline text-xs text-[#9CA3AF] ml-2">{BRAND.version} · {BRAND.network}</span>
            </div>
          </div>
          <div className="hidden lg:flex items-center gap-6">
            {NAV.map((item) => (
              <Link key={item.label} href={item.href} className="text-xs font-semibold text-[#4B5568] hover:text-[#0D1428] transition-colors">
                {item.label}
              </Link>
            ))}
          </div>
          <a href={HERO.primaryCta.href} className="text-sm font-semibold text-[#4A9EFF] hover:text-[#2B7FE0] transition-colors whitespace-nowrap">
            {HERO.primaryCta.label} →
          </a>
        </div>
      </nav>

      {/* Hero */}
      <section id="overview" className="max-w-6xl mx-auto px-6 pt-20 pb-16 text-center">
        <p className="text-[13px] sm:text-[15px] font-bold tracking-[0.14em] uppercase text-[#EA580C] mb-5">{HERO.disclaimer}</p>
        <h1 className="text-4xl sm:text-5xl font-bold text-[#0D1428] mb-3 leading-tight max-w-4xl mx-auto">
          {HERO.headline}
        </h1>
        <p className="text-2xl sm:text-3xl font-bold mb-5 leading-tight bg-gradient-to-r from-[#4A9EFF] to-[#3DDBD9] bg-clip-text text-transparent">
          {HERO.secondHeadline}
        </p>
        <p className="text-base text-[#4B5568] mb-8 max-w-2xl mx-auto leading-relaxed">{HERO.description}</p>

        <div className="flex flex-wrap items-center justify-center gap-2 mb-10">
          {INTEGRATIONS.map((integration) => (
            <span key={integration.label} className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-white text-[#4B5568] border border-[#DDE1EA]">
              {integration.label}
              <span className="text-[10px] font-medium text-[#9CA3AF]">{integration.status}</span>
            </span>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center mb-10">
          <a href={HERO.secondaryCta.href} className="border border-[#0D1428] text-[#0D1428] text-sm font-semibold px-8 py-3.5 rounded-lg hover:bg-[#E4E8F0] transition-colors">
            {HERO.secondaryCta.label}
          </a>
        </div>

        <div id="access"><LandingAuth /></div>
      </section>

      {/* Problem */}
      <section className="bg-white border-y border-[#DDE1EA] py-16">
        <div className="max-w-6xl mx-auto px-6">
          <h2 className="text-3xl font-bold text-[#0D1428] mb-4 leading-tight whitespace-pre-line">{PROBLEM.title}</h2>
          <p className="text-base text-[#4B5568] max-w-3xl leading-relaxed mb-8">{PROBLEM.description}</p>
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {PROBLEM.points.map((point) => (
              <li key={point} className="rounded-xl border border-[#DDE1EA] bg-[#F8FAFC] p-4 text-sm text-[#4B5568] leading-relaxed">
                {point}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Why now */}
      <section className="max-w-6xl mx-auto px-6 py-16">
        <h2 className="text-3xl font-bold text-[#0D1428] mb-6 leading-tight whitespace-pre-line">{WHY_NOW.title}</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div>
            {WHY_NOW.points.map((point) => (
              <p key={point} className="text-base text-[#4B5568] leading-relaxed mb-3">{point}</p>
            ))}
            <p className="text-sm font-semibold text-[#0D1428] mt-6 mb-3">{WHY_NOW.bridgeIntro}</p>
            <ul className="flex flex-wrap gap-2">
              {WHY_NOW.bridge.map((item) => (
                <li key={item} className="rounded-full bg-white border border-[#DDE1EA] px-3 py-1.5 text-xs font-semibold text-[#4B5568]">
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <ol className="space-y-2">
            {WHY_NOW.flow.map((item, index) => (
              <li key={item} className="flex gap-3 rounded-xl bg-white border border-[#DDE1EA] p-3.5">
                <span className="text-xs font-bold text-[#4A9EFF] shrink-0">{String(index + 1).padStart(2, '0')}</span>
                <span className="text-sm text-[#4B5568] leading-relaxed">{item}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Architecture */}
      <section id="architecture" className="bg-[#0D1428] py-16">
        <div className="max-w-6xl mx-auto px-6">
          <p className="text-[11px] font-semibold tracking-widest uppercase text-[#4A9EFF] text-center mb-10">Architecture</p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-10">
            {ARCHITECTURE.layers.map((layer) => (
              <div key={layer.id} className="bg-[#172040] border border-[#1E2D4D] rounded-2xl p-6">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#3DDBD9] mb-2">{layer.eyebrow}</p>
                <h3 className="text-white text-lg font-bold mb-4">{layer.title}</h3>
                <div className="flex flex-wrap gap-2 mb-4">
                  {layer.components.map((component) => (
                    <span key={component} className="rounded-full bg-[#1E2D4D] px-3 py-1 text-xs font-semibold text-[#C7DEFF]">
                      {component}
                    </span>
                  ))}
                </div>
                <p className="text-[#8FA0C0] text-sm leading-relaxed">{layer.description}</p>
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-[#1E2D4D] bg-[#111a35] p-6">
            <div className="flex flex-wrap items-center justify-center gap-2 mb-4">
              {ARCHITECTURE.flow.map((node, index) => (
                <span key={node} className="flex items-center gap-2">
                  <span className="rounded-lg bg-[#1E2D4D] px-3 py-1.5 text-xs font-semibold text-white">{node}</span>
                  {index < ARCHITECTURE.flow.length - 1 && <span className="text-[#4A9EFF] text-xs">→</span>}
                </span>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2 mb-4">
              {ARCHITECTURE.flowOutcomes.map((outcome, index) => (
                <span key={outcome} className="flex items-center gap-2">
                  {index > 0 && <span className="text-[#8FA0C0] text-xs">or</span>}
                  <span className="rounded-lg border border-[#3DDBD9]/30 bg-[#3DDBD9]/10 px-3 py-1.5 text-xs font-semibold text-[#3DDBD9]">
                    {outcome}
                  </span>
                </span>
              ))}
            </div>
            <p className="text-center text-sm font-semibold text-white">{ARCHITECTURE.note}</p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[#DDE1EA] bg-white py-6">
        <div className="max-w-6xl mx-auto px-6 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-[#9CA3AF]">{BRAND.name} {BRAND.version}</span>
          <span className="text-xs text-[#9CA3AF]">{BRAND.event} · Live on {BRAND.network}</span>
        </div>
      </footer>
    </div>
  );
}
