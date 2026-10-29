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
Dates are read in UTC; `us` and `eu` carry the day only. Spreadsheet formulas in exported cells get a leading `'`.

## UNVERIFIED
Written 2026-10-29 with no browser. Every vendor header in `dictionary.mjs`, both template files (column names, source
URLs, status value maps) and the HubSpot and Google import rules are from memory and marked `"readOn": "UNVERIFIED"`.
No kvCORE or Follow Up Boss template is shipped. The lead checks each against the vendor's import page before a client sees it.
