"""Summarize a finished full-cycle trace without needing TouchDesigner or numpy."""
import argparse
import bisect
import csv
import json
from pathlib import Path


def number(row,key):
    try:return float(row.get(key,''))
    except (ValueError,TypeError):return None


def stats(values):
    a=sorted(v for v in values if v is not None)
    def p(q):return a[round((len(a)-1)*q)] if a else None
    return {'n':len(a),'p50':p(.5),'p95':p(.95),'p99':p(.99),'max':a[-1] if a else None}


def report(folder):
    folder=Path(folder)
    with (folder/'events.csv').open() as f:rows=list(csv.DictReader(f))
    frames=[r for r in rows if r['kind']=='frame'];sends=[r for r in rows if r['kind']=='artnet']
    system=[]
    if (folder/'system.csv').exists():
        with (folder/'system.csv').open() as f:system=list(csv.DictReader(f))
    slow=[r for r in frames if (number(r,'interval_ms') or 0)>33.34]
    epochs=[number(r,'epoch') for r in system]
    def scene(row):
        if not system:return {}
        i=max(0,bisect.bisect_right(epochs,number(row,'epoch'))-1)
        return {k:system[i].get(k) for k in ('phase','loop_t_s','cpu_pct','td_cpu_pct','ram_available_mb')}
    episodes=[]
    for row in slow:
        e=number(row,'epoch')
        if not episodes or e-episodes[-1]['last_epoch']>1:
            episodes.append({'start_epoch':e,'last_epoch':e,'slow_frames':0,'max_interval_ms':0,'look':row['look'],'clip':Path(row['clip']).name,'scene':scene(row)})
        ep=episodes[-1];ep['last_epoch']=e;ep['slow_frames']+=1;ep['max_interval_ms']=max(ep['max_interval_ms'],number(row,'interval_ms'))
    timings={}
    if frames:
        for k in frames[0]:
            if k.endswith('_ms'):
                timings[k]={'all':stats(number(r,k) for r in frames),'slow_frames':stats(number(r,k) for r in slow)}
    result={'frames':len(frames),'seconds_recorded':(number(frames[-1],'epoch')-number(frames[0],'epoch')) if frames else 0,
            'looks':sorted({r['look'] for r in frames}),'clips':sorted({Path(r['clip']).name for r in frames}),
            'slow_frames_over_33ms':len(slow),'very_slow_frames_over_100ms':sum((number(r,'interval_ms') or 0)>100 for r in frames),
            'timings_ms':timings,'artnet_send_gap_ms':stats(number(r,'send_gap_ms') for r in sends),
            'worst_episodes':sorted(episodes,key=lambda e:e['max_interval_ms'],reverse=True)[:30],
            'system':{k:stats(number(r,k) for r in system) for k in ('cpu_pct','td_cpu_pct','ram_available_mb','td_working_mb','td_private_mb')},
            'notes':['Inclusive nested section timings must not be added together.','A slow interval can originate in the preceding frame or GPU/presentation; compare surrounding callbacks.','A trace cannot establish whether the physical HDMI receiver flashed or repeated a frame.']}
    (folder/'summary.json').write_text(json.dumps(result,indent=2))
    print(json.dumps({k:v for k,v in result.items() if k!='timings_ms'},indent=2))
    return result


if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('folder');report(ap.parse_args().folder)
