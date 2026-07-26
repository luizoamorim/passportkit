/**
 * Content + asset paths for the Services / Security marketing page (route: /services).
 *
 * Everything the page renders lives here so copy and assets can be swapped without
 * touching components. Asset paths marked PLACEHOLDER have no file yet — the matching
 * component renders a self-contained CSS/SVG stand-in until a real asset is dropped in.
 * See public/marketing/README.md for how to replace them.
 */

export type CardMediaKind = 'box-sequence' | 'tiles' | 'currency' | 'planet';

export type ServiceCard = {
  id: string;
  /** Rendered as the card heading. Newlines become <br /> on desktop. */
  title: string;
  body: string;
  media: CardMediaKind;
  /** Optional frame sequence. When `frames` is set, ScrollControlledMedia drives it. */
  frames?: { dir: string; count: number; ext: string };
  theme?: 'light' | 'dark';
};

export const SITE_NAV = [
  { label: 'Banking', href: '#banking' },
  { label: 'Services', href: '#services' },
  { label: 'Pricing', href: '#pricing', hasChevron: true },
  { label: 'Consulting', href: '#consulting' },
] as const;

export const HEADER_CTA = {
  primary: { label: 'Get in Touch', href: '#contact' },
  signIn: { label: 'Sign in', href: '#signin' },
  signUp: { label: 'Sign up', href: '#signup' },
} as const;

export const SERVICES_SECTION = {
  backgroundWord: 'Services',
  mobileTitle: 'Services',
} as const;

export const SERVICE_CARDS: ServiceCard[] = [
  {
    id: 'starting-account',
    title: 'Starting Your Account',
    // Copy matches the design reference verbatim, including "You first steps".
    body:
      "You first steps are easy and hassle-free. Whether you're an individual or running a business, our simple setup process gets you up and running quickly. Once you're in, you'll enjoy a range of benefits designed to make your financial life smoother",
    media: 'box-sequence',
    // PLACEHOLDER: drop frames at public/marketing/box/box-0001.webp … and set count.
    // frames: { dir: '/marketing/box', count: 40, ext: 'webp' },
  },
  {
    id: 'global-payments',
    title: 'Effortless Global\nPayments With the\nFlexibility You Need',
    body:
      'With our debit cards, whether you choose a virtual or physical one, experience the flexibility to manage finances your way, with global acceptance and robust protection.',
    media: 'tiles',
  },
  {
    id: 'currency-exchange',
    title: 'Exchange currencies seamlessly,\nfast and hassle-free',
    body:
      "We support over 72 currencies like EUR, USD, GBP and digital currencies as USDT, USDC, ETH, BTC (crypto/crypto, crypto/fiat, fiat/fiat). Competitive rates, assets protection and no hidden fees. Whether you're handling international business or personal finances, your needs are met with flexibility and reliability.",
    media: 'currency',
  },
  {
    id: 'global-transactions',
    title: 'Go global with streamlined\ntransactions',
    body:
      'Payard supports seamless international transactions with SEPA, SWIFT, FPS, BACS, and CHAPS, making global business and personal finances simple and efficient - all at competitive market rates.',
    media: 'planet',
    theme: 'dark',
  },
];

export const PAYMENT_TILES = ['Global Acceptance', 'Robust Protection'] as const;

export const CURRENCY_CHIPS = ['EUR', 'USD', 'GBP', 'USDT', 'BTC'] as const;

export const SERVICES_CTA = { label: "Let's Get Start", href: '#get-started' } as const;

export const SECURITY_SECTION = {
  headingLines: ['Fast. Safe.', 'Always on.'],
  // PLACEHOLDER: a transparent PNG/WebP of fanned bank cards.
  fanImage: { src: '/marketing/cards-fan.webp', alt: 'A fan of coloured bank cards' },
} as const;

export type Benefit = { id: string; title: string; body: string };

export const BENEFITS: Benefit[] = [
  {
    id: 'pci-dss',
    title: 'PCI DSS Certified',
    body: 'We meet global security standards so your data stays protected and secure — no compromises.',
  },
  {
    id: 'monitoring',
    title: '24/7 Monitoring',
    body: 'With round-the-clock transaction monitoring, we keep things running smoothly to boost your conversions.',
  },
  {
    id: 'anti-fraud',
    title: 'Anti-Fraud Protection',
    body: 'Our smart system filters out fraudulent activity, safeguarding every payment for a worry-free experience.',
  },
  {
    id: 'chargeback',
    title: 'Chargeback Prevention',
    body: 'Automated chargeback tools reduce risks and penalties, helping keep your business protected and hassle-free.',
  },
];
