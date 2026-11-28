// Case groups of test-ask-assistants.mjs (J28-3b). A group is a block of cases of that test; a pass runs only the groups it is given.
// A planted fault runs only the groups its expect patterns name: the group is DERIVED from the pattern ("/^case 17d:/" -> case 17 -> group "17"), never typed a second time.
// Group "G" is this file's own check (no browser): it reads the table below and the test's own case names.
export const GROUPS = ["1", "3", "4", "5", "6", "7", "9", "11", "12", "13", "14", "15", "17", "18", "19", "21", "20", "10", "G"];
// case number -> group (cases 1, 2 and 8 are one block: the first two-engine run)
export const CASE_GROUP = { 1: "1", 2: "1", 8: "1", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 9: "9", 11: "11", 12: "12", 13: "13", 14: "14", 15: "15", 17: "17", 18: "18", 19: "19", 21: "21", 20: "20", 10: "10" };
// a group that reads what other groups wrote: case 10 looks through every file the run wrote, so a pass of group 10 alone holds too few files
export const NEEDS = { "10": ["1"] };

export function closure(groups) {
  const out = new Set(groups);
  for (const g of groups) for (const n of NEEDS[g] || []) out.add(n);
  return GROUPS.filter((g) => out.has(g));
}
// "17,18" -> ["17", "18"]; an unknown name is an error (the caller turns it into a usage error)
export function parseGroups(text) {
  const names = String(text).split(",").map((x) => x.trim()).filter(Boolean);
  if (!names.length) throw new Error("no group named");
  for (const n of names) if (!GROUPS.includes(n)) throw new Error("unknown group " + JSON.stringify(n) + " (groups: " + GROUPS.join(" ") + ")");
  return closure(names);
}
// the groups a fault needs: one per expect pattern, plus what they need
export function groupsFor(expect) {
  if (!expect.length) throw new Error("a fault with no expect pattern has no group");
  const names = expect.map((re) => {
    const m = /case (G|\d+)/.exec(String(re));
    const g = m ? (m[1] === "G" ? "G" : CASE_GROUP[Number(m[1])]) : undefined;
    if (!g) throw new Error("the pattern " + String(re) + " names no known case");
    return g;
  });
  return closure(names);
}
