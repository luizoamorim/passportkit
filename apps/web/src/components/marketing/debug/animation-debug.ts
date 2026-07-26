/**
 * TEMPORARY runtime diagnostics for the /services animations.
 * Remove this file, AnimationDebugPanel and their call sites once the work is signed off.
 *
 * A plain mutable object rather than React state: the sections write to it on every
 * scroll frame, and the panel reads it on rAF, so diagnostics never cause re-renders.
 */

export type AnimationDebugState = {
  viewportWidth: number;
  viewportHeight: number;
  reducedMotion: boolean;
  enhanced: boolean;
  gsapReady: boolean;
  scrollTriggerCount: number;
  servicesProgress: number;
  trackTranslateY: number;
  wordClipPercent: number;
  securityProgress: number;
  events: string[];
};

export const debugState: AnimationDebugState = {
  viewportWidth: 0,
  viewportHeight: 0,
  reducedMotion: false,
  enhanced: false,
  gsapReady: false,
  scrollTriggerCount: 0,
  servicesProgress: 0,
  trackTranslateY: 0,
  wordClipPercent: 0,
  securityProgress: 0,
  events: [],
};

export const isDebugEnabled = process.env.NODE_ENV !== 'production';

/** Logs to the console and keeps the last few events for the on-screen panel. */
export function debugEvent(message: string) {
  if (!isDebugEnabled) return;
  debugState.events = [...debugState.events.slice(-5), message];
  // eslint-disable-next-line no-console
  console.info(`[services-anim] ${message}`);
  if (typeof window !== 'undefined') {
    // Exposed so an automated browser can assert on runtime values.
    (window as unknown as { __servicesDebug?: AnimationDebugState }).__servicesDebug = debugState;
  }
}

export function publishDebug(patch: Partial<AnimationDebugState>) {
  if (!isDebugEnabled) return;
  Object.assign(debugState, patch);
  if (typeof window !== 'undefined') {
    (window as unknown as { __servicesDebug?: AnimationDebugState }).__servicesDebug = debugState;
  }
}
