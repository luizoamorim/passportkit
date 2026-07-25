const APP_SESSION_KEY = 'passportkit:authenticated';
const APP_WALLET_DISCONNECTED_KEY = 'passportkit:wallet-disconnected';

/** App-scoped session markers only. Privy owns its own auth tokens. */
export function markAppAuthenticated(): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(APP_SESSION_KEY, 'true');
  window.sessionStorage.removeItem(APP_WALLET_DISCONNECTED_KEY);
}

export function clearAppSession(): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(APP_SESSION_KEY);
  window.sessionStorage.setItem(APP_WALLET_DISCONNECTED_KEY, 'true');
}

export function shouldRestoreWallet(): boolean {
  if (typeof window === 'undefined') return false;
  return window.sessionStorage.getItem(APP_WALLET_DISCONNECTED_KEY) !== 'true';
}
