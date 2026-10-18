# Claude <-> TouchDesigner bridge: callbacks for a WebServer DAT.
# Installed by install_bridge.py; this file is synced into the Text DAT (edit here, not in TD).
#
# Endpoints (localhost only; other clients get 403):
#   POST /exec        body = Python source. If it's a single expression, its value is returned.
#   GET  /errors      every operator error/warning in the project.
#   GET  /screenshot?op=/project1/out1&path=C:/Users/user/River/frames/x.png   save a TOP to an image.
# Response: JSON {"ok": bool, "result": str|null, "stdout": str, "error": str|null}

import contextlib
import io
import json
import traceback
import urllib.parse

def _is_local(addr):
    addr = str(addr).strip('[]')
    return addr.startswith(('127.', '::ffff:127.')) or addr in ('::1', 'localhost')


def _reply(response, status, payload):
    response['statusCode'] = status
    response['statusReason'] = 'OK' if status == 200 else 'Error'
    response['content-type'] = 'application/json'
    response['data'] = json.dumps(payload, default=str)
    return response


def _body(request):
    data = request.get('data', b'')
    if isinstance(data, (bytes, bytearray)):
        data = data.decode('utf-8', 'replace')
    return data or ''


def _run(source):
    out = io.StringIO()
    env = {'op': op, 'ops': ops, 'parent': parent, 'project': project,
           'app': app, 'td': td, 'tdu': tdu, 'absTime': absTime, 'me': me}
    result = None
    with contextlib.redirect_stdout(out):
        try:
            result = eval(compile(source, '<claude>', 'eval'), env)
        except SyntaxError:
            exec(compile(source, '<claude>', 'exec'), env)
    return result, out.getvalue()


def onHTTPRequest(webServerDAT, request, response):
    if not _is_local(request.get('clientAddress', '')):
        return _reply(response, 403, {'ok': False, 'error': 'localhost only'})

    parsed = urllib.parse.urlparse(request.get('uri', ''))
    query = dict(urllib.parse.parse_qsl(parsed.query))
    query.update(request.get('pars') or {})     # TD passes query parameters here, not in 'uri'
    try:
        if parsed.path == '/exec':
            result, stdout = _run(_body(request))
            return _reply(response, 200, {'ok': True, 'result': None if result is None else repr(result),
                                          'stdout': stdout, 'error': None})
        if parsed.path == '/errors':
            errs = op('/').errors(recurse=True)
            warns = op('/').warnings(recurse=True)
            return _reply(response, 200, {'ok': True, 'result': {'errors': errs, 'warnings': warns},
                                          'stdout': '', 'error': None})
        if parsed.path == '/screenshot':
            top = op(query.get('op', '/project1/out1'))
            if top is None:
                return _reply(response, 404, {'ok': False, 'error': 'no such op: ' + query.get('op', '')})
            path = query.get('path', project.folder + '/frames/td_screenshot.png')
            top.save(path)
            return _reply(response, 200, {'ok': True, 'result': path, 'stdout': '', 'error': None})
        return _reply(response, 404, {'ok': False, 'error': 'unknown endpoint ' + parsed.path})
    except Exception:
        return _reply(response, 500, {'ok': False, 'result': None, 'stdout': '', 'error': traceback.format_exc()})


def onWebSocketOpen(webServerDAT, client, uri):
    return


def onWebSocketClose(webServerDAT, client):
    return


def onWebSocketReceiveText(webServerDAT, client, data):
    return


def onWebSocketReceiveBinary(webServerDAT, client, data):
    return


def onServerStart(webServerDAT):
    return


def onServerStop(webServerDAT):
    return
