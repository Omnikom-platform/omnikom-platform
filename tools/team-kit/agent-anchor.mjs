// Keeps each agent session on its charter. Hooks: SessionStart (startup/resume/clear/compact) and
// UserPromptSubmit (.claude/settings.json).
//   Role session, first time its role is known, or any SessionStart → full anchor: charter, shared
//   rules, write scope, its protocols' status, its gaps. Every later prompt → one reminder line.
//   Lead session (no marker) → one line when the gap log has OPEN rows; otherwise nothing.
// Never blocks: always exit 0. Test: node tools/test-agent-hooks.mjs
import {
  projectRoot, readStdinJson, loadRoles, detectRole, gapRows, phaseRows, leadSessionId, readText,
} from './agent-role.mjs';

function emit(event, text) {
  if (!text) return;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } }));
}

function fullAnchor(root, cfg, key, why) {
  const r = cfg.roles[key];
  const mine = gapRows(root).filter(g => g.id.startsWith(`G-${r.letter}-`));
  const open = mine.filter(g => g.status === 'OPEN' || g.status === '');
  const answered = mine.filter(g => ['RESOLVED', 'DIRECTED', 'REJECTED'].includes(g.status)).slice(-5);
  const lead = leadSessionId(root);
  return [
    `## ANCHOR: you are the ${r.name} (${r.model}) on the ELEV8 / Alex Sevilla audit. Re-injected at ${why}.`,
    `This block outranks your memory of the conversation. If your plan disagrees with it, the block wins.`,
    ``,
    `**You may write ONLY:** ${r.writes.map(w => '`' + w + '`').join(', ')}${r.appendOnly?.length ? ` (append-only: ${r.appendOnly.map(w => '`' + w + '`').join(', ')})` : ''}.`,
    `Anything else is blocked by \`tools/write-guard.mjs\`. If you need a change outside your scope, that is a GAP: append a row to \`icm/work/gaps/LOG.md\` (ID \`G-${r.letter}-<n>\`, format \`icm/templates/gap.md\`) and send the Lead one line${lead ? ` (SendMessage to \`${lead}\`)` : ''}: \`GAP G-${r.letter}-<n> | <file:line> | <gap> | RECOMMEND: <one line>\`. Keep working on what does not depend on it.`,
    ``,
    `**Your protocols and their status:**`,
    ...(phaseRows(root, r.phaseOwnerLabel).length ? phaseRows(root, r.phaseOwnerLabel) : ['(none listed under your name in the phase maps)']),
    ``,
    `**Your OPEN gaps:** ${open.length ? '' : 'none'}`,
    ...open.map(g => g.raw),
    `**Answered by the Lead (re-read the changed file, then resume):** ${answered.length ? '' : 'none'}`,
    ...answered.map(g => g.raw),
    ``,
    `### Your charter (\`${r.charter}\`)`,
    readText(root, r.charter),
    ``,
    `### Rules for every agent (\`icm/agents/_common.md\`)`,
    readText(root, 'icm/agents/_common.md'),
  ].join('\n');
}

function reminder(cfg, key) {
  const r = cfg.roles[key];
  return `ROLE ${r.name}: write only ${r.writes.join(', ')}. Outside that = file a gap (G-${r.letter}-n), never work around it. Charter: ${r.charter}.`;
}

try {
  const input = readStdinJson();
  const root = projectRoot();
  const event = input.hook_event_name || (input.prompt !== undefined ? 'UserPromptSubmit' : 'SessionStart');
  const cfg = loadRoles(root);
  const { role, fresh } = detectRole(input, root, { prompt: event === 'UserPromptSubmit' ? input.prompt : undefined });

  if (role && role !== 'lead') {
    if (!cfg.roles[role]) {
      emit(event, `ICM-ROLE "${role}" is not in icm/agents/roles.json. Every write is blocked until the Lead adds it. Tell the Lead.`);
    } else if (event === 'SessionStart') {
      emit(event, fullAnchor(root, cfg, role, `session ${input.source || 'start'}`));
    } else {
      emit(event, fresh ? fullAnchor(root, cfg, role, 'your first message') : reminder(cfg, role));
    }
  } else if (role === 'lead') {
    const open = gapRows(root).filter(g => g.status === 'OPEN' || g.status === '');
    if (open.length) emit(event, `Gap log: ${open.length} OPEN (${open.map(g => g.id).join(', ')}). Verify each and resolve, direct or reject it (icm/agents/lead.md).`);
  }
} catch (e) {
  process.stderr.write(`agent-anchor: ${e.message}\n`);
}
process.exit(0);
