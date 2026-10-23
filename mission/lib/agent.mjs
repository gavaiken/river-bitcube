// The studio agent: a Claude Code session driven through the Claude Agent SDK (docs/mission-plan.md).
// Runs as the macOS user `river` (MD6), so the operating system keeps it out of Gavin's files; the rules
// below are a second fence, and mission/STUDIO.md tells it who it serves and what it may do (MD8).
import { query } from '@anthropic-ai/claude-agent-sdk';

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

export function describeTool(block) {
  const i = block.input ?? {};
  const clip = (s, n = 90) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  switch (block.name) {
    case 'Bash': return `ran: ${clip(i.description || i.command)}`;
    case 'Read': return `read ${clip(i.file_path, 70)}`;
    case 'Edit': case 'Write': return `edited ${clip(i.file_path, 70)}`;
    case 'Glob': case 'Grep': return `searched for ${clip(i.pattern, 60)}`;
    case 'WebFetch': return `fetched ${clip(i.url, 70)}`;
    case 'WebSearch': return `searched the web: ${clip(i.query, 60)}`;
    case 'TodoWrite': return 'updated its to-do list';
    case 'Agent': return `asked a helper: ${clip(i.description, 60)}`;
    default: return `used ${block.name}`;
  }
}

/** Build the runner the Studio drives. */
export function agentRunner({ cwd, appendPrompt, token, model, executable }) {
  return async function* run({ text, resume, signal }) {
    const ac = new AbortController();
    if (signal.aborted) return;
    signal.addEventListener('abort', () => ac.abort(), { once: true });
    const env = { ...process.env };
    if (token) env.CLAUDE_CODE_OAUTH_TOKEN = token;
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
          else if (b.type === 'tool_use') yield { kind: 'activity', text: describeTool(b) };
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
