# Credentials: where they live and how to use them (no values in this file)

All keys are on Omnikom's own accounts (work email amer@omnikom.io, 2026-10-26), reused for every client. None belongs to a client.

## The file
`E:\Omnikom Platform\.secrets\api-keys.env`. The `.secrets/` folder and every `.env` are in `.gitignore` (checked:
`git check-ignore -v .secrets/api-keys.env` -> `.gitignore:2:.secrets/`). Never commit, print, paste into chat or copy into a client
folder. Tools read it by path, e.g. the audit skill: `doctor.mjs <url> --dotenv "E:\Omnikom Platform\.secrets\api-keys.env"`,
`start.mjs ... --env-file "E:\Omnikom Platform\.secrets\api-keys.env"`.

| Name in the file | Service | Account / project | Limits |
|---|---|---|---|
| `PSI_API_KEY` | PageSpeed Insights API | Google Cloud, organisation omnikom.io, project **Omnikom SEO** (`omnikom-seo`), key `omnikom-seo-psi-crux` | restricted to PageSpeed Insights + Chrome UX Report APIs; no billing on the project |
| `CRUX_API_KEY` | Chrome UX Report API | same key as above | same |
| `GEMINI_API_KEY` | Gemini API (Google AI Studio) | "Default Gemini API Key" in project "Default Gemini Project" (`gen-lang-client-0166882660`), free tier | new key format (starts `AQ.`) |
| `BING_WEBMASTER_KEY` | Bing Webmaster Tools API | Bing Webmaster account signed in with Google (amer@omnikom.io); verified site omniskipx.com | account-level key |

`PEWP_GEMINI_TERMS_ACK=1` is set (owner, 2026-10-26: "okay with Gemini" after the Gemini API Additional Terms tab was opened):
we may keep derived fields (cited domains, whether we are cited) from grounded Gemini answers. Doctor: "acknowledged".

Also in the account: a second Google Cloud project "My First Project" (`static-retina-512814-h5`) with PageSpeed Insights enabled,
created during sign-up; unused by our tools (delete it or leave it).

## Tools
- `tools/save-secret-from-clipboard.ps1 -Name <NAME> [-Prefix <start>]`: after clicking a provider's Copy button, saves the clipboard
  as `NAME=value` in the file, prints only name + length, clears the clipboard. Refuses an empty or wrong-shaped value.
- `tools/check-api-keys.mjs`: one small live call per key, prints only HTTP status. 2026-10-26: all four `HTTP 200 OK`; watched-fail
  with a wrong Gemini key -> `HTTP 401 API key not valid`.

## Rotate or revoke
Google Cloud console > APIs & Services > Credentials (project Omnikom SEO) > the key > Regenerate or Delete. AI Studio > API keys.
Bing Webmaster Tools > Settings > API access > regenerate (the circular arrow) or delete. Then save the new value with the
clipboard script and re-run `check-api-keys.mjs`.
