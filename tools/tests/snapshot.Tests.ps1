# Pester 3 tests for tools/snapshot.ps1 (run: Invoke-Pester .\tools\tests)
. (Join-Path $PSScriptRoot '..\snapshot.ps1')

Describe 'Test-SnapshotWindow' {
    It 'is on from 08:00' { Test-SnapshotWindow ([datetime]'2026-10-18 08:00') | Should Be $true }
    It 'is on in the evening' { Test-SnapshotWindow ([datetime]'2026-10-18 23:45') | Should Be $true }
    It 'is on just after midnight' { Test-SnapshotWindow ([datetime]'2026-10-19 01:45') | Should Be $true }
    It 'is off from 02:00' { Test-SnapshotWindow ([datetime]'2026-10-19 02:00') | Should Be $false }
    It 'is off just before 08:00' { Test-SnapshotWindow ([datetime]'2026-10-19 07:59') | Should Be $false }
}

Describe 'Get-SnapshotFfmpegArgs' {
    $a = Get-SnapshotFfmpegArgs -Url 'rtsp://cam/x' -Out 'C:\t\g.jpg' -Width 640

    It 'reads over TCP from the camera URL' {
        $a[$a.IndexOf('-rtsp_transport') + 1] | Should Be 'tcp'
        $a[$a.IndexOf('-i') + 1] | Should Be 'rtsp://cam/x'
    }
    It 'takes one frame' { $a[$a.IndexOf('-frames:v') + 1] | Should Be '1' }
    It 'scales to the width with an even height' { $a[$a.IndexOf('-vf') + 1] | Should Be 'scale=640:-2' }
    It 'overwrites the output, given last' {
        $a -contains '-y' | Should Be $true
        $a[-1] | Should Be 'C:\t\g.jpg'
    }
}

Describe 'Get-SnapshotCacheInfo' {
    It 'puts the blob at gallery.jpg as a plain file' {
        Get-SnapshotCacheInfo 'abc123' | Should Be '100644,abc123,gallery.jpg'
    }
}

Describe 'Get-SnapshotCacheInfo for a minute still' {
    It 'can name a path in m/' { Get-SnapshotCacheInfo 'abc' 'm/20261020-1741.jpg' | Should Be '100644,abc,m/20261020-1741.jpg' }
}

Describe 'Get-MinuteName' {
    It 'names the UTC minute, as docs/assets/snapshot.js does' {
        Get-MinuteName ([datetime]'2026-10-20 17:41:59') | Should Be 'm/20261020-1741.jpg'
    }
}

Describe 'Select-KeptMinutes' {
    It 'keeps the newest' {
        $k = Select-KeptMinutes @('m/20261020-1740.jpg', 'm/20261020-1742.jpg', 'm/20261020-1741.jpg') 2
        ($k -join ',') | Should Be 'm/20261020-1742.jpg,m/20261020-1741.jpg'
    }
}

Describe 'Get-SnapshotMessage' {
    It 'names the time to the minute' {
        Get-SnapshotMessage ([datetime]'2026-10-18 16:45:12') | Should Be 'Gallery snapshot 2026-10-18 16:45'
    }
}

Describe 'Hide-Secrets' {
    It 'masks the login in an RTSP URL' {
        Hide-Secrets 'failed: rtsp://admin:pw@10.0.7.76:554/x: timeout' |
            Should Be 'failed: rtsp://***@10.0.7.76:554/x: timeout'
    }
    It 'leaves text without a login alone' { Hide-Secrets 'pushed 51234 bytes' | Should Be 'pushed 51234 bytes' }
}

Describe 'Get-TdMinuteName' {
    It 'names the UTC minute under t/ as a PNG, as docs/assets/snapshot.js does' {
        Get-TdMinuteName ([datetime]'2026-10-23 20:51:30') | Should Be 't/20261023-2051.png'
    }
}
