// Logins never reach a browser or the history file. A camera's RTSP address carries its login (rtsp://admin:<password>@…,
// from bitcube's secrets.local.json), and ffmpeg prints the whole address when an input fails, so a calibration log line,
// a probe error or a stage failure can hold it. scrubCreds() replaces the user:password part of every URL in a string,
// or in every string inside an object or array (a copy; the input is left alone), with ***.
// Everything up to the LAST @ of the authority (before the path, query or fragment): ffmpeg takes the last @ too, so a raw @
// or ' in the password is all login. Whitespace, " and <> end a URL in a log line or JSON text.
const CREDS = /([a-z][a-z0-9+.-]*:\/\/)[^\s/?#"<>]*@/gi;

/** "rtsp://admin:pw@10.0.0.1/x" -> "rtsp://***@10.0.0.1/x"; deep for objects and arrays; anything else unchanged. */
export function scrubCreds(x, depth = 0) {
  if (typeof x === 'string') return x.replace(CREDS, '$1***@');
  if (depth > 20 || x == null || typeof x !== 'object') return x;
  if (Array.isArray(x)) return x.map((v) => scrubCreds(v, depth + 1));
  if (Buffer.isBuffer(x) || ArrayBuffer.isView(x)) return x;
  const out = {};
  for (const [k, v] of Object.entries(x)) out[k] = scrubCreds(v, depth + 1);
  return out;
}
