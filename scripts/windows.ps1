param(
    [ValidateSet('dev', 'web', 'check', 'build')]
    [string]$Mode = 'dev'
)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

# Refresh paths so a terminal opened before installation also works.
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'User') + ';' +
    [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + $env:Path

if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    throw 'Node.js 24 LTS and npm must be installed first.'
}
if ($Mode -in @('dev', 'build') -and -not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    throw 'Install Rust with the x86_64-pc-windows-msvc toolchain first.'
}
if (-not (Test-Path 'node_modules')) {
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

switch ($Mode) {
    'dev' { & npm.cmd run tauri -- dev }
    'web' { & npm.cmd run dev }
    'build' { & npm.cmd run tauri -- build --bundles nsis }
    'check' {
        foreach ($task in @('build', 'lint', 'test')) {
            & npm.cmd run $task
            if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        }
    }
}
exit $LASTEXITCODE
