// The site switcher's choice (DP-1.3-01: "remembered per person"). Kept in this browser; the page works without it.
const key = (userId: string, wsId: string) => `omnikom-site:${userId}:${wsId}`;

export function storedSite(userId: string, wsId: string): string {
  try { return localStorage.getItem(key(userId, wsId)) ?? ''; } catch { return ''; }
}

export function rememberSite(userId: string, wsId: string, siteId: string) {
  try { localStorage.setItem(key(userId, wsId), siteId); } catch { /* remembered only when the browser allows */ }
}

/** The site the list is showing: the remembered one when it still exists, else the first; with one site, that one. */
export function activeSiteId(sites: { id: string }[], remembered: string): string {
  return (sites.find(s => s.id === remembered) ?? sites[0])?.id ?? '';
}
