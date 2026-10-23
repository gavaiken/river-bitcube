"""Headless-Chrome checks for docs/system/index.html, the interactive system map.

    .venv/bin/pip install pytest playwright      # uses the installed Google Chrome; no browser download
    .venv/bin/pytest tools/tests/test_system_page.py
    SYSTEM_PAGE_URL=https://gavaiken.github.io/river-bitcube/system/ .venv/bin/pytest tools/tests/test_system_page.py

Without SYSTEM_PAGE_URL it serves docs/ locally. Skips if Playwright or Chrome is missing.
"""
import functools
import http.server
import json
import os
import threading
from pathlib import Path

import pytest

sync_api = pytest.importorskip("playwright.sync_api")

REPO = Path(__file__).resolve().parents[2]
DOC = json.loads((REPO / "docs" / "system" / "system.json").read_text(encoding="utf-8"))
NODES = {n["id"]: n for n in DOC["nodes"]}


def link_title(link):
    return link.get("label") or link["protocol"].split(",")[0]


def visible_in(scenario):
    nodes = [n for n in DOC["nodes"] if n["place"].get(scenario)]
    links = [l for l in DOC["links"] if scenario in l["scenarios"]
             and NODES[l["from"]]["place"].get(scenario) and NODES[l["to"]]["place"].get(scenario)]
    return nodes, links


@pytest.fixture(scope="module")
def base_url():
    if os.environ.get("SYSTEM_PAGE_URL"):
        yield os.environ["SYSTEM_PAGE_URL"].rstrip("/") + "/"
        return
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(REPO / "docs"))
    handler.log_message = lambda *a: None
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_address[1]}/system/"
    srv.shutdown()


@pytest.fixture(scope="module")
def browser():
    with sync_api.sync_playwright() as p:
        try:
            b = p.chromium.launch(channel="chrome", headless=True)
        except Exception as e:  # noqa: BLE001 - no Chrome here: skip, don't fail
            pytest.skip(f"Google Chrome not available: {e}")
        yield b
        b.close()


class Page:
    """A loaded page plus everything it logged."""

    def __init__(self, browser, url, **ctx):
        self.ctx = browser.new_context(**ctx)
        self.pg = self.ctx.new_page()
        self.problems = []
        self.pg.on("console", lambda m: self.problems.append(f"console {m.type}: {m.text}") if m.type in ("error", "warning") else None)
        self.pg.on("pageerror", lambda e: self.problems.append(f"page error: {e}"))
        self.pg.on("requestfailed", lambda r: self.problems.append(f"request failed: {r.url}"))
        self.pg.goto(url)
        self.pg.wait_for_function("window.__systemMapReady === true", timeout=15000)

    def title(self):
        return self.pg.locator("#panel-title").inner_text()

    def panel_open(self):
        return self.pg.locator("#panel").is_visible()

    def close(self):
        self.ctx.close()


@pytest.fixture
def page(browser, base_url):
    pages = []

    def make(fragment="", **ctx):
        p = Page(browser, base_url + fragment, **ctx)
        pages.append(p)
        return p
    yield make
    for p in pages:
        p.close()


def test_the_page_loads_without_errors(page):
    p = page()
    assert p.pg.title() == "River system map"
    assert p.pg.locator("#map .node").count() > 40
    assert not p.panel_open()  # nothing selected, so no details panel
    assert p.problems == []


@pytest.mark.parametrize("scenario", [s["id"] for s in DOC["scenarios"]])
def test_every_node_and_link_opens_its_panel(page, scenario):
    p = page("#scenario=" + scenario)
    nodes, links = visible_in(scenario)
    assert p.pg.locator("#map .node").count() == len(nodes)
    assert p.pg.locator("#map .link").count() == len(links)
    wrong = []
    for item, expected in [(n, n["name"]) for n in nodes] + [(l, link_title(l)) for l in links]:
        p.pg.locator(f'#map [data-id="{item["id"]}"]').dispatch_event("click")
        if not p.panel_open() or p.title() != expected:
            wrong.append(item["id"])
    assert wrong == []
    assert p.problems == []


def test_a_real_click_on_a_box_opens_it(page):
    p = page()
    p.pg.locator('#map [data-id="psac10-1"] rect.box').click()
    assert p.title() == "PSAC10 box 1"
    assert "node=psac10-1" in p.pg.evaluate("location.hash")


def test_one_scenario_means_no_scenario_switch(page):
    # The map has one scenario (Gray Area), so the Now/Show switch stays hidden; it is built from system.json,
    # so it comes back if a second scenario is ever added.
    assert len(DOC["scenarios"]) == 1
    p = page()
    assert p.pg.locator("#scenarios").is_hidden() and p.pg.locator("#scenarios button").count() == 0
    assert "Gray Area" in p.pg.locator("#scenario-lede").inner_text()
    assert "Agape" not in p.pg.locator("#scenario-lede").inner_text()


@pytest.mark.parametrize("fragment", ["#scenario=show", "#scenario=now", "#scenario=show&tab=list"])
def test_old_scenario_links_still_open_the_map(page, fragment):
    # Links from the two-scenario days (#scenario=show for Gray Area) land on the one scenario there is.
    p = page(fragment)
    nodes, links = visible_in(DOC["scenarios"][0]["id"])
    assert p.pg.locator("#map .node").count() == len(nodes) and p.pg.locator("#map .link").count() == len(links)
    assert "scenario=" not in p.pg.evaluate("location.hash")
    if "tab=list" in fragment:
        assert p.pg.locator("#tab-list").is_visible()
    assert p.problems == []


@pytest.mark.parametrize("fragment,title", [
    ("#node=bitcube", "bitcube"),
    ("#link=artnet-box1", "Art-Net U0–39"),
    ("#scenario=show&node=router-gallery", "Install router (Slate AX)"),  # an old show-scenario link
    ("#scenario=now&node=gallery-net", "Gray Area's network"),
])
def test_deep_links_open_the_right_item(page, fragment, title):
    p = page(fragment)
    assert p.panel_open() and p.title() == title
    assert "scenario=" not in p.pg.evaluate("location.hash")


def test_tab_deep_link_and_every_tab_renders(page):
    p = page("#tab=api")
    assert p.pg.locator("#tab-api").is_visible()
    assert p.pg.locator("#ep-post-ingest").is_visible()
    for tab in ("list", "secrets", "questions", "agents", "map"):
        p.pg.locator(f"#t-{tab}").click()
        assert p.pg.locator(f"#tab-{tab}").is_visible()
        assert len(p.pg.locator(f"#tab-{tab}").inner_text()) > 200
    assert p.problems == []


def test_search_by_ip_and_keyboard(page):
    p = page()
    p.pg.locator("body").press("/")
    assert p.pg.evaluate("document.activeElement.id") == "q"
    p.pg.keyboard.type("192.168.9.76")
    assert "Gallery cam" in p.pg.locator("#results").inner_text()
    p.pg.keyboard.press("Enter")
    assert p.title() == "Gallery cam"
    p.pg.locator("#panel-close").focus()
    p.pg.keyboard.press("Escape")
    assert not p.panel_open()
    p.pg.locator('#map [data-id="cam-gallery"]').focus()
    p.pg.keyboard.press("Enter")
    assert p.title() == "Gallery cam"


def test_phone_layout_has_a_bottom_sheet_and_no_sideways_scroll(page):
    p = page("#node=bitcube", viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    box = p.pg.locator("#panel").bounding_box()
    assert box["width"] == 390 and abs(box["y"] + box["height"] - 844) < 2
    assert p.pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth")


def test_dark_theme_follows_the_system_and_the_toggle(page):
    p = page(color_scheme="dark")
    dark_bg = p.pg.evaluate("getComputedStyle(document.body).backgroundColor")
    p.pg.locator("#theme").click()  # auto -> light
    light_bg = p.pg.evaluate("getComputedStyle(document.body).backgroundColor")
    assert dark_bg == "rgb(12, 20, 24)" and light_bg == "rgb(242, 245, 246)"


def test_a_malformed_deep_link_still_loads_the_map(page):
    p = page("#node=%E0")
    assert p.pg.locator("#map .node").count() > 40 and not p.panel_open()
    assert p.problems == []


def test_the_panel_kicker_names_the_place_without_a_scenario_prefix(page):
    p = page("#node=cam-gallery")
    kicker = p.pg.locator("#panel-kicker").text_content()  # text_content: inner_text comes back upper-cased by the CSS
    assert kicker == "camera · Gray Area: the floor"
    heads = p.pg.locator("#panel-body .sec h3").all_text_contents()
    assert any(h.startswith("Connections (") for h in heads) and not any("in this scenario" in h for h in heads)
    p = page("#link=wifi-bitcube")
    assert p.pg.locator("#panel-kicker").text_content() == "lan link"


def test_a_link_without_a_direction_reads_as_two_way(page):
    p = page("#link=wifi-bitcube")
    assert "↔" in p.pg.locator("#panel-body .endpoints").inner_text()


def test_arrow_up_from_the_search_box_picks_the_last_result(page):
    p = page()
    p.pg.locator("#q").fill("rope")
    buttons = p.pg.locator("#results button")
    last = buttons.nth(buttons.count() - 1).inner_text()
    p.pg.locator("#q").press("ArrowUp")
    assert p.pg.locator("#results button.active").inner_text() == last
