# elev8ca.com: DNS records to keep at the name-server switch

Read-only, public DNS only, 2026-11-09. Resolvers 1.1.1.1 and 8.8.8.8 (identical answers), plus Cloudflare DNS-over-HTTPS for TTLs (`tools/dns-export.mjs` of the Rainmaker repo, read-only). Registry (RDAP): registrar GoDaddy.com LLC, registered 2025-01-27, expires 2027-01-27, last changed 2026-01-28, all four client locks on, NS ns05/ns06.domaincontrol.com. Zone SOA serial 2025050802 (looks like 2025-05-08, not touched since; inference from the serial format). Raw answers: `elev.json`, `elev-out.txt`, `elev-doh.zone`.

**A full zone list cannot be read from public DNS (no AXFR).** The table lists what answered. Records at names I did not guess are invisible, and this zone has a wildcard (below), which hides which of the named hosts are real records. The GoDaddy DNS export for the zone is still needed before the switch.

## The wildcard

`*.elev8ca.com` answers A 34.210.134.29 (TTL 600): a random name (`zz-nonexistent-9x.elev8ca.com`) resolves to it. That address is an AWS EC2 host in us-west-2 (PTR `ec2-34-210-134-29.us-west-2.compute.amazonaws.com`), the same address as the apex and www. So `mail`, `email`, `autodiscover`, `pay`, `ftp`, `cpanel`, `webmail`, `homes`, `smtp`, `imap`, `pop`, `calendar`, `shop`, `blog`, `app`, `portal`, `docs`, `drive`, `sites` and every other guess all answer 34.210.134.29, and from outside nothing says which of them is an explicit record and which is only the wildcard. The old IDX host `homes.elev8ca.com` is therefore known from the owner's notes, not provable here. CNAME queries on those names return no CNAME, so none of them is a CNAME.

## Records

| type | name | value | TTL | keep at switch | why |
|---|---|---|---|---|---|
| NS | elev8ca.com | ns05.domaincontrol.com, ns06.domaincontrol.com | 3600 | replace | The switch itself. |
| SOA | elev8ca.com | ns05.domaincontrol.com dns.jomax.net 2025050802 28800 7200 604800 600 | 3600 | no | Written by the new DNS host. |
| A | elev8ca.com | 34.210.134.29 | 600 | yes (until the new site replaces it) | Current website host (old site). Zero-change at the switch: copy as is. The launch plan, not the switch, decides when it changes. |
| AAAA | elev8ca.com | none | n/a | n/a | Not set. |
| A | www.elev8ca.com | 34.210.134.29 (A, not a CNAME; could be the wildcard) | 600 | yes | Same as apex. Create it explicitly in the new zone. |
| A | *.elev8ca.com | 34.210.134.29 | 600 | yes (DNS only), review later | Catch-all. Copy it for a zero-change switch so no hostname that works today stops. Drop it only after the owner confirms which subdomains are in use (the SendGrid link-branding names in particular, which are invisible here). |
| A | homes.elev8ca.com | 34.210.134.29 (explicit or wildcard, unprovable) | 600 | yes | Old IDX site per the owner. Keep until the IDX is retired or replaced. Make it an explicit record in the new zone. |
| A | mail, email, webmail, ftp, cpanel, autodiscover, pay, smtp, imap, pop (`<name>.elev8ca.com`) | 34.210.134.29 (wildcard answer; the DoH export lists `mail`, `email`, `webmail`, `ftp`, `autodiscover`, `pay` as A rows too, but that tool cannot tell wildcard from real) | 600 | covered by the wildcard | Not Google mail hosts. Mail is Google (MX below), so these hostnames point at the web server, not at a mail server. Whether any mail client or form is configured with `mail.elev8ca.com` or `smtp.elev8ca.com` is unknown. The head must still not drop the wildcard before the export is read. |
| MX | elev8ca.com | 1 aspmx.l.google.com, 5 alt1.aspmx.l.google.com, 5 alt2.aspmx.l.google.com, 10 alt3.aspmx.l.google.com, 10 alt4.aspmx.l.google.com | 3600 | **yes - never break** | Google Workspace mail. Copy exactly. |
| TXT | elev8ca.com | `v=spf1 include:dc-aa8e722993._spfm.elev8ca.com ~all` | 3600 | **replace - never break** | SPF, and it depends on a GoDaddy-hosted helper (below). Replace with `v=spf1 include:_spf.google.com ~all`, which is what the helper expands to today. |
| TXT | dc-aa8e722993._spfm.elev8ca.com | `v=spf1 include:_spf.google.com ~all` | n/a | no (do not copy) | GoDaddy's managed SPF helper: answers only while GoDaddy hosts the zone (the same hash `dc-aa8e722993` appears on other GoDaddy-hosted zones). Once the NS leave GoDaddy it disappears and the apex SPF above would fail (`permerror`) for all Google mail. This is the same trap the Rainmaker plan fixed. |
| TXT | elev8ca.com | `google-site-verification=0eur3RXEX8y-MeFDmIPx-y0dBDVyGi3YdhUWEa-8Rvo` | 3600 | yes | Ownership proof for Search Console and/or Workspace. Removing it can silently drop access. |
| TXT | _dmarc.elev8ca.com | `v=DMARC1; p=none;` | 600 | **yes - never break** | DMARC, monitor only, no report address. Copy exactly (changing the policy is a separate decision). |
| TXT | google._domainkey.elev8ca.com | `v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEApIJ3+QOSMcHhM9zLN6+fWb+1mdhRbTLt/X8PE0N5bWIurVghexDjE4y+aYt8Fs1j0A845p810SoXBjVY43LzF+/Ze/YkOuRsZYennXx8EGkN+5AMiz1WbXRNe7cfgcSZxhDb0YuNK8e9ZINYps4m2Feyzfackpi8YLVRZVTHhcDKKcEv9d4Jx6w4JyiuJk8s7` + `M8EoKGDYYoNLg0g4tAGgCBGvpTk9eEDJRxpFfV59gpMiL9t04Voxa2qAoqVWASYzHFU0mNvPsAJldiPHBYkJQugWYT6rC3Q1wFVueLr8etd7Nte7xZoboMv87uksEwKXG9+0ez5r4Xy7EBnw3Ly6wIDAQAB` (2048-bit; the record is split into two strings in DNS, joined as one value) | 600 | **yes - never break** | Google Workspace DKIM. Copy as one joined value; in a Cloudflare TXT record paste the two strings joined with no space. |
| CNAME | s1._domainkey.elev8ca.com | s1.domainkey.u52617406.wl157.sendgrid.net | 600 | **yes - never break** | SendGrid DKIM (account u52617406). Someone sends mail from this domain through SendGrid (probably the CRM or the old site's forms). Must be DNS only (grey cloud) in Cloudflare or the SendGrid check fails. |
| CNAME | s2._domainkey.elev8ca.com | s2.domainkey.u52617406.wl157.sendgrid.net | 600 | **yes - never break** | Second SendGrid DKIM key. Same rule. |
| CNAME/TXT | other SendGrid names (`em####`, `url####`, `<account id>`) | not found (probed em, em1, url, url2217, links, bounce, 52617406: no CNAME) | n/a | unknown | SendGrid domain authentication usually adds an `em####` CNAME and link branding CNAMEs. They are not at the names I tried, and the wildcard hides the numbered ones. Only the export shows them. |
| CNAME | _domainconnect.elev8ca.com | _domainconnect.gd.domaincontrol.com (TXT `domainconnect.api.godaddy.com`) | 3600 | no | GoDaddy's one-click setup record. Useless after the move; harmless to omit. |
| CAA | elev8ca.com | none | n/a | n/a | Not set. |
| SRV | _autodiscover._tcp.elev8ca.com | none (the A answer there is the wildcard) | n/a | n/a | Not set. |
| DKIM selectors | default, selector1, selector2, k1 (`._domainkey`) | no TXT or CNAME of their own (a name that only matches the wildcard returns A, not TXT) | n/a | n/a | Only google, s1 and s2 exist. |
| TXT | mta-sts, _mta-sts, status | none | n/a | n/a | Not set. |

TTLs come from DNS-over-HTTPS (remaining cache TTL, so equal to or below the configured value). NS 3600 and SOA values are GoDaddy defaults seen in the answers.

## Never break (mail)

MX (5 Google hosts), the apex SPF in its replaced form, `google._domainkey`, `s1._domainkey` and `s2._domainkey` (both DNS only), `_dmarc`. Test: send and receive from a real mailbox, and have SendGrid re-verify the domain after the switch, before and after, on the day.

## What is still needed

- GoDaddy DNS export (or screenshot of the DNS page) for elev8ca.com: shows real records vs wildcard answers, the SendGrid numbered CNAMEs and anything at names not guessed.
- Who sends through SendGrid (account u52617406 / wl157) and from which system, to confirm those two CNAMEs and find the rest.
- Whether `homes.elev8ca.com` and the apex 34.210.134.29 host must stay up after the new site launches.
- Nothing was changed anywhere to produce this file; the client owns the registrar account (GoDaddy), the switch needs their login.
