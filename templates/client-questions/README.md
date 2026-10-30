# Client questions: template (sops/clients/client-questions.md, DECISIONS 17)

These files are the model for what a V2 client is asked before launch: ONE sheet of at most 12 questions, plus one short
forwardable email. The worked example is ELEV8 (2026-10-28): `E:\Alex Sevilla\deliverables\questions-for-alex.md` and
`E:\Alex Sevilla\icm\work\p1\REVIEW-EMAIL.md`.

1. Copy `questions-for-CLIENT.md` and fill the <...> parts. Keep only the questions that apply, and add no topic outside the
   SOP catalogue.
2. Check the sheet:
   `node tools/client-questions/questions-pdf.mjs --md <sheet.md> --who "<Business>" --check`
   It refuses more than 12 questions, a question without "Why we ask:", and any internal Q-id or marker.
3. After the preview is live:
   `node tools/client-questions/questions-pdf.mjs --md <sheet.md> --who "<Business>" --base https://<preview> --pages "Home=/;Team, plus each person's own profile=/team;..."`
4. Write the email from `review-email.md`. The owner reads the sheet, the email and the live link before anything is sent.
