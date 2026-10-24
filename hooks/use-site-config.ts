'use client';

// GitHub Pages serves static files. Reading limits are local safeguards for
// browser memory and do not depend on a server/session endpoint.
const BROWSER_SITE_CONFIG = {
  maxTextLength: 5000,
  maxPhrases: 100,
} as const;

export function useSiteConfig() {
  return BROWSER_SITE_CONFIG;
}
