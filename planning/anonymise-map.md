# Anonymising map for the public check copy (DECISIONS 47). PRIVATE: planning/ never reaches the copy.

Written 2026-11-01 14:20 by the head of operations. The file list is `planning/anonymise-list.md` (107 files, master c2811ee).
Index rule (tools/omnikom-cli/lib/copy.mjs clientNames, in the D46 slice): `[client n]` = the n-th folder of `clients/` at
c2811ee in plain string order, skipping TEMPLATE and test. The gate matches, whole word and ignoring case, the folder slug and
every name in the H1 of `clients/<slug>/profile.md` ("# <business> (<person>, <person>): profile").

| Index | Slug | Business (profile H1) | Person(s) | Neutral slug | Neutral business | Neutral person |
|---|---|---|---|---|---|---|
| [client 0] | elev8 | ELEV8 Real Estate Group | Alex Sevilla | example-a | Example A Realty Group | Agent A |
| [client 1] | eli | Eli Buys Homes | Eli Masudi | example-b | Example B Home Buyers | Owner B |
| [client 2] | rainmaker | Rainmaker Wealth Innovations | Monica Faulve-Stach | example-c | Example C Wealth | Advisor C |
| [client 3] | vtv | Valley To Valley Realty | Francine Masudi | example-d | Example D Realty | Agent D |

Extra terms the gate does not derive (found 14:35 in docs/departments/clients.md; neutralise them too):

| Real term | Belongs to | Neutral |
|---|---|---|
| Sunny Azizi, Sunny buys homes, Sunny | [client 0]: its loan originator and the mortgage split site's working name | Lender A, "Example A mortgage site" |
| Alex buys homes | [client 0]: the cash-offer split site's working name | "Example A cash site" |
| Xpert Home Realty, Xpert Home Lending | broker of record of [client 0] and of [client 3] | Example Brokerage |
| Francine (alone, e.g. the outside folder `E:\Francine & Eli`) | [client 3] | Agent D (folder: "the client's outside project folder") |

These are listed as "Also known as:" lines in each `clients/<slug>/profile.md`, which the copy gate reads (14:40).

A national public brokerage name (eXp) is public fact and may stay where it names no client relationship.

## How every department applies it
1. Use exactly these neutral names, the same in every file, so cross-references (for example `contracts/examples/<slug>/`)
   still resolve. Folder renames follow the neutral slug, EXCEPT `clients/<slug>/`: those folders keep their real names
   (the gate derives the client list from them, and the whole `clients/` folder is private). A public file never points at a
   `clients/<slug>/` path; it says "the client's folder under clients/" and the real path goes in
   `planning/anonymise-private-notes.md`.
2. Fixtures keep their shape: same keys, same counts, same types; only names and identifying values change.
3. Identifying values the gate does not match also go: the client's web domains become `example-a.example` (and so on),
   emails `name@example-a.example`, phone numbers `+1 555 0100` to `+1 555 0199`, street addresses `100 Example Street`,
   licence numbers `LIC-EXAMPLE-A`. A public copy is a publication.
4. Prose that only says which real client a piece of work came from (history, findings) is reworded to the neutral name, or
   moved into a private file (`planning/` or `clients/`) when the real name matters to us.
5. The check is the gate itself: the next D46 copy dry run reports zero client-named files for your paths. Paste its line.
6. A job leaves `jobsNotOnCopy` only when its files are clean and the copy runs it green (DECISIONS 47 (d)).
