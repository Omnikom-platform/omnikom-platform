# Omnikom PDF kit

Everything needed to make a document that looks like our client PDFs (the setup brief, the website reviews, the question
sheets). Internal: for Omnikom, not for clients.

## What is in this folder
| File | What it is |
|---|---|
| `omnikom-pdf-template.html` | The template: one page of HTML with our look built in (cover, sections, bullets, outcome boxes, tables, questions with tick boxes, bar chart). Logo embedded, fonts from Google Fonts. |
| `omnikom-pdf-template-example.pdf` | What the template prints to. Open it to see every building block. |
| `TEMPLATE-example.md` | The text the template was made from, written in our simple format (see "The format" below). |
| `PROMPT-for-Claude-or-ChatGPT.md` | A ready prompt: paste it with your content and the AI writes the document in our format. |
| `omnikom-logo-full.png` | The white Omnikom logo (for dark backgrounds). |
| `examples/` | A real PDF made with this look (the Omnikom setup brief, no client data) for reference. |

## Three ways to make a new PDF
1. **Easiest: send us the text.** Write the content in an email or a doc; we turn it into the PDF in minutes.
2. **With an AI (Claude or ChatGPT):** open `PROMPT-for-Claude-or-ChatGPT.md`, paste it into the chat with your content and
   attach `omnikom-pdf-template.html`. Ask it to return the finished HTML file. Then do step 3.
3. **Edit the template yourself:** open `omnikom-pdf-template.html` in a text editor, replace the words, keep the tags. Open
   it in Google Chrome, press Ctrl+P (Cmd+P on Mac), Destination "Save as PDF", More settings: **Background graphics ON**,
   Margins "Default", then Save. (Without background graphics the dark cover prints white.)

## The look (do not change)
- Colours: paper #F4F2EC (page background), ink #15161B (text), dark band #131318 (cover), lime #A8D41A for small marks only
  (bars, ticks, the highlighted row), never for text or large areas.
- Fonts: Montserrat (titles), Open Sans (text), IBM Plex Mono (small labels and page numbers).
- Page: US Letter; dark full-page cover with the logo, title, subtitle and a short lede; every other page has a running header
  (client name left, document title right) and "n / N" page numbers.
- Words: plain, short sentences; no jargon; every number with where it came from; no internal notes or codes in client documents.

## The format (for whoever writes the text)
- Line 1 `# Title`, line 2 the subtitle, then the lede paragraph (the cover text).
- `## Section title` starts a section; `## 3. Step name` numbers it.
- `- **Lead:** text` is a bullet; a bullet starting `**You get:**` becomes a highlighted outcome box.
- `| a | b |` lines make a table; a blank line then plain text makes a paragraph.
- `1. Question` with `☐ option · ☐ option` makes tick boxes; `______` makes a write-in line; an indented `Why we ask:` line
  explains it; `**Must answer.**` adds the black badge.
- `Chart: title` then indented `- label | number | note` rows makes a bar chart; a label starting with ★ is drawn in lime.
