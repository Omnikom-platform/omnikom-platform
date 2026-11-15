# The one prompt each assistant gets (message 1 of 2)

Filled by `ai-oneshot.mjs build` from the run's business file. `{{KIND}}` is the kind of business, `{{PLACES}}` every place in
full (city, state, country), `{{QUESTIONS}}` the numbered questions (for each place one general question and one per service
word), `{{PLACE_HEADINGS}}` the headings Part 2 asks for. The business's own name and address are never in this text: an
assistant that reads the name lists the business. Everything below the marker line is sent as it is. Change a word here and
every locked prompt is stale: the command refuses to send or save until the text is built, read and locked again.

---PROMPT---
I am comparing options for a {{KIND}} in {{PLACES}}. I want your own recommendations: the same ones you would give a person who asked you each question below by itself. Please use web search if you have it.

The questions:
{{QUESTIONS}}

Answer all of them in one reply, in exactly the layout below, so that I can compare answers side by side. Write nothing before or after the layout. Do not ask me anything back: if something is unclear, take the most usual meaning and note it in Part 3.

## Part 1: your recommendations
One table for each question, in order, each under a heading with the question's number (### Q1, ### Q2, and so on). Up to 5 rows per table, your best recommendation first:

| Rank | Name | Company | Why you recommend them (12 words at most) | Source (full web address) |

## Part 2: where you look
One table for each place, each under a heading with the place's full name ({{PLACE_HEADINGS}}). The websites you rely on most when you choose a {{KIND}} there, up to 5, the most important first:

| Rank | Website | Full web address | What you take from it (8 words at most) |

## Part 3: how you answered
One table with these five rows:

| Item | Your answer |
| Searched the web for this reply, or answered from memory | |
| The place you understood each city to be (city, state, country) | |
| Date of the newest source you used | |
| The three things that weigh most when you recommend one {{KIND}} over another | |
| Anything you assumed | |

Rules:
- Every row is a real person or business that you would stand behind for that place. A row can be a person, a team or a company: write what you would really tell me. "Name" is who you recommend; "Company" is the firm they belong to (repeat the name if it is one business).
- If you know fewer than 5 for a question, list fewer. If you know none, write one row with UNKNOWN as the name.
- Write UNKNOWN in any cell you cannot fill. UNKNOWN helps me more than a guess: never make up a name, a reason or a web address.
- Write every web address in full, starting with https://.
