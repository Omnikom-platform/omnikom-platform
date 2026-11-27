// Who may send a session report (docs/advisor/r3/HANDOVER-collector.md): only a pack on this list, only when its meta.report is true
// (off by default), never under Global Privacy Control. factory/advisor/pack/validate.mjs holds the same list (its test copies only pack/),
// and test/test-report.mjs checks that the two are equal.
export const REPORT_PACKS = ['omnikom-io'];
export const REPORT_URL = '/api/advisor-report';

export function reportAllowed(pack, nav) {
  const m = pack && typeof pack.meta === 'object' && pack.meta ? pack.meta : {};
  if (m.report !== true) return false;
  if (!REPORT_PACKS.includes(m.pack)) return false;
  if (nav?.globalPrivacyControl === true) return false;
  return true;
}
