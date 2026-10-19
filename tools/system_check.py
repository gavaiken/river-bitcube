"""Validation for docs/system/system.json (used by tools/tests/test_system_json.py)."""

import json
import re
import subprocess
import urllib.parse
from pathlib import Path

ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")
STATUSES = {"working", "partial", "standby", "planned", "blocked", "broken", "stopped", "unknown"}
VERIFIED_RE = re.compile(r"^(confirmed|unverified|awaiting:[A-Z][a-z]+)$")
MEDIA = {"artnet", "ethernet", "xlr", "video", "lan", "tailscale", "https", "git", "starlink", "internal"}


def structure_errors(doc):
    """Every structural problem in a system map, as readable strings (empty = valid)."""
    errors = []
    seen = set()
    for section in ("places", "nodes", "links"):
        for item in doc.get(section, []):
            if item["id"] in seen:
                errors.append(f"duplicate id {item['id']!r} ({section})")
            seen.add(item["id"])
            if not ID_RE.match(item["id"]):
                errors.append(f"{item['id']!r} is not a lowercase-hyphen id ({section})")
    for section in ("nodes", "links"):
        for item in doc.get(section, []):
            if item.get("status") not in STATUSES:
                errors.append(f"{item['id']!r}: status {item.get('status')!r} is not one of {sorted(STATUSES)}")
            if not VERIFIED_RE.match(str(item.get("verified"))):
                errors.append(f"{item['id']!r}: verified {item.get('verified')!r} is not confirmed, unverified or awaiting:<Name>")
    for link in doc.get("links", []):
        if link.get("medium") not in MEDIA:
            errors.append(f"{link['id']!r}: medium {link.get('medium')!r} is not one of {sorted(MEDIA)}")
    scenarios = [s["id"] for s in doc.get("scenarios", [])]
    places = {p["id"]: p for p in doc.get("places", [])}
    nodes = {n["id"]: n for n in doc.get("nodes", [])}
    for node in nodes.values():
        where = node.get("place", {})
        for s in scenarios:
            if s not in where:
                errors.append(f"node {node['id']!r} has no place for scenario {s!r} (use null if it's absent)")
            elif where[s] is not None:
                if node.get("kind") != "rope" and node["id"] not in doc.get("layout", {}).get("scenarios", {}).get(s, {}).get("nodes", {}):
                    errors.append(f"{node['id']!r} has no position in the {s!r} diagram (layout.scenarios.{s}.nodes)")
                place = places.get(where[s])
                if place is None:
                    errors.append(f"node {node['id']!r} is in unknown place {where[s]!r}")
                elif s not in place.get("scenarios", []):
                    errors.append(f"node {node['id']!r} is in place {where[s]!r}, which is not in scenario {s!r}")
    for link in doc.get("links", []):
        for end, verb in (("from", "comes from"), ("to", "goes to")):
            if link[end] not in nodes:
                errors.append(f"link {link['id']!r} {verb} unknown node {link[end]!r}")
        for s in link.get("scenarios", []):
            if s not in scenarios:
                errors.append(f"link {link['id']!r} names unknown scenario {s!r}")
                continue
            for end in ("from", "to"):
                n = nodes.get(link[end])
                if n is not None and n.get("place", {}).get(s) is None:
                    errors.append(f"link {link['id']!r} is in scenario {s!r} but {link[end]!r} is not")
    errors += _rope_errors(nodes.values())
    errors += _reference_errors(doc, nodes)
    api = doc.get("api", {})
    for item in api.get("contract", []) + api.get("endpoints", []):
        if not VERIFIED_RE.match(str(item.get("state"))) or item.get("state") == "unverified":
            errors.append(f"api item {item.get('id')!r}: state {item.get('state')!r} is not confirmed or awaiting:<Name>")
    return errors


def _reference_errors(doc, nodes):
    """Ids that point elsewhere in the map (questions, sources, owners, parents) must exist."""
    errors = []
    questions = {q["id"] for q in doc.get("open_questions", [])}
    sources = {s["id"] for s in doc.get("sources", [])}
    people = {p["id"] for p in doc.get("people", [])} | {"team"}
    for item in doc.get("nodes", []) + doc.get("links", []) + doc.get("places", []) + doc.get("scenarios", []):
        for q in item.get("open_questions", []):
            if q not in questions:
                errors.append(f"{item['id']!r}: unknown open question {q!r}")
        for src in item.get("sources", []):
            if src not in sources:
                errors.append(f"{item['id']!r}: unknown source {src!r}")
    for node in nodes.values():
        if "owner" in node and node["owner"] not in people:
            errors.append(f"{node['id']!r}: unknown owner {node['owner']!r}")
        if "parent" in node:
            parent = nodes.get(node["parent"])
            for s, place in node.get("place", {}).items():
                if place is not None and (parent is None or parent.get("place", {}).get(s) is None):
                    errors.append(f"{node['id']}: parent {node['parent']!r} is missing or not placed in scenario {s!r}")
    return errors


def _rope_errors(nodes):
    """Will's mapping (RopeLights config.local.json): 10 ropes per box, 4 universes per rope, 3 used."""
    errors = []
    for node in nodes:
        m = re.fullmatch(r"rope-(\d\d)", node["id"])
        if node.get("kind") != "rope" or not m:
            continue
        n = int(m.group(1))
        box, out = (n - 1) // 10 + 1, (n - 1) % 10 + 1
        universes = [4 * (n - 1) + i for i in range(3)]
        spec = node.get("specs", {})
        if (spec.get("box"), spec.get("out"), spec.get("universes"), node.get("parent")) != (box, out, universes, f"psac10-{box}"):
            errors.append(f"{node['id']}: expected box {box} OUT{out} universes {universes} under psac10-{box}")
    return errors


# ---------------------------------------------------------------- secret scanning

def _is_placeholder(value):
    """True for stand-ins that are safe to publish: <NAME>, $NAME or ${NAME}, an environment-variable
    name with an underscore (INGEST_TOKEN), a mask (***, xxx), or a plain word like PASSWORD."""
    v = value.strip("\"'\\")  # quotes, and the backslash of an escaped quote in JSON
    return (not v or (v.startswith("<") and v.endswith(">"))
            or re.fullmatch(r"\$\{?[A-Z_][A-Z0-9_]*\}?", v) is not None
            or re.fullmatch(r"[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+", v) is not None
            or re.fullmatch(r"[*x.]+", v) is not None
            or v.lower() in {"password", "pass", "passwd", "secret", "token", "changeme"})


_KEY = r"(?i)(?<![\w-])\w*(?:password|passwd|secret|token|api[_-]?key|access[_-]?key)"
_PATTERNS = [
    ("url-credentials", re.compile(r"\b[a-z][a-z0-9+.-]*://[^/\s:@<>\"']+:([^@\s<>\"'/]+)@"), 1),
    ("bearer-value", re.compile(r"\bBearer\s+([^\s\"'<>)]{6,})"), 1),
    # KEY=value, "key": "value", or key: value where the value looks generated (letters and digits);
    # prose like "SITE_TOKEN: cookie river_token" is left alone.
    ("secret-assignment", re.compile(_KEY + r"[\"']?\s*=\s*[\"']?([^\s\"',;)}]{6,})"), 1),
    ("secret-assignment", re.compile(_KEY + r"[\"']?\s*:\s*[\"']([^\s\"',;)}]{6,})"), 1),
    ("secret-assignment", re.compile(_KEY + r"[\"']?\s*:\s*((?=[^\s]*\d)(?=[^\s]*[A-Za-z])[^\s\"',;)}]{8,})"), 1),
    ("private-key", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"), None),
    ("token-prefix", re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|tskey-[a-z]+-[A-Za-z0-9-]{10,}"
                                r"|a[ks]-[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|xox[abprs]-[A-Za-z0-9-]{10,})"), None),
]


def secret_pattern_hits(text):
    """(line, pattern name) for every secret-shaped string in text. Never returns the match itself."""
    hits = []
    for i, line in enumerate(text.splitlines(), 1):
        for name, rx, group in _PATTERNS:
            for m in rx.finditer(line):
                if group is None or not _is_placeholder(m.group(group)):
                    hits.append((f"line {i}", name))
    return hits


# ---------------------------------------------------------------- real secret values

class Redacted(str):
    """A secret that compares and searches like a string but never prints."""

    def __repr__(self):
        return "<redacted>"

    __str__ = __repr__

    def __format__(self, spec):
        return "<redacted>"

    def reveal(self):
        return str.__getitem__(self, slice(None))


def secret_values(obj):
    """Every secret string in a secrets.local.json-shaped object: whole strings, and the password inside any URL."""
    out = []

    def walk(o):
        if isinstance(o, dict):
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
        elif isinstance(o, str) and len(o) >= 6:
            out.append(o)
            # greedy up to the last @ before the host, so a password may contain / or @
            m = re.match(r"^[a-z][a-z0-9+.-]*://[^:/@\s]+:(.+)@[^@\s]+$", o)
            if m and not _is_placeholder(m.group(1)):
                out.append(m.group(1))
                out.append(urllib.parse.unquote(m.group(1)))
    walk(obj)
    return [Redacted(v) for v in dict.fromkeys(out) if len(v) >= 4]


class _Needles:
    """The byte forms of the secrets (UTF-8, UTF-16, percent-encoded), kept out of any printable local."""

    def __init__(self, values):
        self._b = [form for v in values for form in _byte_forms(v)]

    def __repr__(self):
        return "<redacted needles>"

    def found_in(self, data):
        return any(n in data for n in self._b)


def _byte_forms(v):
    plain = v.reveal() if isinstance(v, Redacted) else str(v)
    return [plain.encode("utf-8"), plain.encode("utf-16-le"), urllib.parse.quote(plain, safe="").encode("ascii")]


def files_containing(values, paths, root):
    """Relative names of the files that contain any of the values (as UTF-8, UTF-16 or percent-encoded).
    A file that can't be read is listed as "<name> (unreadable)", so it fails the check instead of being skipped."""
    needles = _Needles(values)
    found = []
    for p in paths:
        name = Path(p).relative_to(root).as_posix()
        try:
            hit = needles.found_in(Path(p).read_bytes())
        except OSError:
            found.append(name + " (unreadable)")
            continue
        if hit:
            found.append(name)
    return sorted(found)


BITCUBE_SECRETS = r"C:\Users\user\River\river-bitcube\secrets.local.json"


def real_secret_values(repo):
    """(values, where from) from secrets.local.json: the local file on bitcube, else over `ssh bitcube`.
    Returns ([], reason) when neither works. Nothing read is ever printed."""
    candidates = [Path(repo) / "secrets.local.json", main_checkout(repo) / "secrets.local.json"]
    local = next((c for c in candidates if c.exists()), None)
    try:
        if local is not None:
            text, source = local.read_text(encoding="utf-8-sig"), f"local {local.parent.name}/secrets.local.json"
        else:
            r = subprocess.run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "bitcube", "type " + BITCUBE_SECRETS],
                               capture_output=True, timeout=40)
            if r.returncode != 0:
                return [], f"ssh bitcube exited {r.returncode}"
            text, source = r.stdout.decode("utf-8-sig"), "ssh bitcube"
        values = secret_values(json.loads(text))
        del text
        return values, source
    except (OSError, subprocess.TimeoutExpired):
        return [], "could not read secrets.local.json"
    except ValueError:
        return [], "secrets.local.json is not valid JSON"


def repo_files(repo):
    """Every tracked file plus new files that aren't ignored (so unpushed work is checked too)."""
    out = subprocess.run(["git", "-C", str(repo), "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
                         capture_output=True, check=True).stdout.decode("utf-8")
    return sorted({Path(repo) / f for f in out.split("\0") if f and (Path(repo) / f).is_file()})


def main_checkout(repo):
    """The main working tree, even when repo is a git worktree of it."""
    common = subprocess.run(["git", "-C", str(repo), "rev-parse", "--path-format=absolute", "--git-common-dir"],
                            capture_output=True, text=True).stdout.strip()
    return Path(common).parent if common else Path(repo)


def sibling_repo(repo, name):
    """A checkout next to this one (River\\river-agent on bitcube, ~/claude/Source/river-agent on the mini)."""
    return main_checkout(repo).parent / name


def river_coordinates(agent_env):
    """WEATHER_LAT and WEATHER_LON from river-agent's agent.env: in full, truncated and rounded to two decimals,
    without sign or quotes, as Redacted."""
    vals = {}
    for line in agent_env.splitlines():
        line = line.strip()
        if line.startswith("export "):
            line = line[7:].strip()
        k, sep, v = line.partition("=")
        if sep and k.strip() in ("WEATHER_LAT", "WEATHER_LON"):
            vals[k.strip()] = v.strip().strip("\"'").lstrip("-")
    out = []
    for v in vals.values():
        whole, _, frac = v.partition(".")
        out += [v, f"{whole}.{frac[:2]}"]
        try:
            out.append(f"{float(v):.2f}")
        except ValueError:
            pass
    return [Redacted(x) for x in dict.fromkeys(out)]
