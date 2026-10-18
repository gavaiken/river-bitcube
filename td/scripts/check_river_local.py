# Check the river_local sampling end to end (run with  .\tools\td.ps1 -File .\td\scripts\check_river_local.py).
# Turn the UV test field on a few frames before (op('/project1/river_local').par.Uvtest = True): the field
# is then R = u, G = v, so every rope pixel in /project1/ropes/rope_tex must carry its own UV from
# uv_table (and black where a rope is unmapped). Reads rope_tex the same way artnet_out.canvas_frame does.
import numpy as np

rl = op('/project1/river_local')
tab = rl.op('uv_table')
uv = np.array([[float(tab[i, 0]), float(tab[i, 1])] for i in range(1, tab.numRows)]).reshape(20, 400, 2)
tex = op('/project1/ropes/rope_tex')
tex.cook(force=True)              # nothing pulls rope_tex while the ropes Source isn't 'canvas'
frame = np.transpose(tex.numpyArray()[::-1, :, :3], (1, 0, 2))     # = artnet_out.canvas_frame at 20x400
mapped = uv[:, :, 0] >= 0
if not mapped.any():
    raise RuntimeError('uv_table maps no rope pixels: rebuild with td/build/build_river_local.py')
err_u = np.abs(frame[:, :, 0] - uv[:, :, 0])[mapped]
err_v = np.abs(frame[:, :, 1] - uv[:, :, 1])[mapped]
print('uvtest on:', rl.par.Uvtest.eval(),
      '| max |R-u|: %.4f  max |G-v|: %.4f' % (err_u.max(), err_v.max()),
      '| unmapped max: %.4f' % (frame[~mapped].max() if (~mapped).any() else 0),
      '| rope 0 px 0 / 399 RG:', frame[0, 0, :2].round(3), uv[0, 0].round(3), frame[0, 399, :2].round(3), uv[0, 399].round(3))
