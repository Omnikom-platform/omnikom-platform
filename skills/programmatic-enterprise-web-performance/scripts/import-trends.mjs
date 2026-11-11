// Google Trends interest by region, captured by the MAIN SESSION in the owner's browser: per service, the country's region table (the client's state and its
// rank among the states) and the state's metro table (the client's metro). NO script fetches Trends: this reads the saved files and writes ONE normalized JSON.
// Trends numbers are a relative index (100 = the region with the most interest for that search in the period), NOT search counts.
// Usage: node import-trends.mjs <url> [--dir DIR (default <pewp>/captures/trends)] [--max-age-days 30] [--cwd DIR]
// One file per service: { "service":"hard money loans", "capturedAt":"ISO", "browser":"owner's Edge", "period":"past 12 months", "geo":"US",
//   "address":"https://trends.google.com/trends/explore?...", "regions":[{"name":"California","value":87}, ...],
//   "metros":[{"name":"Sacramento CA","value":100}, ...], "client":{"state":"California","metro":"Sacramento CA"} }
//   regions and metros are the rows of the tables as shown (value 0 to 100; "<1" is written 0); metros may be left out when the state has no metro table.
//   client.state must be one of the regions, and client.metro (when given) one of the metros.
// A file without a service, a period, a Trends address, a regions table, or a client state that is in it, is REJECTED with the reason.
// Output: research/trends.json { rows:[{service, period, geo, address, stateRank, stateValue, statesCount, top3States, metroRank, metroValue, metrosCount, file,
//   capturedAt, ageDays, stale}], summary:{ scale, services, bestRank:{service, stateRank}, worstRank:{...} } }. Rank 1 = most interest; equal values share a rank.
import { cli, isHttp, nonEmpty, toNum } from "./lib-captures.mjs";

const rankOf = (table, name) => {
  const hit = table.find((r) => r.name.toLowerCase() === String(name).toLowerCase());
  return hit ? { value: hit.value, rank: 1 + table.filter((r) => r.value > hit.value).length } : null;
};
const table = (t) => (Array.isArray(t) ? t.map((r) => ({ name: String(r?.name ?? "").trim(), value: toNum(r?.value) })) : null);

const def = {
  module: "trends", dir: "trends", out: "trends", script: "import-trends.mjs",
  how: "the main session captures Google Trends in the owner's browser (past 12 months, one service per page, 45 s apart): the country's region table and the state's metro table, saved as <pewp>/captures/trends/<service>.json in the format at the top of scripts/import-trends.mjs",
  check(j) {
    const e = [];
    if (!nonEmpty(j.service)) e.push("no service");
    if (!nonEmpty(j.period)) e.push("no period (\"past 12 months\")");
    if (!isHttp(j.address)) e.push("no Trends address (the page's address that was read)");
    const regions = table(j.regions);
    if (!regions || !regions.length) e.push("no regions table");
    else if (regions.some((r) => !r.name || r.value == null || r.value < 0 || r.value > 100)) e.push("regions: every row needs a name and a value from 0 to 100");
    const metros = j.metros == null ? null : table(j.metros);
    if (j.metros != null && (!metros || metros.some((r) => !r.name || r.value == null || r.value < 0 || r.value > 100))) e.push("metros: every row needs a name and a value from 0 to 100");
    const st = nonEmpty(j.client?.state) ? rankOf(regions || [], j.client.state) : null;
    if (!nonEmpty(j.client?.state)) e.push("no client.state");
    else if (regions && regions.length && !st) e.push(`client.state "${j.client.state}" is not one of the regions`);
    let mt = null;
    if (nonEmpty(j.client?.metro)) { mt = metros ? rankOf(metros, j.client.metro) : null; if (!mt) e.push(`client.metro "${j.client.metro}" is not one of the metros`); }
    if (e.length) return { errors: e };
    const top3 = [...regions].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name)).slice(0, 3).map((r) => `${r.name} ${r.value}`);
    return { errors: [], row: { service: j.service.trim().toLowerCase(), period: j.period, geo: j.geo || null, address: j.address, stateRank: st.rank, stateValue: st.value, statesCount: regions.length, top3States: top3, metroRank: mt?.rank ?? null, metroValue: mt?.value ?? null, metrosCount: metros?.length ?? null } };
  },
  summarize(rows) {
    const by = [...rows].sort((a, b) => a.stateRank - b.stateRank || a.service.localeCompare(b.service));
    return { scale: "0-100 relative interest within the table (100 = the region with the most interest), not a search count", services: new Set(rows.map((r) => r.service)).size, bestRank: by[0] ? { service: by[0].service, stateRank: by[0].stateRank } : null, worstRank: by.at(-1) ? { service: by.at(-1).service, stateRank: by.at(-1).stateRank } : null };
  },
};

await cli(import.meta.url, def);
