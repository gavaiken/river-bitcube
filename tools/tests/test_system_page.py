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


def test_the_scenario_switch_changes_the_map_and_the_hash(page):
    p = page()
    assert p.pg.locator('#map [data-id="gallery-net"]').count() == 0
    p.pg.locator("#sc-show").click()
    assert p.pg.locator('#map [data-id="gallery-net"]').count() == 1
    assert "scenario=show" in p.pg.evaluate("location.hash")
    p.pg.locator("#sc-now").click()
    assert p.pg.locator('#map [data-id="gallery-net"]').count() == 0


@pytest.mark.parametrize("fragment,title,scenario", [
    ("#node=bitcube", "bitcube", "now"),
    ("#link=artnet-box1", "Art-Net U0–39", "now"),
    ("#scenario=show&node=gallery-net", "Gray Area gallery network", "show"),
    ("#node=gallery-net", "Gray Area gallery network", "show"),  # only exists in the show: the page switches
])
def test_deep_links_open_the_right_item(page, fragment, title, scenario):
    p = page(fragment)
    assert p.panel_open() and p.title() == title
    assert p.pg.locator(f"#sc-{scenario}").get_attribute("aria-checked") == "true"


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
    p.pg.keyboard.type("10.0.7.76")
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
