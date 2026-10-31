// DECISIONS 44: nothing on the dashboard is made up. A fixed piece of copy that lives in code (not in a JSX element that carries
// data-plan) is wrapped in t(): the first argument is the Id of the row of docs/blueprint/16-DESIGN-PARTS.md it comes from, the second
// is the words. tests/plan-gate reads the plan and fails when the id is not in it or the words are not in that row.
export const t = (_planId: string, text: string): string => text;
