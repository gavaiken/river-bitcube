// Logins never reach a browser or the history file. A camera's RTSP address carries its login (rtsp://admin:<password>@…,
// from bitcube's secrets.local.json), and ffmpeg prints the whole address when an input fails, so a calibration log line,
// a probe error or a stage failure can hold it. The camera's own HTTP API (CLAUDE.md: Login → token) takes the login in a JSON
// body ({"password":"…"}) or a query (?user=admin&password=…), so a step's command or a reply can hold it that way too (R7 #37).
// scrubCreds() replaces the user:password part of every URL, and the value of every password-like field (password, passwd,
// pwd, token, secret: as a JSON or escaped-JSON key, a query or form parameter, or "key: value"), in a string or in every
// string inside an object or array (a copy; the input is left alone), with ***.
// Everything up to the LAST @ of the authority (before the path, query or fragment): ffmpeg takes the last @ too, so a raw @
// or ' in the password is all login. Whitespace, " and <> end a URL in a log line or JSON text.
// tools/mission/probe.ps1 Mask-Creds does the same on bitcube.
const CREDS = /([a-z][a-z0-9+.-]*:\/\/)[^\s/?#"<>]*@/gi;
// The key (never part of a longer word: input_tokens, passwords), its own quote (plain or escaped), then : or =.
const KEY = String.raw`((?<![\w-])(?:password|passwd|pwd|token|secret)(?![\w-])(?:\\?["'])?\s*[:=]\s*)`;
/** A quoted value, to its own closing quote (plain or escaped: a body inside a quoted command), whatever it holds. */
const QUOTED = new RegExp(String.raw`${KEY}(\\?(["']))((?:(?!\\?\3).)*)(\\?\3)`, 'gi');
/** A bare value (a query, a form, "key: value"), to the next space, quote, &, comma, ; or closing bracket. */
const BARE = new RegExp(String.raw`${KEY}(?!\\?["'])([^\s"'&,;}\]]+)`, 'gi');

/** "rtsp://admin:pw@10.0.0.1/x" -> "rtsp://***@10.0.0.1/x", '"password":"x"' -> '"password":"***"', "?password=x" ->
 *  "?password=***"; deep for objects and arrays; anything else unchanged. */
export function scrubCreds(x, depth = 0) {
  if (typeof x === 'string') return x.replace(CREDS, '$1***@').replace(QUOTED, '$1$2***$5').replace(BARE, '$1***');
  if (depth > 20 || x == null || typeof x !== 'object') return x;
  if (Array.isArray(x)) return x.map((v) => scrubCreds(v, depth + 1));
  if (Buffer.isBuffer(x) || ArrayBuffer.isView(x)) return x;
  const out = {};
  for (const [k, v] of Object.entries(x)) out[k] = scrubCreds(v, depth + 1);
  return out;
}
