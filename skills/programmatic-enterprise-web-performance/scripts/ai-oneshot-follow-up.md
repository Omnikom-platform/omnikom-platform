# The follow-up about the business by name (message 2 of 2, same chat)

Filled by `ai-oneshot.mjs build`. `{{NAME}}` is the business's name, `{{KIND}}` its kind, `{{HOME}}` its first place in full.
Sent only after the first reply is saved, in the SAME chat, so the assistant can say why the business was or was not in its own
lists. Everything below the marker line is sent as it is.

---PROMPT---
One more question, about one specific business: {{NAME}}, a {{KIND}} in {{HOME}}. If you know of more than one business with that name, answer only for the one in {{HOME}}. Please use web search if you have it. Do not ask me anything back.

Answer in exactly this layout and write nothing before or after it:

## About this business
One table with these twelve rows:

| Item | What you know | Source (full web address) |
| Do you know this business (YES, NO or NOT SURE) | | |
| What they do | | |
| Areas they serve | | |
| Company they belong to | | |
| Address | | |
| Phone | | |
| Website | | |
| Rating and number of reviews, and on which site | | |
| What they are known for | | |
| Would you recommend them to someone looking for a {{KIND}} in {{HOME}} (YES, NO or NOT SURE), and why | | |
| Why they were, or were not, in your recommendations above | | |
| What is missing or unclear about them online that would make you more likely to recommend them | | |

## Where they appear
Up to 5 pages that mention them, the best known first:

| Rank | Site | Full web address | What it says (8 words at most) |

Rules:
- Write UNKNOWN in any cell you cannot fill. Never make up a phone number, an address, a rating or a web address.
- Write every web address in full, starting with https://.
