// The studio agent: a Claude Code session driven through the Claude Agent SDK (docs/mission-plan.md).
// Runs as the macOS user `river` (MD6), so the operating system keeps it out of Gavin's files; the rules
// below are a second fence, and mission/STUDIO.md tells it who it serves and what it may do (MD8).
import { query } from '@anthropic-ai/claude-agent-sdk';
import { execFile } from 'node:child_process';
import { describeTool } from './steps.mjs';

/** Bring the agent's clone to the latest main before every request (as the bitcube Claude is told to). */
export function syncRepo(cwd) {
  return new Promise((resolve) => {
    execFile('git', ['-C', cwd, 'pull', '--rebase', '--autostash', '-q'], { timeout: 60_000 }, (err, _o, stderr) => {
      execFile('git', ['-C', cwd, 'log', '-1', '--format=%h %s'], (_e, out) => resolve({ ok: !err, head: String(out).trim(), error: err ? String(stderr || err.message).trim().slice(0, 200) : null }));
    });
  });
}

// Tools it may use without asking (nobody is at a terminal to answer a prompt).
export const ALLOWED = ['Bash', 'Read', 'Edit', 'Write', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'TodoWrite', 'Agent'];
// Never, whatever anyone types in the chat (MD8). The OS user boundary is the real wall; these are a fence.
export const DENIED = [
  'Bash(sudo:*)', 'Bash(su:*)', 'Bash(doas:*)',
  'Bash(tailscale:*)', 'Bash(/Applications/Tailscale.app/Contents/MacOS/Tailscale:*)',
  'Bash(networksetup:*)', 'Bash(pfctl:*)', 'Bash(socketfilterfw:*)', 'Bash(scutil:*)',
  'Bash(dscl:*)', 'Bash(sysadminctl:*)', 'Bash(dseditgroup:*)', 'Bash(security:*)',
  'Bash(shutdown:*)', 'Bash(reboot:*)', 'Bash(halt:*)', 'Bash(pmset:*)',
  'Bash(signal-cli:*)',
  'Read(/Users/gav/**)', 'Edit(/Users/gav/**)', 'Write(/Users/gav/**)',
];

// One step line per tool used, in the team's words, with the raw line kept apart for a tooltip (lib/steps.mjs).
export { describeTool };

/** The agent's environment: the server's own, its Claude token, and the path of mission control's local control socket
 *  (MISSION_CONTROL_SOCKET): mission/bin/mc.mjs makes a change through mission control with it (STUDIO.md says when). */
export function agentEnv(base, { token = null, controlSocket = null } = {}) {
  const env = { ...base };
  if (token) env.CLAUDE_CODE_OAUTH_TOKEN = token;
  if (controlSocket) env.MISSION_CONTROL_SOCKET = controlSocket;
  return env;
}

/** Build the runner the Studio drives. */
export function agentRunner({ cwd, appendPrompt, token, model, executable, onSynced, controlSocket = null }) {
  return async function* run({ text, resume, signal }) {
    const ac = new AbortController();
    if (signal.aborted) return;
    const sync = await syncRepo(cwd);
    yield sync.ok ? { kind: 'activity', text: 'brought its copy of the repo up to date', raw: `synced: ${sync.head.slice(0, 200)}`, acting: false }
                  : { kind: 'activity', text: "couldn't bring its copy of the repo up to date; working from an older copy", raw: `${sync.error ?? ''}; at ${sync.head.slice(0, 120)}`, acting: false };
    if (onSynced) onSynced(sync);
    signal.addEventListener('abort', () => ac.abort(), { once: true });
    const env = agentEnv(process.env, { token, controlSocket });
    const q = query({
      prompt: text,
      options: {
        cwd,
        resume,
        abortController: ac,
        permissionMode: 'dontAsk',
        allowedTools: ALLOWED,
        disallowedTools: DENIED,
        mcpServers: {},
        strictMcpConfig: true,
        settingSources: ['user', 'project'],
        systemPrompt: { type: 'preset', preset: 'claude_code', append: appendPrompt },
        env,
        ...(model ? { model } : {}),
        ...(executable ? { pathToClaudeCodeExecutable: executable } : {}),
      },
    });
    for await (const m of q) {
      if (m.type === 'system' && m.subtype === 'init') {
        yield { kind: 'session', sessionId: m.session_id };
      } else if (m.type === 'assistant') {
        for (const b of m.message?.content ?? []) {
          if (b.type === 'text' && b.text.trim()) yield { kind: 'text', text: b.text };
          else if (b.type === 'tool_use') yield { kind: 'activity', ...describeTool(b) };
        }
      } else if (m.type === 'result') {
        if (m.session_id) yield { kind: 'session', sessionId: m.session_id };
        yield { kind: 'result', ok: m.subtype === 'success' && !m.is_error,
                text: m.subtype === 'success' ? '' : (m.errors?.join('; ') || m.subtype),
                cost: m.total_cost_usd, turns: m.num_turns };
      }
    }
  };
}
