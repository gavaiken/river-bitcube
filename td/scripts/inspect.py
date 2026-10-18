# Print a compact view of the open project: every op under /project1 with type, inputs and errors.
def walk(comp, depth=0):
    for o in sorted(comp.children, key=lambda o: o.name):
        ins = ','.join(i.name for i in o.inputs)
        extra = ''
        if o.isTOP:
            extra = f' {o.width}x{o.height}'
        elif o.isCHOP:
            extra = f' {o.numChans}ch x {o.numSamples}'
        err = o.errors() or o.warnings()
        print('  ' * depth + f'{o.name} [{o.OPType}]{extra}' + (f' <- {ins}' if ins else '') + (f'  !! {err}' if err else ''))
        if o.isCOMP and o.name not in ('local',) and depth < 2:
            walk(o, depth + 1)

walk(op('/'))
