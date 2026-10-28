"""bitcube's own half of mission control's locks (review round 6, findings 27, 35 and 39). There is no PowerShell on the
Mac mini where this suite runs, so these read the scripts: where the guard sits, what it checks and what it answers.

- probe.ps1 refuses ropes, hub75, switch, rebuild and lightsroute while a calibration runs (calibration.json says running and
  its job's process is alive, and it is not a dry run): the rule mission control's calBlocked applies, now on bitcube itself,
  so no change made through probe.ps1 (a phone, the studio chat, a hand-run SSH) can spoil a run. Only probe.ps1 is guarded:
  td.ps1, td_save.ps1, Start-River.cmd or a killed process are not (R7 #35: the chat keeps to mission control by its brief).
- calibrate.ps1 -Action start says whether it launched the job: started false on every refusal (nothing runs), started true
  with the pid and its own clock (requested) once launched, and pending (a start, not a refusal or a maybe) when the job hasn't written yet.
"""
import pathlib
import re

TOOLS = pathlib.Path(__file__).resolve().parents[1]
PROBE = TOOLS / 'mission' / 'probe.ps1'
CALIBRATE = TOOLS / 'mission' / 'calibrate.ps1'
MISSION_MJS = TOOLS.parent / 'mission' / 'lib' / 'mission.mjs'
MODEL_JS = TOOLS.parent / 'mission' / 'public' / 'model.js'     # CAL_RUNNING: mission.mjs's 409 and the pages' reason
WORDS = 'a calibration is running. Stop it on the Lights page first'


def quoted(s):
    return sorted(re.findall(r"'([\w-]+)'", s))


def test_probe_refuses_what_a_calibration_blocks_the_same_list_as_mission_control():
    src = PROBE.read_text(encoding='utf-8')
    ps = re.search(r"^\$CAL_BLOCKED = @\(([^)]*)\)", src, re.M)
    js = re.search(r"export const CAL_BLOCKED = \[([^\]]*)\]", MISSION_MJS.read_text(encoding='utf-8'))
    assert ps and js
    assert quoted(ps.group(1)) == quoted(js.group(1)) == sorted(['ropes', 'hub75', 'test', 'switch', 'rebuild', 'lightsroute', 'overlay', 'filling'])
    assert WORDS in src and WORDS in MODEL_JS.read_text(encoding='utf-8'), 'the team words, the same on both sides'


def param_block(src):
    """probe.ps1's one shared param(...) line, split into its parameters: [(attributes, type, name, default)]."""
    line = next(l for l in src.splitlines() if l.startswith('param('))
    body, depth, parts, cur = line[len('param('):].rstrip(), 0, [], ''
    assert body.endswith(')')
    for ch in body[:-1]:
        depth += ch in '([{' and 1 or 0
        depth -= ch in ')]}' and 1 or 0
        if ch == ',' and depth == 0:
            parts.append(cur.strip()); cur = ''
        else:
            cur += ch
    parts.append(cur.strip())
    out = []
    for p in parts:
        m = re.fullmatch(r"((?:\[[^$]*\]\s*)*)\$(\w+)(?:\s*=\s*(.+))?", p)
        assert m, f'unreadable parameter: {p}'
        out.append((m.group(1), m.group(2), m.group(3)))
    return out


def test_probe_param_block_is_well_formed_and_the_filling_dials_match_mission_control():
    """One shared param block for every action: each name once, and the filling glass's ranges as lib/mission.mjs checks them
    (model.js FILLING_PALETTES and FILLING_RANGE); -Brightness is hub75's too, so the filling action checks its range itself."""
    src = PROBE.read_text(encoding='utf-8')
    params = param_block(src)
    names = [n.lower() for _, n, _ in params]
    assert len(names) == len(set(names)), 'a parameter twice'
    attrs = {n: a for a, n, _ in params}
    model = MODEL_JS.read_text(encoding='utf-8')
    palettes = quoted(re.search(r"export const FILLING_PALETTES = \[([^\]]*)\]", model).group(1))
    assert quoted(re.search(r"ValidateSet\(([^)]*)\)", attrs['Palette']).group(1)) == palettes
    assert '[ValidateRange(0,1)]' in attrs['Intensity'] and 'Nullable[double]' in attrs['Intensity']
    assert '[ValidateRange(0.25,3)]' in attrs['Speed'] and 'Nullable[double]' in attrs['Speed']
    rng = re.search(r"export const FILLING_RANGE = \{ brightness: \[0, 1\], intensity: \[0, 1\], speed: \[0\.25, 3\] \}", model)
    assert rng, 'model.js FILLING_RANGE is what probe.ps1 validates'
    block = src[src.index("if ($Action -eq 'filling') {"):]
    assert "$PSBoundParameters.ContainsKey('Brightness')" in block and '$Brightness -lt 0' in block and '$Brightness -gt 1' in block
    # written only while TouchDesigner answers on the filling glass, atomically (a temporary file swapped in)
    assert "$td.file -ne 'river-filling.toe'" in block
    assert '.tmp' in block and '[IO.File]::Replace(' in block and '[IO.File]::Move(' in block
    assert src.index('if ($CAL_BLOCKED -contains $Action)') < src.index("if ($Action -eq 'filling') {")


def test_probe_checks_before_anything_acts_and_then_only_reports():
    src = PROBE.read_text(encoding='utf-8')
    guard = src.index('if ($CAL_BLOCKED -contains $Action)')
    for acts in ("if ($Action -eq 'rebuild') {", "if ($Action -in 'bootfile', 'switch') {", "if ($Action -eq 'switch') {",
                 "if ($Action -eq 'lightsroute') {", "$req = @{ action"):
        assert guard < src.index(acts), f'the guard comes before: {acts}'
    block = src[guard:src.index("if ($Action -eq 'rebuild') {")]
    # running, from the progress file, and alive (its job's process is there): a stale file never blocks
    assert "Join-Path $river 'calibration.json'" in block
    assert '.running' in block and 'Get-Process -Id ([int]$calRun.pid)' in block
    # a dry run (or a decode of earlier photos) touches no lights: it refuses nothing (R7 #20)
    assert '-not $calDry' in block and "$calRun.mode -eq 'dry-run'" in block and '$calRun.dry_run' in block
    # refused: ok false, the words, and the action becomes a plain status report
    assert '$out.ok = $false' in block and f"$out.error = '{WORDS}'" in block
    assert "$Action = 'status'" in block
    # Stop is never here (calibrate.ps1 -Action cancel), and the read status is untouched
    assert 'cancel' not in quoted(re.search(r"^\$CAL_BLOCKED = @\(([^)]*)\)", src, re.M).group(1))


def start_block():
    src = CALIBRATE.read_text(encoding='utf-8')
    return src[src.index("if ($Action -eq 'start') {"):src.index("if ($Action -eq 'cancel') {")]


def test_calibrate_start_says_whether_it_launched_the_job():
    block = start_block()
    launch = block.index('try {')
    refusals = [l for l in block[:launch].splitlines() if 'Out-Json' in l]
    assert len(refusals) == 4
    for line in refusals:
        assert 'ok = $false; started = $false' in line, line
    # a launch that throws is a refusal too: nothing runs
    catch = block[block.index('} catch {', launch):]
    assert 'started = $false' in catch.split('exit 0')[0]
    assert '-ErrorAction Stop' in block[launch:block.index('} catch {', launch)]


def test_calibrate_start_launches_through_a_scheduled_task_by_default():
    # 26 Oct: a Start-Process child died with the SSH session 0.1 s into every run ("its process is gone"). Mission control
    # calls this over SSH, so the default launch must be the scheduled task; Start-Process only on an explicit -Detached.
    block = start_block()
    launch = block[block.index('try {'):block.index('} catch {', block.index('try {'))]
    first = launch.split('\n        } else {')[0]
    assert 'if (-not $Detached) {' in first and 'Start-ScheduledTask' in first, 'the default branch is the scheduled task'
    assert 'Start-Process' not in first
    assert 'if (-not $Detached) { Unregister-ScheduledTask' in block


def test_calibrate_start_answers_started_with_the_pid_and_its_clock_and_pending_before_the_first_write():
    block = start_block()
    reported, waiting = block.split('} else {\n        # Launched (Start-Process gave a pid), but no first write yet')
    answer = reported[reported.rindex('Out-Json'):]
    assert 'started = $true' in answer and 'pid = $procId' in answer and 'requested = $t0' in answer
    later = waiting[waiting.index('Out-Json'):waiting.index('exit 0')]
    assert 'ok = $true; started = $true; pending = $true' in later, 'launched: a start, not a maybe (mc.mjs and Recent must not say "may or may not")'
    assert 'pid = $procId' in later and 'requested = $t0' in later
    assert 'calibration =' not in later, "the file there is the run before: it isn't this run"
    assert "within 6 s" not in later, 'not a refusal: no "did not report" error'
