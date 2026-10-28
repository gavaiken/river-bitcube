"""Read-only 1 Hz Windows CPU/memory + show-state sampler; standard library only."""
import csv
import ctypes as C
from ctypes import wintypes as W
import json
import os
from pathlib import Path
import sys
import time


def read_json(p):
    try:
        return json.loads(p.read_text(encoding='utf-8-sig'))
    except (OSError, ValueError):
        return {}


def sample_windows(pid, seconds, out):
    kernel=C.WinDLL('kernel32',use_last_error=True);psapi=C.WinDLL('psapi',use_last_error=True)
    class Mem(C.Structure):
        _fields_=[('length',W.DWORD),('load',W.DWORD)]+[(n,C.c_ulonglong) for n in ('total','available','page_total','page_available','virt_total','virt_available','extended')]
    class Counters(C.Structure):
        _fields_=[('cb',W.DWORD),('faults',W.DWORD)]+[(n,C.c_size_t) for n in ('peak_working','working','peak_paged','paged','peak_nonpaged','nonpaged','pagefile','peak_pagefile','private')]
    kernel.OpenProcess.argtypes=[W.DWORD,W.BOOL,W.DWORD];kernel.OpenProcess.restype=W.HANDLE
    kernel.GetSystemTimes.argtypes=[C.POINTER(W.FILETIME)]*3
    kernel.GetProcessTimes.argtypes=[W.HANDLE]+[C.POINTER(W.FILETIME)]*4
    psapi.GetProcessMemoryInfo.argtypes=[W.HANDLE,C.c_void_p,W.DWORD]
    kernel.CloseHandle.argtypes=[W.HANDLE]
    handle=kernel.OpenProcess(0x0410,False,pid)
    if not handle:
        raise OSError('Cannot open TD process for read-only counters')
    def ticks(f):return (f.dwHighDateTime<<32)+f.dwLowDateTime
    def cpu():
        idle,k,u=W.FILETIME(),W.FILETIME(),W.FILETIME()
        if not kernel.GetSystemTimes(C.byref(idle),C.byref(k),C.byref(u)):raise OSError('GetSystemTimes failed')
        create,exit,pk,pu=W.FILETIME(),W.FILETIME(),W.FILETIME(),W.FILETIME()
        if not kernel.GetProcessTimes(handle,C.byref(create),C.byref(exit),C.byref(pk),C.byref(pu)):raise OSError('TD process ended')
        return ticks(idle),ticks(k)+ticks(u),ticks(pk)+ticks(pu)
    out=Path(out);root=Path('C:/Users/user/River')
    fields=('epoch','cpu_pct','td_cpu_pct','ram_available_mb','ram_total_mb','td_working_mb','td_private_mb','commit_used_pct','look','position','loop','phase','loop_t_s','fps','reported_frame_ms','reported_python_ms')
    before=cpu();start=time.monotonic();count=0
    try:
        with (out/'system.csv').open('w',newline='') as f:
            w=csv.DictWriter(f,fieldnames=fields);w.writeheader()
            while time.monotonic()-start<seconds:
                time.sleep(max(0,start+count+1-time.monotonic()));count+=1
                current=cpu();idle,total,proc=[a-b for a,b in zip(current,before)];before=current
                mem=Mem();mem.length=C.sizeof(mem)
                if not kernel.GlobalMemoryStatusEx(C.byref(mem)):raise OSError('Memory counter failed')
                pc=Counters();pc.cb=C.sizeof(pc)
                if not psapi.GetProcessMemoryInfo(handle,C.byref(pc),pc.cb):raise OSError('Process memory failed')
                looks=read_json(root/'looks/status.json');state=read_json(root/'remembered/status.json');loop=state.get('loop') or {};perf=looks.get('perf') or {}
                w.writerow(dict(epoch=time.time(),cpu_pct=100*(1-idle/max(1,total)),td_cpu_pct=100*proc/max(1,total),
                    ram_available_mb=mem.available/2**20,ram_total_mb=mem.total/2**20,td_working_mb=pc.working/2**20,td_private_mb=pc.private/2**20,
                    commit_used_pct=100*(1-mem.page_available/max(1,mem.page_total)),look=looks.get('look'),position=looks.get('position'),
                    loop=loop.get('index'),phase=state.get('phase'),loop_t_s=loop.get('t_s'),fps=state.get('fps'),reported_frame_ms=perf.get('frame_ms'),reported_python_ms=perf.get('python_ms')))
                f.flush()
    finally:
        kernel.CloseHandle(handle)
    (out/'system-complete.json').write_text(json.dumps({'end_epoch':time.time(),'samples':count}))


if __name__=='__main__':
    sample_windows(int(sys.argv[1]),float(sys.argv[2]),sys.argv[3])
