"""Every copy of the camera-login mask on bitcube masks up to the authority's LAST @ (as mission/lib/scrub.mjs and
calibrate.py do): ffmpeg takes the last @ too, so an @ or a quote in a camera password is all login. A mask that stopped
at the first @ left the password's tail in record.log, modal-*.log and a hand-run capture.py (review round 5, finding 46).
"""
import importlib.util
import json
import pathlib
import re

import pytest

TOOLS = pathlib.Path(__file__).resolve().parents[1]
PROBE = TOOLS / 'mission' / 'probe.ps1'


def load(rel, name):
    spec = importlib.util.spec_from_file_location(name, TOOLS / rel)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def masks():
    out = {'record.py': load('cameras/record.py', 'record_under_test').mask,
           'modal_link.py': load('modal/modal_link.py', 'modal_link_masks_under_test').mask,
           'calibrate.py': load('mission/calibrate.py', 'calibrate_masks_under_test').scrub}
    try:
        out['capture.py'] = load('pixelmap/capture.py', 'capture_under_test').scrub
    except ImportError as e:            # capture.py needs numpy (and its camera libraries); the venv on bitcube has them
        pytest.skip(f'capture.py needs {e.name}')
    return out


CASES = [
    ('rtsp://admin:p@ss@10.0.0.1/x', 'rtsp://***@10.0.0.1/x'),
    ("rtsp://admin:ab'cd@10.0.0.1:554/x", 'rtsp://***@10.0.0.1:554/x'),
    ('Error opening input rtsp://admin:NOT-A-REAL-PW@192.168.9.76:554/Preview_01_main.', 'Error opening input rtsp://***@192.168.9.76:554/Preview_01_main.'),
    ("['ffmpeg', '-i', 'rtsp://admin:s3cret@192.168.8.217:554/Preview_01_sub']", "['ffmpeg', '-i', 'rtsp://***@192.168.8.217:554/Preview_01_sub']"),
    ('rtsp://admin:pw@10.0.0.1?x=a@b', 'rtsp://***@10.0.0.1?x=a@b'),
    ('see https://example.org/a@b and me@y', 'see https://example.org/a@b and me@y'),
    ('river/video -> media/river/video/x.mp4 (550 KB)', 'river/video -> media/river/video/x.mp4 (550 KB)'),
]


@pytest.mark.parametrize('line,want', CASES)
def test_every_mask_hides_the_whole_login(line, want):
    for name, mask in masks().items():
        got = mask(line)
        assert got == want, f'{name}: {line!r} -> {got!r}'
        assert 'NOT-A-REAL-PW' not in got and 's3cret' not in got and 'ss@10' not in got, name


def test_probe_masks_log_lines_before_it_cuts_them():
    """probe.ps1 cuts the Modal link's and the recorder's last log line to 120 characters: cut first, and a cut between the
    two @ of a login leaves a tail mission control can no longer recognise as one. It masks first (the same pattern)."""
    src = PROBE.read_text(encoding='utf-8')
    assert re.search(r"function Mask-Creds", src), 'probe.ps1 has a mask'
    assert "[^\\s/?#\"<>]*@" in src, 'the same pattern as scrub.mjs: up to the last @ of the authority'
    for field in ('$link[$cam]', '$out.recorder'):
        block = src[src.index(field):src.index(field) + 400]
        cut = block.index('Substring(0')
        assert 'Mask-Creds' in block[:cut], f'{field}: masked before the cut'


def test_probe_reports_the_boot_file_start_river_would_open():
    """boot_file is the show file Start-River.cmd opens, never 'Start-River.cmd default' (review round 5, finding 19):
    boot-file.txt's file when it exists, else the same files in the same order as the launcher's fallbacks."""
    src = PROBE.read_text(encoding='utf-8')
    cmd = (TOOLS.parent / 'Start-River.cmd').read_text(encoding='utf-8')
    assert 'Start-River.cmd default' not in src
    default = re.search(r'^set "TOE=%~dp0([\w.-]+\.toe)"', cmd, re.M).group(1)
    overrides = re.findall(r'^if exist "%~dp0([\w.-]+\.toe)" set "TOE=%~dp0\1"', cmd, re.M)
    launcher = list(reversed(overrides)) + [default]          # a later line overrides an earlier one: the last that exists wins
    probe = re.search(r"if \(-not \$boot\) \{ \$boot = @\(([^)]*)\)", src).group(1)
    assert re.findall(r"'([\w.-]+\.toe)'", probe) == launcher, (probe, launcher)
    assert 'boot-file.txt' in cmd and re.search(r"Join-Path \$river 'boot-file.txt'", src), 'both read River\\boot-file.txt'
    assert '$out.boot_file_chosen' in src


def probe_mask():
    """probe.ps1's Mask-Creds, run here (no PowerShell on the Mac mini): its patterns are .NET regexes in the subset Python's re
    reads the same way. -replace is case-insensitive, and $N in its replacement is group N."""
    src = PROBE.read_text(encoding='utf-8')
    pats = {m.group(1): m.group(2).replace("''", "'") for m in re.finditer(r"^\$(CRED_\w+) = '((?:[^']|'')*)'$", src, re.M)}
    body = src[src.index('function Mask-Creds'):]
    body = body[:body.index('\n}\n')]
    steps = re.findall(r"-replace \$(CRED_\w+), '([^']*)'", body)
    assert [name for name, _ in steps] == ['CRED_URL', 'CRED_QUOTED', 'CRED_ESCAPED', 'CRED_BARE_JSON', 'CRED_BARE',
                                           'CRED_AUTH', 'CRED_BEARER', 'CRED_USER', 'CRED_FLAG', 'CRED_SSHPASS',
                                           'CRED_MYSQL', 'CRED_UCI', 'CRED_KEY_JSON', 'CRED_SKANT'], steps
    compiled = [(re.compile(pats[name], re.I), re.sub(r'\$(\d+)', r'\\g<\1>', repl)) for name, repl in steps]

    def mask(s):
        for rx, repl in compiled:
            s = rx.sub(repl, s)
        return s
    return mask


FAKE = 'NOT-A-REAL-TOKEN-a1b2c3'
PROBE_CASES = CASES + [
    # R7 #37: a JSON body, a query, an escaped JSON body, a Python dict, "key: value"
    ('{"password":"x"} ?password=x', '{"password":"***"} ?password=***'),
    ('body \'{\\"password\\":\\"p@ss w\\"}\'', 'body \'{\\"password\\":\\"***\\"}\''),
    ("{'passwd': 'secret one', 'pwd': 'two'}", "{'passwd': '***', 'pwd': '***'}"),
    ('token=abc123&x=1 secret: s3cr3t; Token = "t"', 'token=***&x=1 secret: ***; Token = "***"'),
    ('"input_tokens": 1234 the passwords file', '"input_tokens": 1234 the passwords file'),
    # CR7 #1: an object or array value is masked whole, and a bare value in JSON text stays JSON; null, true, false stay
    (f'[{{"cmd":"Login","code":0,"value":{{"Token":{{"leaseTime":3600,"name":"{FAKE}"}}}}}}]', '[{"cmd":"Login","code":0,"value":{"Token":"***"}}]'),
    ('{"token":{"a":{"b":[1,{"c":"x}y"}]}},"ok":1}', '{"token":"***","ok":1}'),
    ('{"token": 123, "secret": null, "pwd": true, "passwd": false}', '{"token": "***", "secret": null, "pwd": true, "passwd": false}'),
    ('{\\"Token\\":{\\"name\\":\\"x\\"},\\"token\\":99}', '{\\"Token\\":\\"***\\",\\"token\\":\\"***\\"}'),
    (f'{{"Token":{{"leaseTime":3600,"name":"{FAKE}', '{"Token":"***"'),
    ('token=abc password={abc}', 'token=*** password=***'),
    # CR7 #3: past an escaped quote inside the value; a value ending in an escaped backslash; an escaped body's escaped quote
    ('{"password":"ab\\"cd","user":"admin"}', '{"password":"***","user":"admin"}'),
    ('{"password":"ab\\\\","user":"admin"}', '{"password":"***","user":"admin"}'),
    ('"{\\"password\\":\\"ab\\\\\\"cd\\\\\\\\\\",\\"user\\":\\"admin\\"}"', '"{\\"password\\":\\"***\\",\\"user\\":\\"admin\\"}"'),
    ('{"password":"hunter2', '{"password":"***'),
    # R8 #38: a key with a prefix, and a command line's login forms; input_tokens and the like still spared
    ('{"cam_password":"hunter2"} CAM_PASSWORD=hunter2 python x', '{"cam_password":"***"} CAM_PASSWORD=*** python x'),
    (f'export CLAUDE_CODE_OAUTH_TOKEN={FAKE}; curl -H "X-Auth-Token: {FAKE}"', 'export CLAUDE_CODE_OAUTH_TOKEN=***; curl -H "X-Auth-Token: ***"'),
    (f'{{"access_token":"{FAKE}","expires_in":3600}}', '{"access_token":"***","expires_in":3600}'),
    ('curl -u admin:hunter2 https://h/x', 'curl -u admin:*** https://h/x'),
    (f"curl -H 'Authorization: Bearer {FAKE}' x", "curl -H 'Authorization: Bearer ***' x"),
    ('sshpass -p hunter2 ssh root@h', 'sshpass -p *** ssh root@h'),
    ('ptz.py --password hunter2 --user admin', 'ptz.py --password *** --user admin'),
    ('"input_tokens": 1234 max_tokens secret_ref: x', '"input_tokens": 1234 max_tokens secret_ref: x'),
    # CR8 #5: curl's attached -uuser:pw, and a keyword glued to its prefix (an env var, camelCase JSON, YAML)
    ('curl -uadmin:hunter2 https://h/x', 'curl -uadmin:*** https://h/x'),
    ('PGPASSWORD=hunter2 psql; MYSQLPWD=hunter2 MYSQL_PWD=hunter2 mysql', 'PGPASSWORD=*** psql; MYSQLPWD=*** MYSQL_PWD=*** mysql'),
    (f'{{"accessToken":"{FAKE}","expires_in":3600}}', '{"accessToken":"***","expires_in":3600}'),
    ('DBPASSWORD: hunter2', 'DBPASSWORD: ***'),
    # CR8 #6: -u x:y is a login only for an HTTP client (curl, wget, HTTPie, xh)
    ('docker run -u 1000:1000 img; sort -u a:b f', 'docker run -u 1000:1000 img; sort -u a:b f'),
    ('curl -s https://h/x | sort -u a:b', 'curl -s https://h/x | sort -u a:b'),
    ('"tokens_used": 3, cwd: /x', '"tokens_used": 3, cwd: /x'),
    # R9 #37: SSHPASS and pass=, mysql's attached -p, a Wi-Fi key in uci or JSON, a bare sk-ant token; bypass, sort key= spared
    ('SSHPASS=hunter2 sshpass -e ssh root@h', 'SSHPASS=*** sshpass -e ssh root@h'),
    ('api.cgi?cmd=Snap&user=admin&pass=hunter2', 'api.cgi?cmd=Snap&user=admin&pass=***'),
    ('mysql -u root -phunter2 river', 'mysql -u root -p*** river'),
    ("uci set wireless.@wifi-iface[1].key='hunter2'", "uci set wireless.@wifi-iface[1].key='***'"),
    ('{"ssid":"gray-river","key":"hunter2"}', '{"ssid":"gray-river","key":"***"}'),
    (f'token sk-ant-oat01-{FAKE}', 'token sk-ant-***'),
    ('op("x").bypass = True; sort key=name', 'op("x").bypass = True; sort key=name'),
    # CR9 #14: mysql's port is -P, its password -p: only the lower case is masked (case-sensitive inside -replace)
    ('mysql -h db -P3306 -u root -phunter2 river', 'mysql -h db -P3306 -u root -p*** river'),
    ('mysqldump -P3306 river', 'mysqldump -P3306 river'),
]


@pytest.mark.parametrize('line,want', PROBE_CASES)
def test_probe_masks_logins_in_urls_json_and_queries(line, want):
    """probe.ps1 Mask-Creds hides what mission/lib/scrub.mjs hides, the same way (review CR7 #1, #3): the camera's login reply's
    token object whole, a bare JSON value as "***" so the JSON stays JSON, a quoted value past an escaped quote inside it."""
    got = probe_mask()(line)
    assert got == want, f'{line!r} -> {got!r}'
    assert FAKE not in got and 'hunter2' not in got and 'cd"' not in got
    if want.startswith('{"') and want.endswith('}'):
        json.loads(got)
