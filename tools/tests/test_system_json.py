"""Checks for docs/system/system.json, the system map (run: .venv/bin/pytest tools/tests).

The structure tests use tiny made-up maps; the last tests check the real file and every
published page for secrets. Secret values are never printed: failures name files only.
"""
import copy
import json
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "tools"))
import system_check as sc  # noqa: E402


def tiny():
    """The smallest valid map: two places, two nodes, one link, both scenarios."""
    return {
        "schema_version": 1,
        "scenarios": [{"id": "now"}, {"id": "show"}],
        "places": [{"id": "agape", "scenarios": ["now", "show"]}, {"id": "modal", "scenarios": ["now", "show"]}],
        "nodes": [
            {"id": "bitcube", "kind": "computer", "place": {"now": "agape", "show": "agape"}, "status": "working", "verified": "confirmed"},
            {"id": "modal-app", "kind": "cloud-app", "place": {"now": "modal", "show": "modal"}, "status": "planned", "verified": "awaiting:Dave"},
        ],
        "links": [{"id": "sync-pull", "from": "bitcube", "to": "modal-app", "medium": "https", "scenarios": ["now", "show"],
                   "status": "planned", "verified": "unverified"}],
        "layout": {"scenarios": {s: {"places": {"agape": [0, 0, 10, 10], "modal": [20, 0, 10, 10]},
                                     "nodes": {"bitcube": [5, 5], "modal-app": [25, 5]}} for s in ("now", "show")}},
    }


def test_a_minimal_map_is_valid():
    assert sc.structure_errors(tiny()) == []


def test_duplicate_ids_are_flagged():
    doc = tiny()
    doc["links"][0]["id"] = "bitcube"
    assert any("duplicate id 'bitcube'" in e for e in sc.structure_errors(doc))


def test_ids_must_be_safe_in_a_url_hash():
    doc = tiny()
    doc["nodes"][0]["id"] = "Bit Cube"
    doc["links"][0]["from"] = "Bit Cube"
    doc["layout"]["scenarios"]["now"]["nodes"]["Bit Cube"] = [5, 5]
    assert any("'Bit Cube' is not a lowercase-hyphen id" in e for e in sc.structure_errors(doc))


def test_a_link_to_a_missing_node_is_flagged():
    doc = tiny()
    doc["links"][0]["to"] = "nowhere"
    assert any("link 'sync-pull' goes to unknown node 'nowhere'" in e for e in sc.structure_errors(doc))


def test_every_node_needs_a_place_for_every_scenario():
    doc = tiny()
    del doc["nodes"][0]["place"]["show"]
    assert any("node 'bitcube' has no place for scenario 'show'" in e for e in sc.structure_errors(doc))


def test_a_node_can_be_absent_from_a_scenario_with_an_explicit_null():
    doc = tiny()
    doc["links"] = []
    doc["nodes"][0]["place"]["show"] = None
    del doc["layout"]["scenarios"]["show"]["nodes"]["bitcube"]
    assert sc.structure_errors(doc) == []


def test_a_node_must_sit_in_a_place_that_exists_in_that_scenario():
    doc = tiny()
    doc["places"][1]["scenarios"] = ["now"]
    assert any("node 'modal-app' is in place 'modal', which is not in scenario 'show'" in e for e in sc.structure_errors(doc))


def test_a_link_needs_both_ends_present_in_each_of_its_scenarios():
    doc = tiny()
    doc["nodes"][1]["place"]["show"] = None
    del doc["layout"]["scenarios"]["show"]["nodes"]["modal-app"]
    assert any("link 'sync-pull' is in scenario 'show' but 'modal-app' is not" in e for e in sc.structure_errors(doc))


@pytest.mark.parametrize("section,field,bad", [
    ("nodes", "status", "fine"), ("links", "status", "ok"),
    ("nodes", "verified", "probably"), ("links", "verified", "awaiting:"),
    ("links", "medium", "carrier pigeon"),
])
def test_statuses_verification_and_media_come_from_fixed_lists(section, field, bad):
    doc = tiny()
    doc[section][0][field] = bad
    assert any(f"{field} {bad!r}" in e for e in sc.structure_errors(doc))


def test_awaiting_names_a_person():
    doc = tiny()
    doc["nodes"][0]["verified"] = "awaiting:Will"
    assert sc.structure_errors(doc) == []


def test_every_placed_node_has_a_diagram_position():
    doc = tiny()
    del doc["layout"]["scenarios"]["now"]["nodes"]["bitcube"]
    assert any("'bitcube' has no position in the 'now' diagram" in e for e in sc.structure_errors(doc))


def test_ropes_are_positioned_automatically():
    doc = with_boxes(tiny())
    doc["nodes"].append(rope(1, 1, 1, [0, 1, 2]))
    assert sc.structure_errors(doc) == []


def with_boxes(doc):
    """Add the two PSAC10s that ropes hang off."""
    for b in (1, 2):
        doc["nodes"].append({"id": f"psac10-{b}", "kind": "led-controller", "place": {"now": "agape", "show": "agape"},
                             "status": "working", "verified": "confirmed"})
        for s in ("now", "show"):
            doc["layout"]["scenarios"][s]["nodes"][f"psac10-{b}"] = [b, 1]
    return doc


def rope(n, box, out, universes):
    return {"id": f"rope-{n:02d}", "kind": "rope", "place": {"now": "agape", "show": "agape"}, "status": "working",
            "verified": "confirmed", "parent": f"psac10-{box}", "specs": {"box": box, "out": out, "universes": universes}}


def test_a_rope_must_match_wills_universe_mapping():
    doc = with_boxes(tiny())
    # Will's config.local.json: box 2 starts at universe 40, 4 universes per rope, so rope 12 is box 2 OUT2, universes 44-46.
    doc["nodes"].append(rope(12, 2, 2, [44, 45, 46]))
    assert not any("rope-12" in e for e in sc.structure_errors(doc))
    doc["nodes"][-1] = rope(12, 2, 2, [40, 41, 42])
    assert any("rope-12: expected box 2 OUT2 universes [44, 45, 46]" in e for e in sc.structure_errors(doc))
    doc["nodes"][-1] = rope(12, 1, 2, [44, 45, 46])
    assert any("rope-12: expected box 2" in e for e in sc.structure_errors(doc))


def test_every_api_item_is_confirmed_or_awaiting_someone():
    doc = tiny()
    doc["api"] = {"contract": [{"id": "c-pull", "state": "confirmed"}], "endpoints": [{"id": "post-ingest", "state": "awaiting:Dave"}]}
    assert sc.structure_errors(doc) == []
    doc["api"]["contract"][0]["state"] = "maybe"
    assert any("api item 'c-pull'" in e for e in sc.structure_errors(doc))


# ---------------------------------------------------------------- the real map

SYSTEM_JSON = REPO / "docs" / "system" / "system.json"


@pytest.fixture(scope="module")
def real():
    return json.loads(SYSTEM_JSON.read_text(encoding="utf-8"))


def test_the_system_map_is_valid(real):
    assert sc.structure_errors(real) == []


def test_the_map_has_all_twenty_ropes(real):
    ropes = sorted(n["id"] for n in real["nodes"] if n["kind"] == "rope")
    assert ropes == [f"rope-{n:02d}" for n in range(1, 21)]


def test_the_maps_legend_matches_the_validator(real):
    assert set(real["enums"]["status"]) == sc.STATUSES
    assert set(real["enums"]["medium"]) == sc.MEDIA


# ---------------------------------------------------------------- secret scanning

FAKE = "Zq7" + "x9Lm2Pw4Rt6Yb8Nc0Vd"  # built at runtime: no token-shaped literal in the repo


@pytest.mark.parametrize("text,pattern", [
    ("rtsp://admin:" + FAKE + "@10.0.7.76:554/Preview_01_main", "url-credentials"),
    ("Authorization: Bearer " + FAKE, "bearer-value"),
    ('"password": "' + FAKE + '"', "secret-assignment"),
    ("INGEST_TOKEN=" + FAKE, "secret-assignment"),
    ("-----BEGIN OPENSSH " + "PRIVATE KEY-----", "private-key"),
    ("ghp_" + FAKE * 2, "token-prefix"),
    ("tskey-auth-" + FAKE, "token-prefix"),
    ("ak-" + FAKE + "ab", "token-prefix"),
])
def test_the_scanner_finds_secret_shaped_strings(text, pattern):
    assert ("line 2", pattern) in sc.secret_pattern_hits("intro\n" + text + "\n")


@pytest.mark.parametrize("text", [
    "rtsp://admin:<password>@10.0.7.76:554/Preview_01_main",
    "rtsp://admin:PASSWORD@192.168.8.103:554/Preview_01_main",
    "Authorization: Bearer <INGEST_TOKEN>",
    'curl -H "Authorization: Bearer $INGEST_TOKEN"',
    "Bearer INGEST_TOKEN from Modal secret river-agent-web",
    "with SITE_TOKEN: cookie river_token=<SITE_TOKEN>",
    "the camera admin password lives in secrets.local.json",
    "Dave's SSH key (comment river, SHA256:aXW4LMdJXbPfPv8mRImLDWTjkVZ3f6Y818HEqin+/No)",
    "https://to-be-a-river--river.modal.run/data/state.json",
])
def test_the_scanner_lets_placeholders_and_names_through(text):
    assert sc.secret_pattern_hits(text) == []


def test_scanner_hits_never_contain_the_matched_text():
    hits = sc.secret_pattern_hits("Bearer " + FAKE)
    assert hits and FAKE not in repr(hits)


def published_files():
    """The pages this work publishes for people and agents."""
    files = sorted((REPO / "docs" / "system").glob("*")) + [REPO / "docs" / "llms.txt"]
    return [f for f in files if f.is_file()]


def test_published_docs_have_no_secret_shaped_strings():
    hits = {f.relative_to(REPO).as_posix(): sc.secret_pattern_hits(f.read_text(encoding="utf-8")) for f in published_files()}
    assert {f: h for f, h in hits.items() if h} == {}


def test_a_redacted_value_never_prints():
    v = sc.Redacted(FAKE)
    assert FAKE not in repr(v) and FAKE not in str(v) and FAKE not in f"{v} {[v]}"
    assert v in "prefix " + FAKE + " suffix"


def test_files_containing_finds_a_value_in_any_encoding(tmp_path):
    (tmp_path / "plain.md").write_text("x " + FAKE, encoding="utf-8")
    (tmp_path / "wide.toe").write_bytes(("x" + FAKE).encode("utf-16-le"))
    (tmp_path / "url.txt").write_text("rtsp://admin:" + FAKE.replace("x", "x/") + "@cam", encoding="utf-8")
    (tmp_path / "clean.md").write_text("nothing here", encoding="utf-8")
    secrets = [sc.Redacted(FAKE), sc.Redacted(FAKE.replace("x", "x/"))]
    found = sc.files_containing(secrets, sorted(tmp_path.iterdir()), root=tmp_path)
    assert found == ["plain.md", "url.txt", "wide.toe"]


def test_secret_values_come_out_of_urls_and_plain_strings():
    values = sc.secret_values({"cameras": {"gallery": "rtsp://admin:" + FAKE + "@10.0.7.76:554/Preview_01_main"}, "token": FAKE + "T"})
    assert sorted(map(sc.Redacted.reveal, values)) == sorted([FAKE, FAKE + "T", "rtsp://admin:" + FAKE + "@10.0.7.76:554/Preview_01_main"])
    assert all(isinstance(v, sc.Redacted) for v in values)


@pytest.fixture(scope="module")
def real_secrets():
    values, why = sc.real_secret_values(REPO)
    if not values:
        pytest.skip(f"no secret values to check against: {why}")
    return values


def test_bitcubes_secrets_were_read(real_secrets):
    assert len(real_secrets) >= 2  # at least the two camera URLs


def test_no_file_in_the_repo_holds_a_real_secret(real_secrets):
    assert sc.files_containing(real_secrets, sc.repo_files(REPO), root=REPO) == []


def test_the_river_sites_coordinates_are_not_published():
    env = sc.sibling_repo(REPO, "river-agent") / "modal_deploy" / "agent.env"
    if not env.exists():
        pytest.skip("river-agent checkout not found next to this repo")
    coords = sc.river_coordinates(env.read_text(encoding="utf-8"))
    assert len(coords) >= 4  # lat and lon: full, truncated and rounded to two decimals
    docs = [f for f in sc.repo_files(REPO) if f.relative_to(REPO).parts[0] == "docs"]
    assert sc.files_containing(coords, docs, root=REPO) == []


# ---------------------------------------------------------------- system.md (tools/system_docs.py)

SYSTEM_MD = REPO / "docs" / "system" / "system.md"


def test_system_md_covers_every_node_link_and_secret(real):
    import system_docs
    md = system_docs.render(real)
    missing = [i["id"] for k in ("nodes", "links") for i in real[k] if f"`{i['id']}`" not in md]
    missing += [s["name"] for s in real["secrets"] if s["name"] not in md]
    assert missing == []
    assert md.count("```mermaid") == len(real["scenarios"])


def test_system_md_survives_github_pages_liquid(real):
    import system_docs
    md = system_docs.render(real)
    assert "{{" not in md and "{%" not in md


def test_system_md_is_in_sync_with_system_json(real):
    import system_docs
    assert SYSTEM_MD.exists(), "run: python3 tools/system_docs.py"
    assert SYSTEM_MD.read_text(encoding="utf-8") == system_docs.render(real), "system.md is stale: run python3 tools/system_docs.py"


# ---------------------------------------------------------------- code review fixes (18 Oct)

@pytest.mark.parametrize("text", [
    'curl -H \\"Authorization: Bearer $INGEST_TOKEN\\" (inside a JSON string)',
])
def test_an_escaped_quote_after_a_placeholder_is_not_a_secret(text):
    assert sc.secret_pattern_hits(text) == []


@pytest.mark.parametrize("text", [
    "INGEST_TOKEN=AB12CD34EF56GH",          # an uppercase token is still a token
    "Authorization: Bearer K7Q2ZP9M4X",
    '"password": "$ecretPa55"',             # starts with $, but isn't an environment-variable reference
    "password='*Hunter22'",
])
def test_secret_shaped_values_that_look_like_names_are_still_flagged(text):
    assert sc.secret_pattern_hits(text) != []


def test_a_password_with_a_slash_is_extracted_from_its_url():
    values = sc.secret_values({"cam": "rtsp://admin:ab/cd99" + FAKE + "@10.0.7.76:554/Preview_01_main"})
    assert "ab/cd99" + FAKE in [v.reveal() for v in values]


def test_river_coordinates_handle_quotes_export_and_rounding():
    coords = [c.reveal() for c in sc.river_coordinates('export WEATHER_LAT="12.3456"\nWEATHER_LON=-98.7654\n')]
    assert {"12.3456", "12.34", "12.35", "98.7654", "98.76", "98.77"} <= set(coords)


@pytest.mark.parametrize("where,field,value,message", [
    ("nodes", "open_questions", ["q-typo"], "unknown open question 'q-typo'"),
    ("links", "sources", ["s-missing"], "unknown source 's-missing'"),
    ("nodes", "owner", "nobody", "unknown owner 'nobody'"),
])
def test_references_to_questions_sources_and_people_must_exist(where, field, value, message):
    doc = tiny()
    doc[where][0][field] = value
    assert any(message in e for e in sc.structure_errors(doc))


def test_a_rope_needs_its_box_placed_wherever_the_rope_is():
    doc = tiny()
    doc["nodes"].append(rope(1, 1, 1, [0, 1, 2]))
    assert any("rope-01: parent 'psac10-1'" in e for e in sc.structure_errors(doc))


def test_an_unreadable_file_is_reported_not_skipped(tmp_path):
    missing = tmp_path / "gone.toe"
    assert sc.files_containing([sc.Redacted(FAKE)], [missing], root=tmp_path) == ["gone.toe (unreadable)"]


def test_secrets_are_found_in_the_main_checkout_from_a_worktree(tmp_path, monkeypatch):
    main = tmp_path / "main"
    (main / ".git").mkdir(parents=True)
    (main / "secrets.local.json").write_text(json.dumps({"cameras": {"gallery": "rtsp://admin:" + FAKE + "@10.0.7.76:554/x"}}))
    monkeypatch.setattr(sc, "main_checkout", lambda repo: main)
    values, source = sc.real_secret_values(tmp_path / "main" / ".worktrees" / "wt")
    assert FAKE in [v.reveal() for v in values] and "secrets.local.json" in source
