# Execute DAT for /project1/ropes (synced from the repo; edit here, not in TD).
# Each frame, hands off to artnet_out.tick(), which sends when Active and due (Fps).

def onFrameEnd(frame):
    op('artnet_out').module.tick(parent())
    return
