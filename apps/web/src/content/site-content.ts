/**
 * Single source of truth for Passport Kit Node marketing and dashboard copy.
 * Keep product wording here rather than hardcoded in components (see task brief §26).
 *
 * Terminology is fixed: Verified Owner · Tokenized Asset · AI Concierge · Agent Mandate ·
 * Access Gate · Passport · Claims · Owner Approval · Revoke Authority · Compliant Pools.
 */

export const BRAND = {
  name: 'Passport Kit Node',
  version: 'v1.1',
  event: 'ETHGlobal Lisbon 2026',
  network: 'Ethereum Sepolia',
  tagline: 'Give an AI agent real authority over a real asset.',
  taglineSecondary: 'Take it back in one transaction.',
  description:
    'Passport Kit Node gives verified asset owners an identity and authorization layer for AI agents operating tokenized real-world assets. Define what the agent can do, enforce access rules onchain, and revoke its authority in one transaction.',
} as const;

export const HERO = {
  disclaimer: 'TEST ENVIRONMENT ONLY, NO REAL FUNDS OR ASSETS INVOLVED',
  headline: 'Give an AI agent real authority over a real asset.',
  secondHeadline: 'Take it back in one transaction.',
  description:
    'Passport Kit Node gives verified owners a secure identity and authorization layer for AI agents operating tokenized real-world assets. Define what the agent can do, enforce access rules onchain, and revoke its authority whenever necessary.',
  // Was '#access', the landing sign-in block. That block was removed, so the CTA now
  // points at /passport, which carries the wallet connection for the app itself.
  primaryCta: { label: 'Launch App', href: '/passport' },
  secondaryCta: { label: 'Explore Architecture', href: '#architecture' },
} as const;

/** Only items that point at an existing page or an anchor on the landing page. */
export const NAV = [
  { label: 'Overview', href: '#overview' },
  { label: 'Architecture', href: '#architecture' },
  { label: 'Identity', href: '/passport' },
] as const;

export const PROBLEM = {
  title: 'The agent can act.\nNothing checks whether it should.',
  description:
    'AI agents can already hold wallets, make payments, and interact with tokenized assets. But most systems do not continuously check whether the owner remains eligible, whether the agent is still authorized, or whether an action remains within the approved mandate.',
  points: [
    'Tokenized real-world assets are growing onchain.',
    'AI agents can now hold wallets and execute transactions.',
    'Compliance requirements continue to increase.',
    'Asset owners need programmable and revocable authority.',
    'Agents should only act within explicitly approved limits.',
  ],
} as const;

export const WHY_NOW = {
  title: 'Why it is unsolved.\nWhy now.',
  points: [
    'Compliance costs are increasing as regulation evolves.',
    'AI agents are moving from assistants to operators.',
  ],
  bridgeIntro: 'Tokenized assets need a reliable authorization layer between:',
  bridge: ['the verified owner', 'the AI agent', 'the protected asset', 'the permitted action'],
  flow: [
    'The owner completes onboarding and eligibility verification.',
    'The owner acquires or connects a tokenized asset.',
    'The owner creates a limited mandate for an AI agent.',
    'The agent operates within those permissions.',
    'Sensitive actions require approval.',
    'The owner can revoke authority in one transaction.',
  ],
} as const;

export const ARCHITECTURE = {
  layers: [
    {
      id: 'layer-1',
      eyebrow: 'Layer 1',
      title: 'Identity and Access',
      components: ['Claims', 'Passport', 'Access Gate'],
      description:
        'The identity and access layer verifies the owner, represents eligibility, and decides whether a protected action may proceed.',
    },
    {
      id: 'layer-2',
      eyebrow: 'Layer 2',
      title: 'Agent and Asset Operations',
      components: ['Compliant Pools', 'AI Concierge', 'Agent Mandate', 'Owner Approval', 'Revocation'],
      description:
        'The operational layer gives an AI agent limited authority over a tokenized asset while preserving owner control.',
    },
  ],
  flow: ['Verified Owner', 'Claims and Passport', 'Access Gate', 'Agent Mandate', 'AI Concierge'],
  flowOutcomes: ['Execute Allowed Action', 'Request Owner Approval'],
  note: 'The owner can pause or revoke the agent at any time.',
} as const;




export const AGENT_MANDATE = {
  title: 'Agent Mandate',
  description: 'Define exactly what the AI Concierge is allowed to do on behalf of the asset owner.',
  fields: [
    'Assigned asset',
    'Allowed actions',
    'Spending limit',
    'Transaction frequency',
    'Approval threshold',
    'Mandate duration',
    'Current status',
  ],
  states: ['Active', 'Approval Required', 'Paused', 'Revoked'],
} as const;

export const OWNER_APPROVAL = {
  title: 'Owner Approval',
  description: "Actions outside the agent's mandate require explicit confirmation from the asset owner.",
  actions: ['Approve', 'Reject', 'View details'],
} as const;

export const REVOCATION = {
  title: 'Revoke authority',
  description: "Remove the AI agent's permission to operate the selected asset.",
  cta: 'Revoke Agent',
  safetyMessage: 'Revocation immediately prevents the agent from executing new protected actions.',
} as const;


export const IDENTITY_COPY = {
  summary:
    'Identity verification establishes the owner behind the asset. Claims and the Passport allow protected systems to verify eligibility without exposing unnecessary personal data.',
  selfieCheck: 'Personhood and liveness evidence.',
  identityCheck: 'Document-backed identity or eligibility attributes.',
} as const;


/** Integration surfaces. `status` keeps demo-only work honestly labelled. */
export const INTEGRATIONS = [
  { label: 'World ID', status: 'Integration surface' },
  { label: 'Uniswap v4', status: 'Built for this hackathon' },
  { label: 'ENS', status: 'Integration surface' },
  { label: 'Ethereum Sepolia', status: 'Live' },
] as const;

export const DASHBOARD_COPY = {
  eyebrow: 'Owner control panel',
  title: 'Asset authority, under your control.',
  description:
    'Verify ownership, define what your AI agent is allowed to do, monitor its activity, and revoke access whenever necessary.',
} as const;
