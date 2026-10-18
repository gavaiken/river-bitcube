# One-time install of the Claude bridge into the open TouchDesigner project.
# In TD: open the Textport (Alt+T) and run:
#   exec(open(r'C:\Users\user\River\td\bridge\install_bridge.py').read())
# then save the project (Ctrl+S). The bridge listens on port 9980 and only answers localhost.

import os

BRIDGE_DIR = r'C:\Users\user\River\td\bridge'
PORT = 9980

root = op('/')
bridge = root.op('claude_bridge') or root.create(baseCOMP, 'claude_bridge')

cb = bridge.op('callbacks') or bridge.create(textDAT, 'callbacks')
cb.par.file = os.path.join(BRIDGE_DIR, 'claude_bridge_callbacks.py').replace('\\', '/')
cb.par.syncfile = True

ws = bridge.op('webserver') or bridge.create(webserverDAT, 'webserver')
ws.par.port = PORT
ws.par.callbacks = cb
ws.par.active = True

print('claude_bridge ready on port', PORT)
