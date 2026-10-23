#!/usr/bin/env python3
"""Generate docs/system/system.md (the text version of the system map) from docs/system/system.json.

    python3 tools/system_docs.py           # write docs/system/system.md
    python3 tools/system_docs.py --check   # exit 1 if system.md is out of date

system.json is the source of truth; never edit system.md by hand. tools/tests/test_system_json.py
checks that the two agree.
"""
import argparse
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SYSTEM_JSON = REPO / "docs" / "system" / "system.json"
SYSTEM_MD = REPO / "docs" / "system" / "system.md"
PAGE = "https://gavaiken.github.io/river-bitcube/system/"


def cell(v):
    """One Markdown table cell."""
    return fmt(v).replace("|", "\\|").replace("\n", " ")


def fmt(v):
    """Any JSON value as one line of text."""
    if v is None:
        return "none"
    if isinstance(v, bool):
        return "yes" if v else "no"
    if isinstance(v, list):
        return "; ".join(fmt(x) for x in v)
    if isinstance(v, dict):
        return "; ".join(f"{k.replace('_', ' ')}: {fmt(x)}" for k, x in v.items())
    return str(v)


def table(headers, rows):
    out = ["| " + " | ".join(headers) + " |", "|" + "---|" * len(headers)]
    out += ["| " + " | ".join(cell(c) for c in r) + " |" for r in rows]
    return out


def mermaid_id(i):
    return i.replace("-", "_")


def mermaid_label(s):
    return str(s).replace('"', "'").replace("|", "/")


class Map:
    def __init__(self, doc):
        self.doc = doc
        self.nodes = {n["id"]: n for n in doc["nodes"]}
        self.places = {p["id"]: p for p in doc["places"]}
        self.people = {p["id"]: p for p in doc["people"]}
        self.questions = {q["id"]: q for q in doc["open_questions"]}
        self.sources = {s["id"]: s for s in doc["sources"]}

    def person(self, pid):
        return self.people[pid]["name"] if pid in self.people else ("the team" if pid == "team" else str(pid))

    def placed(self, n, scenario):
        return n["place"].get(scenario) is not None

    def link_visible(self, link, scenario):
        return (scenario in link["scenarios"] and self.placed(self.nodes[link["from"]], scenario)
                and self.placed(self.nodes[link["to"]], scenario))

    def where(self, n):
        """The node's place: just the name when the map has one scenario, else one entry per scenario."""
        names = [self.places[n["place"][s["id"]]]["name"] if n["place"].get(s["id"]) else "absent" for s in self.doc["scenarios"]]
        if len(names) == 1:
            return names[0]
        return " · ".join(f"{s['id']}: {name}" for s, name in zip(self.doc["scenarios"], names))


def mermaid(m, scenario):
    """One flowchart per scenario: places as subgraphs; ropes folded into one box per PSAC10, drawn in the ropes' own place."""
    out = ["```mermaid", "flowchart LR"]
    rope_box = {n["id"]: f"ropes_{mermaid_id(n['parent'])}" for n in m.doc["nodes"] if n["kind"] == "rope"}
    for p in m.doc["places"]:
        if scenario not in p["scenarios"]:
            continue
        here = [n for n in m.doc["nodes"] if n["place"].get(scenario) == p["id"]]
        members = [n for n in here if n["kind"] != "rope"]
        rope_groups = {}
        for n in here:
            if n["kind"] == "rope":
                rope_groups.setdefault(rope_box[n["id"]], []).append(n["id"])
        if not members and not rope_groups:
            continue
        out.append(f'  subgraph p_{mermaid_id(p["id"])}["{mermaid_label(p["name"])}"]')
        for n in members:
            sub = next((i["ip"].split("/")[0] for i in n.get("interfaces", []) if i.get("ip") and i.get("scenario", scenario) == scenario
                        and i["name"] != "Tailscale"), "")
            label = n.get("short", n["name"]) + (f"<br/>{sub}" if sub else "")
            out.append(f'    {mermaid_id(n["id"])}["{mermaid_label(label)}"]')
        for box, kids in sorted(rope_groups.items()):
            kids.sort()
            first, last = int(kids[0][5:]), int(kids[-1][5:])
            out.append(f'    {box}["Ropes {first}-{last} (OUT1-OUT10)"]')
        out.append("  end")
    seen_rope_edges = set()
    for link in m.doc["links"]:
        if not m.link_visible(link, scenario):
            continue
        a, b = mermaid_id(link["from"]), mermaid_id(link["to"])
        if link["to"] in rope_box:
            if rope_box[link["to"]] in seen_rope_edges:
                continue
            seen_rope_edges.add(rope_box[link["to"]])
            out.append(f'  {a} -->|"XLR 24 V + SPI"| {rope_box[link["to"]]}')
            continue
        label = mermaid_label(link.get("label") or link["protocol"].split(",")[0])
        two_way = str(link.get("direction", "two-way")).startswith("two-way")
        if link["status"] == "working":
            arrow = "<-->" if two_way else "-->"
        else:
            arrow = "-.-" if two_way else "-.->"
        out.append(f'  {a} {arrow}|"{label}"| {b}')
    out.append("```")
    return out


def node_section(m, n):
    out = [f"### {n['name']} (`{n['id']}`)", "",
           f"*{n['kind']} · {n['status']} · {n['verified']} · owner {m.person(n.get('owner'))} · {m.where(n)}*", "", n["summary"], ""]
    for key in ("specs", "interfaces", "hostnames", "access", "accounts", "ports", "services", "paths", "displays", "notes"):
        v = n.get(key)
        if not v:
            continue
        title = key.replace("_", " ").capitalize()
        if isinstance(v, dict):
            out.append(f"- **{title}:**")
            out += [f"  - {k.replace('_', ' ')}: {fmt(x)}" for k, x in v.items()]
        elif isinstance(v, list) and v and isinstance(v[0], dict):
            out.append(f"- **{title}:**")
            out += [f"  - {fmt(x)}" for x in v]
        else:
            out.append(f"- **{title}:** {fmt(v)}")
    for key in sorted(set(n) - {"id", "name", "short", "kind", "place", "owner", "status", "verified", "summary", "specs", "interfaces",
                                "hostnames", "access", "accounts", "ports", "services", "paths", "displays", "notes", "open_questions", "sources"}):
        out.append(f"- **{key.replace('_', ' ').capitalize()}:** {fmt(n[key])}")
    if n.get("open_questions"):
        out.append("- **Open questions:** " + " ".join(f"{m.questions[q]['question']} (ask {m.person(m.questions[q]['ask'])})" for q in n["open_questions"]))
    if n.get("sources"):
        out.append("- **Sources:** " + "; ".join(m.sources[s]["what"] for s in n["sources"]))
    out.append("")
    return out


def render(doc):
    m = Map(doc)
    out = ["---", 'title: "A River Becoming: system map (text)"', "---", "",
           f"# {doc['title']}", "",
           f"> Generated from [system.json]({PAGE}system.json) by `tools/system_docs.py`; don't edit by hand. "
           f"Interactive version: {PAGE}", "",
           doc["about"], "", f"Updated {doc['updated']}.", "", "**Rules**", ""]
    out += [f"- {r}" for r in doc["rules"]] + [""]

    out += ["## Scenario" if len(doc["scenarios"]) == 1 else "## Scenarios", ""]
    for s in doc["scenarios"]:
        out += [f"### {s['name']} (`{s['id']}`, {s['when']})", "", s["summary"], ""]
        if s.get("open_questions"):
            out += ["Open questions: " + "; ".join(m.questions[q]["question"] for q in s["open_questions"] if q in m.questions), ""]
        out += mermaid(m, s["id"]) + [""]
    out += ["Solid arrows are working; dotted arrows are planned, stopped, blocked or unknown. An arrow points away from the side that starts the connection.", ""]

    out += ["## Places", ""]
    out += table(["Place", "Scenarios", "Status", "Summary"],
                 [[f"{p['name']} (`{p['id']}`)", ", ".join(p["scenarios"]), p["status"],
                   p["summary"] + "".join(f" {k.capitalize()}: {fmt(p[k])}." for k in ("area", "address", "network") if k in p)]
                  for p in doc["places"]]) + [""]

    out += ["## Nodes", ""]
    first = doc["scenarios"][0]["id"]
    for p in doc["places"]:
        members = [n for n in doc["nodes"] if (n["place"].get(first) or next((v for v in n["place"].values() if v), None)) == p["id"]]
        if not members:
            continue
        out += [f"## In {p['name']}", ""]
        for n in members:
            if n["kind"] != "rope":
                out += node_section(m, n)
        ropes = [n for n in members if n["kind"] == "rope"]
        if ropes:
            out += ["### Ropes", "", "Each rope: AoShow 360 LED Flex Neon, 10 m, 400 px RGB (UCS1903, 24 V), 3 universes used of 4 reserved. "
                    "Rope n is box ⌈n/10⌉, OUT ((n−1) mod 10)+1, universes 4(n−1) to 4(n−1)+2 (Will's config.local.json).", ""]
            out += table(["Rope", "Box / OUT", "Universes", "Status"],
                         [[f"{r['name']} (`{r['id']}`)", f"box {r['specs']['box']} OUT{r['specs']['out']}",
                           f"{r['specs']['universes'][0]}-{r['specs']['universes'][-1]}",
                           r["status"] + (f": {r['summary']}" if r["status"] not in ("working", "stopped") else "")]
                          for r in ropes]) + [""]

    out += ["## Links", "",
            "Every connection. Auth names the secret, never its value. Medium colours on the interactive page: "
            + "; ".join(f"`{k}` {v}" for k, v in doc["enums"]["medium"].items()) + ".", ""]
    out += table(["Link", "From → to", "Medium", "Protocol", "Direction", "Auth", "Rate", "Status", "Scenarios", "What"],
                 [[f"`{link['id']}`", f"{m.nodes[link['from']]['name']} → {m.nodes[link['to']]['name']}", link["medium"], link["protocol"],
                   link.get("direction", "two-way"), link.get("auth", ""), link.get("rate", ""),
                   f"{link['status']} ({link['verified']})", ", ".join(link["scenarios"]),
                   link["summary"] + (f" Payload: {link['payload']}." if link.get("payload") else "") + (f" Path: {link['path']}." if link.get("path") else "")]
                  for link in doc["links"]]) + [""]

    api = doc["api"]
    out += ["## Modal ↔ bitcube API", "", api["summary"], "", f"Base URL `{api['base_url']}`. {api['checked']}", "", "### Contract", ""]
    out += table(["Item", "State", "Note"], [[c["item"], c["state"], c.get("note", "")] for c in api["contract"]]) + [""]
    for ep in api["endpoints"]:
        out += [f"### `{ep['method']} {ep['path']}` ({ep['state']})", ""]
        for k in ("auth", "files", "params", "body", "stores", "used_by", "note"):
            if k in ep:
                out.append(f"- **{k.replace('_', ' ').capitalize()}:** {fmt(ep[k])}")
        out.append("")
        if "responses" in ep:
            out += table(["Status", "Response"], [[code, r if isinstance(r, str) else json.dumps(r)] for code, r in ep["responses"].items()]) + [""]
        if "example_curl" in ep:
            out += ["```sh", ep["example_curl"], "```", ""]
        if "reference_client" in ep:
            out += ["Reference client:", "", "```sh", ep["reference_client"], "```", ""]
        if "json_reading_example" in ep:
            out += ["A JSON sensor reading:", "", "```json", json.dumps(ep["json_reading_example"], indent=2, ensure_ascii=False), "```", ""]
    out += ["### Files under /data", ""]
    for f in api["files"]:
        out += [f"#### `{f['name']}`", "", f"Written by {f['written_by']}; read every {f['poll']}." + (f" {f['note']}" if f.get("note") else ""), ""]
        out += table(["Field", "Meaning"], [[f"`{k}`", v] for k, v in f["fields"].items()]) + [""]
        out += ["```json", json.dumps(f["example"], indent=2, ensure_ascii=False), "```", ""]
    out += ["### The local mirror on bitcube", ""] + [f"- **{k.replace('_', ' ').capitalize()}:** {fmt(v)}" for k, v in api["mirror"].items()] + [""]

    out += ["## Secrets (names and places only)", "", "No values, ever. Ask the holder.", ""]
    out += table(["Secret", "Unlocks", "Lives in", "Holder", "Note"],
                 [[s["name"], s["unlocks"], s["lives_in"], m.person(s["holder"]) if s["holder"] in m.people else s["holder"],
                   " ".join(x for x in (s.get("note"), s.get("verified")) if x)] for s in doc["secrets"]]) + [""]

    out += ["## Open questions", ""]
    for who in dict.fromkeys(q["ask"] for q in doc["open_questions"]):
        out += [f"**Ask {m.person(who)}**", ""]
        out += [f"- {q['question']} (`{q['id']}`{', in plan.md' if q.get('in_plan') else ''})" for q in doc["open_questions"] if q["ask"] == who]
        out.append("")

    out += ["## People", ""]
    out += table(["Who", "Role", "Accounts"],
                 [[p["name"], p["role"], "; ".join(f"{a['service']}: {a['login']}" + (f" ({a['note']})" if a.get("note") else "") for a in p.get("accounts", []))]
                  for p in doc["people"]]) + [""]

    out += ["## Sources", ""] + [f"- `{s['id']}`: {s['what']}" + (f" ({s['when']})" if s.get("when") else "") + (f" {s['url']}" if s.get("url") else "")
                                 for s in doc["sources"]] + [""]
    out += ["## Changing a fact", "", "1. Edit `docs/system/system.json`.", "2. Run `python3 tools/system_docs.py` to regenerate this file.",
            "3. Run `.venv/bin/pytest tools/tests` (structure, secret scan, real secrets from bitcube, this file in sync).", "4. Commit and push to main.", ""]
    text = "\n".join(out)
    # GitHub Pages renders .md through Liquid; a literal {{ or {% would be eaten.
    return text.replace("{{", "{ {").replace("{%", "{ %")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true", help="exit 1 if system.md is out of date")
    args = ap.parse_args()
    text = render(json.loads(SYSTEM_JSON.read_text(encoding="utf-8")))
    if args.check:
        ok = SYSTEM_MD.exists() and SYSTEM_MD.read_text(encoding="utf-8") == text
        print("system.md is up to date" if ok else "system.md is stale: run python3 tools/system_docs.py")
        return 0 if ok else 1
    SYSTEM_MD.write_text(text, encoding="utf-8")
    print(f"wrote {SYSTEM_MD.relative_to(REPO)} ({len(text.splitlines())} lines)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
