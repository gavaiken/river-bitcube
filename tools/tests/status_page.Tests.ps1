# Pester 3 tests for tools/status_page.ps1 (run: Invoke-Pester .\tools\tests)
. (Join-Path $PSScriptRoot '..\status_page.ps1')

Describe 'Resolve-StatusTarget' {
    $url = 'https://gavaiken.github.io/river-bitcube/'
    $local = 'C:\Users\user\River\river-bitcube\docs\index.md'

    It 'opens the live page when it is reachable' {
        Resolve-StatusTarget -Url $url -FallbackPath $local -Probe { param($u) $true } | Should Be $url
    }

    It 'falls back to the local copy as a file URL when the page is unreachable' {
        Resolve-StatusTarget -Url $url -FallbackPath $local -Probe { param($u) $false } |
            Should Be 'file:///C:/Users/user/River/river-bitcube/docs/index.md'
    }

    It 'treats a probe that throws as unreachable' {
        Resolve-StatusTarget -Url $url -FallbackPath $local -Probe { param($u) throw 'no network' } |
            Should Be 'file:///C:/Users/user/River/river-bitcube/docs/index.md'
    }

    It 'passes the URL to the probe' {
        $script:seen = $null
        Resolve-StatusTarget -Url $url -FallbackPath $local -Probe { param($u) $script:seen = $u; $true } | Out-Null
        $script:seen | Should Be $url
    }
}

Describe 'Get-StatusChromeArgs' {
    It 'opens a new maximised window on the target' {
        $a = Get-StatusChromeArgs -Target 'https://example.test/'
        $a -contains '--new-window' | Should Be $true
        $a -contains '--start-maximized' | Should Be $true
        $a[-1] | Should Be 'https://example.test/'
    }
}
