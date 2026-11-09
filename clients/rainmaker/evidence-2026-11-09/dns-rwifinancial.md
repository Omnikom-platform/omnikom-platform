# rwifinancial.com: DNS records to keep at the name-server switch

Read-only, public DNS only, 2026-11-09. Resolvers 1.1.1.1 and 8.8.8.8 (both gave identical answers), plus plain DNS queries straight to three name-server sets so each zone can be seen separately: jaxson/alina.ns.cloudflare.com, ns43/ns44.domaincontrol.com (GoDaddy), cruz/leland.ns.cloudflare.com (Omnikom). Nothing was changed anywhere. Raw answers: `rwi.json`, `rwi-auth.json`, `rwi-doh.zone` in this folder; the 10-23 export is `E:\Rainmaker\.pewp\captures\dns-rwifinancial-2026-10-23.zone`.

**A full zone list cannot be read from public DNS (no AXFR).** This file lists the records that answered. Anything with a name I did not guess (a custom subdomain, an odd TXT) is invisible. The registrar/host export is still needed: the GoDaddy DNS export (the zone at ns43/ns44) and, because the live delegation is now the Cloudflare zone jaxson/alina, that zone's export from whoever owns it.

## 1. What changed since the 10-23 plan (read this first)

| | 10-23 (plan, LAUNCH.md) | today (2026-11-09) |
|---|---|---|
| Name servers the world uses | ns43/ns44.domaincontrol.com (GoDaddy) | **alina.ns.cloudflare.com / jaxson.ns.cloudflare.com** (a Cloudflare zone that is not Omnikom's) |
| Omnikom zone | cruz/leland, pending, 12 records imported | still pending; direct query to cruz still shows the 10-23 import (apex A 100.24.208.97, www CNAME s.multiscreensite.com, 5 legacy MX, pay CNAME) |
| GoDaddy zone itself | 15 records | edited: SOA serial 2026022303 became 2026110608 (looks like 2026-11-06, 8th change that day; inference from the serial format, matches the RDAP date) |
| Registry record (RDAP, rdap.verisign.com) | n/a | registrar GoDaddy.com LLC, registered 2026-02-06, expires 2031-02-06, **last changed 2026-11-06**, NS alina/jaxson, all four client locks on. This confirms the change was made at the GoDaddy registrar on 2026-11-06 (same day as the zone serial). |
| Who did the NS change | n/a | UNPROVEN. Not the Omnikom account (that zone is cruz/leland). Monica's written OK covers a switch to cruz/leland only |

Consequences, as facts:
1. `domain-migration-plan.md` step 4 ("change the two name servers to cruz and leland") would now be a switch FROM alina/jaxson TO cruz/leland, not from GoDaddy.
2. Its rollback ("set name servers back to ns43/ns44") would not restore the 10-23 state: the GoDaddy zone now has a different apex (A 3.33.130.190 and 15.197.148.33, www CNAME to the apex), a single MX, a changed SPF, no `pay` and no google-site-verification (table 3).
3. The Omnikom zone (cruz/leland) is missing records that exist in the live zone and in GoDaddy: **`google._domainkey` (DKIM) is not in the Omnikom zone**. Moving the name servers to cruz/leland as it stands would drop DKIM signing for Rainmaker's Google mail. Never break: add it first.
4. `pay.rwifinancial.com` does not resolve today (NXDOMAIN) in either the live zone or the GoDaddy zone. The plan says it is "kept exactly as is". It still exists in the Omnikom zone only. UNPROVEN whether Monica or someone removed it on purpose or the new zone never had it; the GoDaddy payment page is down for any visitor today if it was in use.
5. `google-site-verification=sTaBzp1W...` (the Search Console / Workspace verification) is gone from both live-answering zones; it exists only in the Omnikom zone.

## 2. Records that answered today, by name (resolver view = live zone jaxson/alina)

| type | name | value | TTL | keep at switch | why |
|---|---|---|---|---|---|
| NS | rwifinancial.com | alina.ns.cloudflare.com, jaxson.ns.cloudflare.com | 86400 | replace | The switch itself: becomes cruz/leland. Needs the owner of the alina/jaxson zone, or the registrar, and Monica's written OK for the new target. |
| SOA | rwifinancial.com | alina.ns.cloudflare.com dns.cloudflare.com 2419481498 ... | 1800 | no | Written by the DNS host; the Omnikom zone has its own. |
| A | rwifinancial.com | 104.21.63.16, 172.67.142.102 (Cloudflare proxy IPs) | 300 | replace | Web, not mail. Becomes whatever the launch plan says (apex redirect to www, or the Worker). Not a copy-over. |
| AAAA | rwifinancial.com | 2606:4700:3033::6815:3f10, 2606:4700:3035::ac43:8e66 | 300 | replace | Same as the A rows (proxy IPs). |
| CNAME/A | www.rwifinancial.com | answers A 104.21.63.16, 172.67.142.102 and the same two AAAA (a proxied record; whether it is a CNAME inside the zone cannot be seen from outside) | 300 | replace | Serves the copy of our site today. At launch it points to the new Worker custom domain; the Omnikom zone's current www (CNAME s.multiscreensite.com, old Duda) must be deleted first (LAUNCH.md). |
| MX | rwifinancial.com | 1 smtp.google.com. | 300 | **yes - never break** | Google Workspace mail. Today a single record (Google's single-host form). The Omnikom zone and the 10-23 export have the five legacy hosts (aspmx.l.google.com 1, alt1/alt2 5, alt3/alt4 10). Either set is valid for Google; ship exactly one set, matching what is live now so nothing changes for mail. |
| TXT | rwifinancial.com | `v=spf1 include:_spf.google.com ~all` | 300 | **yes - never break** | SPF. Same value in all three zones. (The 10-23 export had `include:dc-aa8e722993._spfm.rwifinancial.com`, a GoDaddy-only helper; it is not needed and must not be copied.) |
| TXT | rwifinancial.com | `google-site-verification=sTaBzp1WE6KSH_UC1hEjlaorqKyHKk0LAF03DX_JAD0` | n/a (not answering today) | yes | Missing from the live zone and from GoDaddy today; present in the Omnikom zone and the 10-23 export. Needed for Search Console / Workspace ownership proof (LAUNCH.md says it is "present"). Keep, harmless. |
| TXT | _dmarc.rwifinancial.com | `v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net;` | 300 | **yes - never break** | DMARC, unchanged since 10-23 in all three zones. The report address is GoDaddy-hosted; leave it. |
| TXT | google._domainkey.rwifinancial.com | `v=DKIM1;k=rsa;p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEArz+pQc3SMKbd9gsiXtRWtX4wfp/gjoLOxnRSAJGgx6+a6TgTZluK...` (2048-bit public key, full value in `rwi.json`) | 300 | **yes - never break** | Google Workspace DKIM signing; created after 10-23 (not in the 10-23 export). **Not present in the Omnikom zone**: add before the switch. The plan's "Monica sends us the record" step has evidently been done by someone already. |
| CNAME | pay.rwifinancial.com | (nothing today) 10-23: `paylinks.commerce.godaddy.com` | 3600 (10-23) | yes (restore) | GoDaddy payment page. Absent today in the live and GoDaddy zones, present in the Omnikom zone. Put it in the final zone as DNS only (grey cloud) and confirm with Monica. |
| CNAME + TXT | _domainconnect.rwifinancial.com | live zone: TXT `api.cloudflare.com/client/v4/dns/domainconnect` plus proxied A/AAAA; GoDaddy zone and Omnikom zone: CNAME `_domainconnect.gd.domaincontrol.com` | 300 / 3600 | no | Auto-created by the DNS host for its own "Domain Connect" one-click setup. Not needed for web or mail. (LAUNCH.md imports it DNS only; harmless either way.) |
| CAA | rwifinancial.com, www | none | n/a | n/a | No CAA anywhere. Nothing to keep. |
| SRV | _autodiscover._tcp.rwifinancial.com | none | n/a | n/a | Not set. |
| DKIM selectors | default._domainkey, selector1._domainkey, selector2._domainkey, k1._domainkey, s1._domainkey, s2._domainkey | none (ENODATA/NXDOMAIN on all three zones where answered) | n/a | n/a | Only `google._domainkey` exists. No record at these selectors, so no sign of SendGrid, Mailchimp or Microsoft 365 signing (other selector names could exist and are invisible). |
| mail, email, autodiscover, ftp, cpanel, webmail, homes, smtp, imap, pop, calendar, shop, blog | `<name>.rwifinancial.com` | none (NXDOMAIN) | n/a | n/a | No wildcard on this zone (random subdomain gives NXDOMAIN). |

TTLs are the remaining TTL as seen through a resolver; the zone's configured TTL can be higher. NS and SOA of the GoDaddy zone: TTL 3600 / 600.

## 3. Row by row against the 10-23 GoDaddy export (15 records)

The plan says 15 records, LAUNCH.md says 12 imported. Both are true: the export file has 15 lines (A 1, MX 5, TXT 2, NS 2, SOA 1, CNAME 4). Cloudflare does not import NS (2) or SOA (1) because it writes its own, so 15 - 3 = 12 imported. No discrepancy.

| # | 10-23 export record (TTL) | GoDaddy zone today (ns43/ns44, direct) | Live zone today (alina/jaxson, via 1.1.1.1 and 8.8.8.8) | Omnikom zone today (cruz, direct) | Verdict |
|---|---|---|---|---|---|
| 1 | A rwifinancial.com 100.24.208.97 (600) | A 3.33.130.190, 15.197.148.33 (600) | A 104.21.63.16, 172.67.142.102 + AAAA (proxied) (300) | A 100.24.208.97 (300) | CHANGED in both live-answering zones; replace at launch |
| 2 | MX 1 aspmx.l.google.com (3600) | MX 1 smtp.google.com | MX 1 smtp.google.com (300) | MX 1 aspmx.l.google.com | CHANGED form, same provider; mail works either way |
| 3 | MX 5 alt1.aspmx.l.google.com | (not present; single MX) | (not present) | present | CHANGED, see row 2 |
| 4 | MX 5 alt2.aspmx.l.google.com | (not present) | (not present) | present | CHANGED, see row 2 |
| 5 | MX 10 alt3.aspmx.l.google.com | (not present) | (not present) | present | CHANGED, see row 2 |
| 6 | MX 10 alt4.aspmx.l.google.com | (not present) | (not present) | present | CHANGED, see row 2 |
| 7 | TXT google-site-verification=sTaBzp1W... (3600) | NOT present | NOT present | present | MISSING in the live zones; keep, restore |
| 8 | TXT v=spf1 include:dc-aa8e722993._spfm.rwifinancial.com ~all (3600) | `v=spf1 include:_spf.google.com ~all` | same | same | CHANGED to the working form in all three zones (the GoDaddy-only helper is gone) |
| 9 | NS ns43.domaincontrol.com (3600) | ns43, ns44 | alina, jaxson | cruz, leland | CHANGED; the switch |
| 10 | NS ns44.domaincontrol.com (3600) | (as row 9) | (as row 9) | (as row 9) | CHANGED |
| 11 | SOA ns43 ... 2026022303 (3600) | serial 2026110608 | serial 2419481498 (Cloudflare) | serial 2419480930 | CHANGED, expected |
| 12 | CNAME www -> s.multiscreensite.com (3600) | CNAME www -> rwifinancial.com | A/AAAA proxied to Cloudflare | CNAME www -> s.multiscreensite.com | CHANGED; Omnikom zone still has the old Duda target (delete before deploy per LAUNCH.md) |
| 13 | CNAME pay -> paylinks.commerce.godaddy.com (3600) | NOT present | NOT present (NXDOMAIN) | present | MISSING in the live zones; restore |
| 14 | TXT _dmarc `v=DMARC1; p=quarantine; ...rua=mailto:dmarc_rua@onsecureserver.net;` (3600) | same | same | same | UNCHANGED |
| 15 | CNAME _domainconnect -> _domainconnect.gd.domaincontrol.com (3600) | same | TXT api.cloudflare.com/... plus proxied A/AAAA | CNAME + a TXT api.cloudflare.com/... | CHANGED, harmless |
| new | (not in export) TXT google._domainkey (Google DKIM) | present | present | **absent** | NEW since 10-23; add to the Omnikom zone |

Direct queries to ns43 timed out on two names (`k1._domainkey` MX and `dc-aa8e722993._spfm` CNAME probes), so the GoDaddy column is complete for the names in the table but those two probes are not conclusive.

## 4. Switch checklist from this evidence (nothing done, for the head to decide)

1. Get the real exports: GoDaddy zone, and the alina/jaxson zone from its owner. Public DNS cannot show hidden or unguessed names.
2. Do not switch to cruz/leland until the Omnikom zone has: `google._domainkey` TXT, the same MX set as live, SPF as above, DMARC as above, `pay` (grey cloud), `google-site-verification`. Then delete its stale apex A and www CNAME (LAUNCH.md).
3. Ask who owns and who edited alina/jaxson and the GoDaddy zone on 2026-11-06: until known, treat the live zone as someone else's production.
4. Send and receive a test mail from a Rainmaker mailbox before and after (plan step 2 and 5).
5. The plan's rollback target (ns43/ns44) no longer restores the 10-23 state; the rollback target is now the zone currently answering.
