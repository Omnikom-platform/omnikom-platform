# crm-map

Maps the Omnikom CRM's lead fields to a client's own CRM sheet layout and back (17-EXPANSION-MAP.md 3.3).
Pure ES modules, no dependencies, no network; `map.mjs` runs unchanged in Node 20+ and in a browser. CSV only (no XLSX).

- `map.mjs`: `normaliseHeader`, `score`, `proposeMap`, `exportRows`, `importRows`, `toCsv`, `parseCsv`, `validateTemplate`
- `dictionary.mjs`: the synonym data, one entry per our field, each non-obvious synonym tagged with where it is seen
- `templates/`: shipped templates (`hubspot.json`, `google-contacts.json`)

## Run the tests
    node tools/crm-map/test/run.mjs      # prints "N passed, M failed", exit 1 on any failure
    node tools/crm-map/test/mutate.mjs   # breaks map.mjs one rule at a time; every mutant must turn the tests red

## Template shape (the same as `crm_templates.columns` and `.value_maps`)
    { "columns": [ { "header": "First Name", "field": "name", "transform": "first" }, ... ],
      "value_maps": { "status": { "new": "New Lead" }, "status@Lifecycle Stage": { "new": "Lead" } } }
`field` is ours, dotted for `answers.*`. `transform`: `first` `last` (name), `street` `city` `state` `postal_code` (address),
`e164` `us` (phone), `iso` `us` `eu` (date; `us` is MM/DD/YYYY on a date field). A `field@Header` value map beats `field`.
Spreadsheet formulas in exported cells get a leading `'`. Two columns may not share a header (`exportRows` and `importRows`
refuse the template). A field name may not be an `Object.prototype` name (`toString`, `valueOf`, `hasOwnProperty`,
`__proto__`, `constructor` and the rest) or `prototype`; such a template is refused with `T-FIELD`.

## Proposing a map
`proposeMap(ourFields, theirHeaders, sampleRows, labels)` returns `{ columns, unmapped, splits, warnings }`.
- When two headers score the same for one field (HubSpot "Lifecycle Stage" and "Lead Status" for `status`), the header that
  matches the synonym listed first for that field in `dictionary.mjs` wins, whatever the column order. If the rank is equal too,
  the lower column wins. The loser is in `unmapped.headers` and its `best` names the field it lost (`best` is taken over all
  fields, taken or not).
- `labels` (optional) is `{ field: label }`, the label our contract shows for an industry field (`{ 'answers.budget': 'Price range' }`).
  A header equal to the label (any case or punctuation) is an exact match, score 1, as if the label were one more synonym of that field;
  it is exact only, never fuzzy. On a tie a match from the dictionary goes before one from a label, so a label never takes a header
  away from a dictionary synonym of another field. With no `labels` (or a label that matches nothing) the proposal is the same as
  before. `score(ourField, theirHeader, sampleValues, ourLabel)` takes the label too.
- A compound header ("State/Province", "Fax | Phone") is also tried part by part, split on `/` and `|`.
- `warnings` are sentences: the sheet looks non-English (fewer than half the headers hold a word the dictionary knows) and some
  headers mapped nothing; or there is a single header that holds `;` (a semicolon file read with commas).

## Names
`first` / `last` split on the last word. Particles before it stay with the last name (van, van der, van den, de, de la, del,
della, di, da, dos, du, le, la, von, bin, al, el, St., St): "Maria van der Berg" is Maria / van der Berg. A suffix (Jr., Sr.,
II, III, IV) stays with the last name: "John Smith Jr." is John / Smith Jr. One comma is `Last, First`: "Smith, John" is John /
Smith; "John Smith, Jr." keeps Jr. as a suffix. Joining gives the same name back, except that "Smith, John" comes back as "John Smith".

## Phones
`e164` writes `+15105550142` for a US number. A number that already starts with `+` and has 8 to 15 digits is written as `+`
and its digits (spaces and punctuation stripped): `+44 20 7946 0958` is `+442079460958`. Nothing is checked beyond the digit
count, so a trunk zero written in brackets (`+44 (0)20 ...`) is kept as a digit.
A bare number (no `+`) is read as US, 10 digits or 11 with a leading 1, only when `options.defaultCountry` is `US` (the default).
**A non-US bare number needs a leading `+` and country code**: no other country's rules are built in, so any other
`defaultCountry` only switches the US reading off. `us` formats only US numbers.
A number that cannot be formatted is written as it was and `exportRows(...).warnings` holds one `{ row, header, message }`
for it. The array `exportRows` returns carries `warnings` as a non-enumerable property, so it still compares and serialises as a
plain list of rows. `importRows` puts the same kind of warning in its `warnings`.

## Dates and time zones
Leads hold UTC. `exportRows` and `importRows` take `options.timezone`, an IANA name (`America/Los_Angeles`), default `UTC`; an
unknown name throws `T-TIMEZONE`.
- Export: the `us` and `eu` formats print the day in that zone: `2026-11-03T23:30:00-08:00` is `11/03/2026` in
  `America/Los_Angeles` and `11/04/2026` in UTC. The `iso` format is the same instant in UTC whatever the zone. A timestamp with
  no offset is read as UTC on export.
- Import: a timestamp with no offset and no `Z` (`2026-11-03 23:30`) is read as that zone and stored as a UTC instant; one with
  an offset or `Z` keeps its own. A date with no time (`10/29/2026`, `2026-10-29`) has no zone to move and stays that day.

## Header case on import
`importRows` finds a template header in a file row by the exact header first, else by the one header that differs from it only in
case (HubSpot's docs write "First name", its exports "First Name"). Two case variants and no exact one are not guessed between: the
cell is skipped. Value-map keys `field@Header` stay exact on the header.

## Duplicate headers
`parseCsv` renames a repeated header (`Phone`, `Phone (2)`). `importRows` adds a warning (`row: null`, `header: "Phone (2)"`)
when the file holds such a renamed header next to its base, since the second column is ignored unless the template names it.
`parseCsv` reads `;` as the separator when the header line has more semicolons than commas (outside quotes) and says so in its
warnings; `{ delimiter: ',' }` or `{ delimiter: ';' }` turns the guess off.

## Known limits
Not handled, on purpose or not yet:
- **Non-English headers.** The dictionary is English only. A sheet in another language maps nothing and `proposeMap` says so;
  the wizard has to map it by hand.
- **XLSX.** CSV only. Save the sheet as CSV first.
- **International phone formatting.** Beyond normalising a `+` number to `+digits` there is none: no country table, no check
  that the digit count fits the country, no trunk-zero removal, no formatting of non-US numbers for display. A bare non-US number
  is left as it was, with a warning, unless it carries `+` and the country code.
- **Time zones for dates without a time.** A date alone is a calendar day and is never shifted. A date written with a time but in
  a slash format (`10/29/2026 11:30 PM`) keeps only the day; the time is dropped and no zone is applied.
- A single-column CSV whose header contains `;` and no `,` is read as semicolon separated unless `{ delimiter: ',' }` is passed.
- Names are split by word rules, not a name list. The first word is always the first name (`Al Pacino` is Al / Pacino), a surname
  that is also a particle sits with the last name (`Hoa Le Nguyen` is Hoa / Le Nguyen), and a name with three or more commas
  that is not `Last, First, Suffix` is split on spaces.

## Sources
- `templates/hubspot.json` column labels, in HubSpot's case ("First name", "Last name", "Email", "Phone number", "Lead status",
  "Lifecycle stage", "Message"), read 2026-11-04:
  https://knowledge.hubspot.com/properties/hubspots-default-contact-properties (page "last updated September 21, 2026", default contact
  property labels) and https://knowledge.hubspot.com/import-and-export/set-up-your-import-file (page "last updated September 11, 2026":
  Email required, First name and Last name accepted, a phone as +[country code][number]). The same sources are cited in
  `supabase/functions/test/templates.test.ts`. Matching on import stays case-insensitive (see "Header case on import").
- The two HubSpot status value maps (Lead status and Lifecycle stage option labels) are on no public page: **UNVERIFIED**.
- `templates/google-contacts.json`: Google publishes no first-party header list (BLOCKED, needs a real export from a test account).

## UNVERIFIED
Written 2026-10-29 with no browser. Every vendor header in `dictionary.mjs`, the Google template (column names, source URLs) and
the HubSpot status value maps and Google import rules are from memory and marked `"readOn"` UNVERIFIED (the HubSpot column labels were
checked 2026-11-04, see Sources).
No kvCORE or Follow Up Boss template is shipped. The lead checks each against the vendor's import page before a client sees it.
