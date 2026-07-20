[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^https://[A-Za-z0-9.-]+\.run\.app$')]
    [string]$PublicApiOrigin,

    [ValidatePattern('^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$')]
    [string]$Repository = 'fallingenie/CTC_Latte_WebUI',

    [int]$RunDiscoveryTimeoutSeconds = 120,
    [int]$PagesReadinessTimeoutSeconds = 300
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-Checked {
    param([string]$Command, [string[]]$Arguments)
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Command 명령이 실패했습니다. 종료 코드: $LASTEXITCODE"
    }
}

function Invoke-Captured {
    param([string]$Command, [string[]]$Arguments)
    $output = & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Command 명령이 실패했습니다. 종료 코드: $LASTEXITCODE"
    }
    return ($output | Out-String).Trim()
}

function Test-ExternalSuccess {
    param([string]$Command, [string[]]$Arguments)
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & $Command @Arguments *> $null
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    return $exitCode -eq 0
}

function Assert-ExactRemoteMain {
    param([string]$Root)
    $status = Invoke-Captured git @('-C', $Root, 'status', '--porcelain')
    if ($status) {
        throw 'Frontend 저장소에 커밋되지 않은 변경이 있습니다.'
    }
    $head = Invoke-Captured git @('-C', $Root, 'rev-parse', 'HEAD')
    $remoteLine = Invoke-Captured git @('-C', $Root, 'ls-remote', 'origin', 'refs/heads/main')
    $remote = ($remoteLine -split '\s+')[0]
    if ($head -notmatch '^[0-9a-f]{40}$' -or $head -ne $remote) {
        throw 'Frontend HEAD가 원격 Main과 일치하지 않습니다.'
    }
    return $head
}

function Wait-WorkflowRun {
    param(
        [string]$Gh,
        [string]$RepositoryName,
        [string]$WorkflowName,
        [string]$HeadSha,
        [int]$TimeoutSeconds
    )
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        $json = Invoke-Captured $Gh @(
            'run', 'list',
            '--repo', $RepositoryName,
            '--workflow', $WorkflowName,
            '--event', 'workflow_dispatch',
            '--branch', 'main',
            '--limit', '10',
            '--json', 'databaseId,headSha,status,conclusion,url,createdAt'
        )
        try {
            $runs = @($json | ConvertFrom-Json)
        }
        catch {
            throw 'GitHub Pages 작업 목록을 JSON으로 해석할 수 없습니다.'
        }
        $run = @($runs | Where-Object { $_.headSha -eq $HeadSha } | Sort-Object createdAt -Descending) | Select-Object -First 1
        if ($run) { return $run }
        Start-Sleep -Seconds 2
    }
    throw 'GitHub Pages 작업 식별자를 제한시간 안에 찾지 못했습니다.'
}

function Wait-PagesReady {
    param([string]$PagesUrl, [string]$ExpectedApiOrigin, [int]$TimeoutSeconds)
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    $runtimeUrl = ([uri]::new([uri]$PagesUrl, 'runtime-config.json')).AbsoluteUri
    while ([DateTime]::UtcNow -lt $deadline) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $runtimeUrl -Headers @{ 'Cache-Control' = 'no-cache' } -TimeoutSec 20
            if ($response.StatusCode -eq 200) {
                $runtime = $response.Content | ConvertFrom-Json
                $readOrigin = ([uri]$runtime.readPath).GetLeftPart([System.UriPartial]::Authority)
                if ($runtime.sourcePolicy -eq 'cloud-only' -and $readOrigin -eq $ExpectedApiOrigin) {
                    return $runtimeUrl
                }
            }
        }
        catch {
            Start-Sleep -Seconds 5
            continue
        }
        Start-Sleep -Seconds 5
    }
    throw 'GitHub Pages 연결 설정이 제한시간 안에 준비되지 않았습니다.'
}

$frontendRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$ghCommand = Get-Command gh -ErrorAction SilentlyContinue
if (-not $ghCommand) {
    throw 'GitHub CLI를 찾을 수 없습니다.'
}
$gh = [string]$ghCommand.Source
$apiUri = [uri]$PublicApiOrigin
if ($apiUri.AbsolutePath -ne '/' -or $apiUri.Query -or $apiUri.Fragment -or $apiUri.Port -ne 443) {
    throw 'PublicApiOrigin은 경로가 없는 Cloud Run HTTPS 출처여야 합니다.'
}
if ($RunDiscoveryTimeoutSeconds -lt 30 -or $RunDiscoveryTimeoutSeconds -gt 600) {
    throw '작업 검색 제한시간 범위가 올바르지 않습니다.'
}
if ($PagesReadinessTimeoutSeconds -lt 60 -or $PagesReadinessTimeoutSeconds -gt 900) {
    throw 'Pages 준비 제한시간 범위가 올바르지 않습니다.'
}

$headSha = Assert-ExactRemoteMain -Root $frontendRoot
Invoke-Checked $gh @('auth', 'status')
$remoteRepository = Invoke-Captured $gh @('repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner')
if ($remoteRepository -ne $Repository) {
    throw "현재 원격 저장소가 배포 대상과 다릅니다: $remoteRepository"
}

Invoke-Checked $gh @(
    'variable', 'set', 'CTC_PUBLIC_API_ORIGIN',
    '--body', $PublicApiOrigin,
    '--repo', $Repository
)
Invoke-Checked $gh @(
    'repo', 'edit', $Repository,
    '--visibility', 'public',
    '--accept-visibility-change-consequences'
)
$visibility = Invoke-Captured $gh @('repo', 'view', $Repository, '--json', 'visibility', '--jq', '.visibility')
if ($visibility -ne 'PUBLIC') {
    throw 'GitHub 저장소가 Public으로 전환되지 않았습니다.'
}

$pagesEndpoint = "repos/$Repository/pages"
if (Test-ExternalSuccess $gh @('api', $pagesEndpoint)) {
    Invoke-Checked $gh @(
        'api', '--method', 'PUT', $pagesEndpoint,
        '-f', 'build_type=workflow',
        '-F', 'https_enforced=true'
    )
}
else {
    Invoke-Checked $gh @(
        'api', '--method', 'POST', $pagesEndpoint,
        '-f', 'build_type=workflow'
    )
}

Invoke-Checked $gh @('workflow', 'run', 'pages.yml', '--ref', 'main', '--repo', $Repository)
$run = Wait-WorkflowRun `
    -Gh $gh `
    -RepositoryName $Repository `
    -WorkflowName 'pages.yml' `
    -HeadSha $headSha `
    -TimeoutSeconds $RunDiscoveryTimeoutSeconds
Invoke-Checked $gh @('run', 'watch', [string]$run.databaseId, '--repo', $Repository, '--exit-status')

$pages = Invoke-Captured $gh @('api', $pagesEndpoint) | ConvertFrom-Json
if (-not $pages.html_url -or [string]$pages.build_type -ne 'workflow') {
    throw 'GitHub Pages 공개 주소 또는 배포 방식을 확인할 수 없습니다.'
}
$runtimeUrl = Wait-PagesReady `
    -PagesUrl ([string]$pages.html_url) `
    -ExpectedApiOrigin $PublicApiOrigin `
    -TimeoutSeconds $PagesReadinessTimeoutSeconds

[pscustomobject]@{
    ApiOrigin = $PublicApiOrigin
    FrontendCommit = $headSha
    PagesUrl = [string]$pages.html_url
    Repository = $Repository
    RepositoryVisibility = $visibility
    RuntimeConfigUrl = $runtimeUrl
    Verified = $true
    WorkflowRun = [string]$run.url
} | ConvertTo-Json
