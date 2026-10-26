// Logins never reach a browser or the history file. A camera's RTSP address carries its login (rtsp://admin:<password>@…,
// from bitcube's secrets.local.json), and ffmpeg prints the whole address when an input fails, so a calibration log line,
// a probe error or a stage failure can hold it. The camera's own HTTP API (CLAUDE.md: Login → token) takes the login in a JSON
// body ({"password":"…"}) or a query (?user=admin&password=…), and answers its token in one ({"Token":{"name":"…"}}), so a
// step's command or a reply can hold it that way too (R7 #37, CR7 #1).
// scrubCreds() replaces the user:password part of every URL, and the value of every password-like field (password, passwd,
// pwd, passphrase, token, secret, api_key, with a prefix too: cam_password, access_token, X-Auth-Token, *_TOKEN=, and glued to it
// with no separator: PGPASSWORD=, accessToken, DBPASSWORD: (CR8 #5); as a JSON or escaped-JSON key, a query or form parameter, or
// "key: value"), and a command line's login forms (an Authorization header, Bearer, an HTTP client's -u user:pw or -uuser:pw,
// --password pw, sshpass -p pw: R8 #38, CR8 #5, #6), with ***:
//   - a quoted value to its own closing quote, past an escaped quote inside it ("ab\"cd"), whatever it holds (CR7 #3);
//   - an object or an array whole ({"Token":{"name":"…"}} -> {"Token":"***"}), nested up to NEST_DEPTH levels (one that never
//     closes, or nests deeper, to the end of its line);
//   - a bare value in JSON text (a quoted key, then :) as "***" in the key's own quotes, so JSON stays JSON ("token": 123 ->
//     "token": "***"); elsewhere (a query, a form) as ***. null, true and false stay: they hold nothing (CR7 #1).
// In a string, or in every string inside an object or array (a copy; the input is left alone); in an object, every value under
// an exact password-like key (not input_tokens or passwords) is "***" whatever it is (null and booleans stay) (CR7 #2).
// Everything up to the LAST @ of the authority (before the path, query or fragment): ffmpeg takes the last @ too, so a raw @
// or ' in the password is all login. Whitespace, " and <> end a URL in a log line or JSON text.
// tools/mission/probe.ps1 Mask-Creds does the same on bitcube, with these very patterns (test/review-cr7.test.mjs compares them).
const CREDS = String.raw`([a-z][a-z0-9+.-]*:\/\/)[^\s/?#"<>]*@`;
/** A password-like key: password, passwd, pwd, passphrase, token, secret, api_key (apikey, api-key), also with a prefix
 *  (cam_password, CLAUDE_CODE_OAUTH_TOKEN, X-Auth-Token, access_token: R8 #38), glued too (PGPASSWORD, MYSQLPWD, accessToken:
 *  CR8 #5); a whole word that ends with one, never one that goes on (input_tokens, max_tokens, tokens_used, passwords, secret_ref).
 *  And pass alone or after a separator (pass=, db_pass, "pass":), and SSHPASS: never bypass, compass or a passage (R9 #37). */
const NAMES = String.raw`(?<![\w-])(?:[\w-]*?(?:password|passwd|pwd|passphrase|token|secret|api[_-]?key)|(?:[\w-]*[_-])?pass|sshpass)(?![\w-])`;
/** The key (never part of a longer word: input_tokens, passwords), its own quote (plain or escaped), then : or =. */
const KEY = String.raw`(${NAMES}(?:\\?["'])?\s*[:=]\s*)`;
/** The key in JSON text: quoted (plain or escaped: group 2, the quote the masked value gets), then :. */
const KEY_JSON = String.raw`(${NAMES}(\\?["'])\s*:\s*)`;
/** A plain-quoted value: any escaped character, or anything but its own quote, to that quote (or the end: a line cut short,
 *  even inside an escape). */
const QUOTED = String.raw`${KEY}(["'])((?:\\(?:[\s\S]|$)|(?!\2)[^\\])*)(\2|$)`;
/** A value quoted with an escaped quote (a JSON body inside a quoted command or a JSON string), to its own escaped quote. Inside
 *  it the inner JSON's escapes are doubled: \\\\ is an escaped backslash, \\\" an escaped quote, \\ before a letter an escape
 *  (\\n), \ before a letter the outer string's own; each alternative starts differently, so a hostile line is read once. */
const ESCAPED = String.raw`${KEY}(\\(["']))((?:\\\\\\\\|\\\\\\\3|\\(?:\\\\)?(?!\\|\3)[\s\S]|\\\\(?!\\|\3)|(?!\3)[^\\]|\\+$)*)(\\\3|$)`;
/** One element inside an object or array: an escape, a double-quoted string (escape-aware), or a plain character. */
const ELEM = String.raw`\\[\s\S]|"(?:\\[\s\S]|[^"\\])*"|[^{}\[\]"\\]`;
export const NEST_DEPTH = 4;
/** An object or array, balanced to NEST_DEPTH levels; else (cut off, deeper) to the end of its line. */
const NESTED = (() => {
  let n = String.raw`[{\[](?:${ELEM})*[}\]]`;
  for (let i = 1; i < NEST_DEPTH; i++) n = String.raw`[{\[](?:${ELEM}|${n})*[}\]]`;
  return String.raw`${n}|[{\[][^\r\n]*`;
})();
/** A value that isn't quoted: an object or an array, or a word to the next space, quote, &, comma, ; or closing bracket;
 *  never null, true or false. */
const BARE_VALUE = String.raw`(?!\\?["'])(?!(?:null|true|false)(?![^\s"'&,;}\]]))(${NESTED}|[^\s"'&,;}\]]+)`;
/** The common login forms of a command line (R8 #38): an Authorization header's credential (Bearer, Basic, Token, Digest), a
 *  bearer token on its own, an HTTP client's -u/--user user:password (curl, wget, HTTPie, xh, earlier in the same command; the
 *  password; -uuser:pw attached too: CR8 #5), never another tool's -u (docker run -u 1000:1000, sort -u a:b: CR8 #6), a
 *  --password-like flag's value after a space, and sshpass -p's. Each keeps what names it and masks the value. */
const AUTH = String.raw`(\bAuthorization\s*[:=]\s*["']?(?:(?:Bearer|Basic|Token|Digest)\s+)?)([^\s"',;]+)`;
const BEARER = String.raw`(\bBearer\s+)([A-Za-z0-9._~+/=-]{12,})`;
const USER = String.raw`((?:^|[\s"'\\/])(?:curl|wget|https?|xh)(?:\.exe)?\s(?:[^\n;&|]*?[\s"'])?(?:-u|--user)(?:[\s=]+|(?=[^\s=-]))[^\s:"'*]+:)([^\s"']+)`;
const FLAG = String.raw`((?:^|\s)--?(?:[\w-]*[_-])?(?:password|passwd|pwd|passphrase|pass|token|secret|api[_-]?key)\s+)(?![-*])([^\s"']+)`;
const SSHPASS = String.raw`(\bsshpass\s+-p\s*)([^\s"']+)`;
/** R9 #37: mysql's password attached to -p (with a space it is a database name, and it asks; -P is its port, so -p is matched by
 *  its case, CR9 #14); the Wi-Fi key the router keeps
 *  (uci set ….key=, "option key" in its config); "key" as a JSON key (the router's answers carry the Wi-Fi key that way); a bare
 *  Anthropic token (sk-ant-…), wherever it stands. */
const MYSQL = String.raw`(\b(?:mysql|mysqldump|mysqladmin|mariadb)(?:\.exe)?\s(?:[^\n;&|]*?\s)?(?-i:-p))([^\s"'-][^\s"']*)`;
const UCI = String.raw`(\buci\s+(?:-\w+\s+)*(?:set|add_list)\s+[^\s=]*\.key=["']?|\boption\s+key\s+["']?)([^\s"']+)`;
const KEYJSON = String.raw`((?<![\w-])["']key["']\s*:\s*["'])([^"']*)`;
const SKANT = String.raw`(\bsk-ant-)([A-Za-z0-9_-]{8,})`;
/** The patterns, as probe.ps1 writes them too (the tests compare the two). */
export const PATTERNS = { CREDS, KEY, KEY_JSON, QUOTED, ESCAPED, ELEM, NESTED, BARE_JSON: KEY_JSON + BARE_VALUE, BARE: KEY + BARE_VALUE, AUTH, BEARER, USER, FLAG, SSHPASS, MYSQL, UCI, KEYJSON, SKANT };
const RE = Object.fromEntries(['CREDS', 'QUOTED', 'ESCAPED', 'BARE_JSON', 'BARE', 'AUTH', 'BEARER', 'USER', 'FLAG', 'SSHPASS', 'MYSQL', 'UCI', 'KEYJSON', 'SKANT'].map((k) => [k, new RegExp(PATTERNS[k], 'gi')]));
/** An object's key whose value is a login, whatever it holds (a password-like key, a prefix allowed, glued too: never
 *  input_tokens, passwords, secret_ref). */
const SECRET_KEY = /^(?:[\w-]*?(?:password|passwd|pwd|passphrase|token|secret|api[_-]?key)|(?:[\w-]*[_-])?pass|sshpass|key)$/i;

/** "rtsp://admin:pw@10.0.0.1/x" -> "rtsp://***@10.0.0.1/x", '"password":"x"' -> '"password":"***"', "?password=x" ->
 *  "?password=***", '"Token":{"name":"x"}' -> '"Token":"***"'; deep for objects and arrays; anything else unchanged. */
export function scrubCreds(x, depth = 0) {
  if (typeof x === 'string') {
    return x.replace(RE.CREDS, '$1***@').replace(RE.QUOTED, '$1$2***$4').replace(RE.ESCAPED, '$1$2***$5')
      .replace(RE.BARE_JSON, '$1$2***$2').replace(RE.BARE, '$1***')
      .replace(RE.AUTH, '$1***').replace(RE.BEARER, '$1***').replace(RE.USER, '$1***').replace(RE.FLAG, '$1***').replace(RE.SSHPASS, '$1***')
      .replace(RE.MYSQL, '$1***').replace(RE.UCI, '$1***').replace(RE.KEYJSON, '$1***').replace(RE.SKANT, '$1***');
  }
  if (depth > 20 || x == null || typeof x !== 'object') return x;
  if (Array.isArray(x)) return x.map((v) => scrubCreds(v, depth + 1));
  if (Buffer.isBuffer(x) || ArrayBuffer.isView(x)) return x;
  const out = {};
  for (const [k, v] of Object.entries(x)) out[k] = SECRET_KEY.test(k) && v != null && typeof v !== 'boolean' ? '***' : scrubCreds(v, depth + 1);
  return out;
}
