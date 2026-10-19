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
    api = doc.get("api", {})
    for item in api.get("contract", []) + api.get("endpoints", []):
        if not VERIFIED_RE.match(str(item.get("state"))) or item.get("state") == "unverified":
            errors.append(f"api item {item.get('id')!r}: state {item.get('state')!r} is not confirmed or awaiting:<Name>")
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
    v = value.strip("\"'")
    return (not v or v[0] in "<${*" or v.lower() in {"password", "pass", "passwd", "secret", "token", "xxx", "..."}
            or re.fullmatch(r"[A-Z][A-Z0-9_]*", v) is not None)  # an environment-variable name, not a value


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
            m = _PATTERNS[0][1].search(o)
            if m and not _is_placeholder(m.group(1)):
                out.append(m.group(1))
                out.append(urllib.parse.unquote(m.group(1)))
    walk(obj)
    return [Redacted(v) for v in dict.fromkeys(out) if len(v) >= 4]


def files_containing(values, paths, root):
    """Relative names of the files that contain any of the values (as UTF-8, UTF-16 or percent-encoded)."""
    needles = []
    for v in values:
        plain = v.reveal() if isinstance(v, Redacted) else v
        needles += [plain.encode("utf-8"), plain.encode("utf-16-le"), urllib.parse.quote(plain, safe="").encode("ascii")]
    found = []
    for p in paths:
        data = Path(p).read_bytes()
        if any(n in data for n in needles):
            found.append(Path(p).relative_to(root).as_posix())
    return sorted(found)


BITCUBE_SECRETS = r"C:\Users\user\River\river-bitcube\secrets.local.json"


def real_secret_values(repo):
    """(values, where from) from secrets.local.json: the local file on bitcube, else over `ssh bitcube`.
    Returns ([], reason) when neither works. Nothing read is ever printed."""
    local = Path(repo) / "secrets.local.json"
    try:
        if local.exists():
            text, source = local.read_text(encoding="utf-8-sig"), "local secrets.local.json"
        else:
            r = subprocess.run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "bitcube", "type " + BITCUBE_SECRETS],
                               capture_output=True, timeout=40)
            if r.returncode != 0:
                return [], f"ssh bitcube exited {r.returncode}"
            text, source = r.stdout.decode("utf-8-sig"), "ssh bitcube"
        return secret_values(json.loads(text)), source
    except (OSError, subprocess.TimeoutExpired):
        return [], "could not read secrets.local.json"
    except ValueError:
        return [], "secrets.local.json is not valid JSON"


def repo_files(repo):
    """Every tracked file plus new files that aren't ignored (so unpushed work is checked too)."""
    out = subprocess.run(["git", "-C", str(repo), "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
                         capture_output=True, check=True).stdout.decode("utf-8")
    return sorted({Path(repo) / f for f in out.split("\0") if f and (Path(repo) / f).is_file()})


def sibling_repo(repo, name):
    """A checkout next to this one (River\\river-agent on bitcube, ~/claude/Source/river-agent on the mini),
    found from the main checkout even when this runs in a git worktree."""
    common = subprocess.run(["git", "-C", str(repo), "rev-parse", "--path-format=absolute", "--git-common-dir"],
                            capture_output=True, text=True).stdout.strip()
    main = Path(common).parent if common else Path(repo)
    return main.parent / name


def river_coordinates(agent_env):
    """WEATHER_LAT and WEATHER_LON from river-agent's agent.env, full and to two decimals, as Redacted."""
    vals = dict(line.split("=", 1) for line in agent_env.splitlines() if line.startswith(("WEATHER_LAT=", "WEATHER_LON=")))
    out = []
    for key in ("WEATHER_LAT", "WEATHER_LON"):
        v = vals.get(key, "").strip().lstrip("-")
        if v:
            whole, _, frac = v.partition(".")
            out += [Redacted(v), Redacted(f"{whole}.{frac[:2]}")]
    return out
