[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')]
    [string]$ProjectId,

    [Parameter(Mandatory = $true)]
    [string]$LocalMountRoot,

    [Parameter(Mandatory = $true)]
    [string]$RelativePath,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-z][a-z0-9-]{0,62}$')]
    [string]$CandidateTag,

    [string]$Region = 'asia-northeast3',
    [string]$ServiceName = 'ctc-latte-rc',
    [string]$BackendRepository = '',
    [ValidatePattern('^https://[A-Za-z0-9.-]+$')]
    [string]$PublicWebOrigin = 'https://fallingenie.github.io',
    [string]$PythonExecutable = 'py',
    [int]$GatewayPort = 8765
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$frontendRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if ([string]::IsNullOrWhiteSpace($BackendRepository)) {
    $BackendRepository = Join-Path $frontendRoot '..\CTC_Latte_main_runtime'
}
$backendRoot = [System.IO.Path]::GetFullPath($BackendRepository)
$mountRoot = [System.IO.Path]::GetFullPath($LocalMountRoot)
$normalizedRelativePath = $RelativePath.Replace('\', '/').Trim('/')
$relativeSegments = @($normalizedRelativePath.Split('/') | Where-Object { $_ })
if ($relativeSegments.Count -eq 0 -or $relativeSegments -contains '..' -or $relativeSegments -contains '.') {
    throw '자료판 상대경로 형식이 올바르지 않습니다.'
}
$localDataRoot = [System.IO.Path]::GetFullPath((Join-Path $mountRoot ($relativeSegments -join [System.IO.Path]::DirectorySeparatorChar)))
$mountPrefix = $mountRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if (-not $localDataRoot.StartsWith($mountPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw '자료판 경로가 로컬 마운트 루트를 벗어났습니다.'
}
if (-not $normalizedRelativePath.EndsWith('.ctwebui', [System.StringComparison]::OrdinalIgnoreCase)) {
    throw '자료판 경로는 .ctwebui 디렉터리여야 합니다.'
}
if (-not (Test-Path -LiteralPath $localDataRoot -PathType Container)) {
    throw '로컬 자료판 디렉터리를 찾을 수 없습니다.'
}
if ($GatewayPort -lt 1 -or $GatewayPort -gt 65535) {
    throw '로컬 게이트웨이 포트 범위가 올바르지 않습니다.'
}

function Resolve-GcloudCommand {
    $command = Get-Command gcloud -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    $candidates = @()
    if ($env:LOCALAPPDATA) {
        $candidates += (Join-Path $env:LOCALAPPDATA 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd')
    }
    if ($env:ProgramFiles) {
        $candidates += (Join-Path $env:ProgramFiles 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd')
    }
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) { return $candidate }
    }
    throw 'Google Cloud CLI가 설치되어 있지 않습니다.'
}

function Invoke-Checked {
    param([string]$Command, [string[]]$Arguments)
    $previousErrorActionPreference = $ErrorActionPreference
    $exitCode = 1
    try {
        $ErrorActionPreference = 'Continue'
        & $Command @Arguments
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    if ($exitCode -ne 0) {
        throw "$Command 명령이 실패했습니다. 종료 코드: $exitCode"
    }
}

function Invoke-Captured {
    param([string]$Command, [string[]]$Arguments)
    $previousErrorActionPreference = $ErrorActionPreference
    $exitCode = 1
    try {
        $ErrorActionPreference = 'Continue'
        $output = & $Command @Arguments
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    if ($exitCode -ne 0) {
        throw "$Command 명령이 실패했습니다. 종료 코드: $exitCode"
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

function Get-RemoteMainCommit {
    param([string]$Repository)
    $line = Invoke-Captured git @('-C', $Repository, 'ls-remote', 'origin', 'refs/heads/main')
    $commit = ($line -split '\s+')[0]
    if ($commit -notmatch '^[0-9a-f]{40}$') {
        throw '원격 Main commit을 확인할 수 없습니다.'
    }
    & git -C $Repository cat-file -e "$commit`^{commit}" 2>$null
    if ($LASTEXITCODE -ne 0) {
        Invoke-Checked git @('-C', $Repository, 'fetch', '--no-tags', 'origin', 'refs/heads/main')
    }
    & git -C $Repository cat-file -e "$commit`^{commit}" 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw '원격 Main commit 객체를 로컬 저장소에서 확인할 수 없습니다.'
    }
    return $commit
}

function ConvertTo-ProcessArgument {
    param([string]$Value)
    if ($Value.Contains('"')) {
        throw '실행 인자에는 큰따옴표를 사용할 수 없습니다.'
    }
    if ($Value -match '\s') {
        return '"' + $Value + '"'
    }
    return $Value
}

$gcloud = Resolve-GcloudCommand
$frontendStatus = Invoke-Captured git @('-C', $frontendRoot, 'status', '--porcelain')
if ($frontendStatus) { throw 'Frontend 저장소에 커밋되지 않은 변경이 있습니다.' }
$frontendCommit = Invoke-Captured git @('-C', $frontendRoot, 'rev-parse', 'HEAD')
$frontendRemoteCommit = Get-RemoteMainCommit -Repository $frontendRoot
if ($frontendCommit -ne $frontendRemoteCommit) {
    throw 'Frontend HEAD가 원격 Main과 일치하지 않습니다.'
}
$backendCommit = Get-RemoteMainCommit -Repository $backendRoot

$evidenceRoot = Join-Path $frontendRoot '.release-evidence'
$stagingBase = Join-Path $frontendRoot '.deploy-staging'
$runId = [guid]::NewGuid().ToString('N')
$stagingRoot = Join-Path $stagingBase "promotion-$runId"
$cleanBackendRoot = Join-Path $stagingRoot 'backend'
$stdoutPath = Join-Path $evidenceRoot "gateway-$runId.stdout.log"
$stderrPath = Join-Path $evidenceRoot "gateway-$runId.stderr.log"
$attestationPath = Join-Path $evidenceRoot "production-data-attestation-$runId.json"
$gatewayProcess = $null
$worktreeCreated = $false
$bootstrapService = $false
$trafficPromoted = $false
$promotionVerified = $false
$previousTrafficAllocation = ''

New-Item -ItemType Directory -Path $evidenceRoot, $stagingRoot -Force | Out-Null
try {
    Invoke-Checked $gcloud @('config', 'set', 'project', $ProjectId, '--quiet')
    Invoke-Checked $gcloud @(
        'services', 'enable', 'run.googleapis.com',
        '--project', $ProjectId, '--quiet'
    )

    $serviceJson = Invoke-Captured $gcloud @(
        'run', 'services', 'describe', $ServiceName,
        '--region', $Region,
        '--project', $ProjectId,
        '--format', 'json'
    ) | ConvertFrom-Json
    $candidate = @($serviceJson.status.traffic | Where-Object { $_.tag -eq $CandidateTag }) | Select-Object -First 1
    if (-not $candidate -or -not $candidate.url -or -not $candidate.revisionName) {
        throw '검증할 무트래픽 리비전 태그를 찾을 수 없습니다.'
    }
    $revisionNames = @(Invoke-Captured $gcloud @(
        'run', 'revisions', 'list',
        '--service', $ServiceName,
        '--region', $Region,
        '--project', $ProjectId,
        '--format=value(metadata.name)'
    ) -split "`r?`n" | Where-Object { $_ })
    $candidateTrafficPercent = 0
    foreach ($trafficTarget in @($serviceJson.status.traffic)) {
        if ([string]$trafficTarget.revisionName -eq [string]$candidate.revisionName `
            -and $null -ne $trafficTarget.percent) {
            $candidateTrafficPercent += [int]$trafficTarget.percent
        }
    }
    $bootstrapService = $candidateTrafficPercent -eq 100 `
        -and $revisionNames.Count -eq 1 `
        -and $revisionNames[0] -eq [string]$candidate.revisionName
    if ($candidateTrafficPercent -gt 0 -and -not $bootstrapService) {
        throw '검증 전 후보 리비전에 이미 운영 트래픽이 연결되어 있습니다.'
    }
    if (-not $bootstrapService) {
        $previousTraffic = @($serviceJson.status.traffic | Where-Object {
            $null -ne $_.percent -and [int]$_.percent -gt 0
        })
        $previousTrafficPercent = 0
        $previousTrafficTargets = foreach ($target in $previousTraffic) {
            $revisionName = [string]$target.revisionName
            $percent = [int]$target.percent
            if ($revisionName -notmatch '^[a-z][a-z0-9-]{0,62}$' -or $percent -lt 1 -or $percent -gt 100) {
                throw '기존 운영 트래픽 구성을 안전하게 보존할 수 없습니다.'
            }
            $previousTrafficPercent += $percent
            "$revisionName=$percent"
        }
        if ($previousTrafficPercent -ne 100 -or $previousTrafficTargets.Count -eq 0) {
            throw '기존 운영 트래픽 합계가 100%가 아닙니다.'
        }
        $previousTrafficAllocation = $previousTrafficTargets -join ','
    }
    $candidateUrl = [string]$candidate.url
    if ($candidateUrl -notmatch '^https://') { throw '후보 리비전 주소가 HTTPS가 아닙니다.' }
    $preflight = Invoke-WebRequest -UseBasicParsing -Method Options `
        -Uri "$candidateUrl/api/climate/query" `
        -Headers @{
            Origin = $PublicWebOrigin
            'Access-Control-Request-Method' = 'POST'
            'Access-Control-Request-Headers' = 'content-type'
        } `
        -TimeoutSec 30
    if ($preflight.StatusCode -ne 204 `
        -or [string]$preflight.Headers['Access-Control-Allow-Origin'] -ne $PublicWebOrigin) {
        throw '후보 API의 GitHub Pages CORS 사전 요청 검증에 실패했습니다.'
    }

    Invoke-Checked git @('-C', $backendRoot, 'worktree', 'add', '--detach', $cleanBackendRoot, $backendCommit)
    $worktreeCreated = $true
    $gatewayScript = Join-Path $cleanBackendRoot 'scripts\serve_webui_data_gateway.py'
    if (-not (Test-Path -LiteralPath $gatewayScript -PathType Leaf)) {
        throw 'Backend 게이트웨이 스크립트를 찾을 수 없습니다.'
    }

    $env:CLIMATE_CMIP6_LOCAL_ZARR_ROOT = $null
    $env:CTC_BACKEND_ROOT = $cleanBackendRoot
    $env:CTC_GATEWAY_HOST = '127.0.0.1'
    $env:CTC_GATEWAY_PORT = [string]$GatewayPort
    $env:CTC_PREPARED_DATA_MOUNT_ROOT = $mountRoot
    $env:CTC_PREPARED_DATA_PROVIDER = 'gcs'
    $env:CTC_PYTHON_EXECUTABLE = $PythonExecutable
    $env:CTC_WEB_DATA_ROOT = $localDataRoot
    $env:CTC_WEBUI_CMIP6_ZARR_ROOT = 'gs://cmip6'
    $env:CTC_WEBUI_RAW_CMIP6_INDEX_CACHE = '0'
    $env:CTC_WEBUI_RAW_CMIP6_QUERY_CACHE = '0'
    $env:CTC_WEBUI_RAW_CMIP6_MAX_CONCURRENT_WORKERS = '1'
    $env:CTC_WEBUI_RAW_CMIP6_QUERY_WORKER = '1'

    $gatewayArguments = @(
        $gatewayScript,
        '--root', $localDataRoot,
        '--host', '127.0.0.1',
        '--port', [string]$GatewayPort,
        '--raw-cmip6-root', 'gs://cmip6'
    )
    $gatewayArgumentText = ($gatewayArguments | ForEach-Object { ConvertTo-ProcessArgument ([string]$_) }) -join ' '
    $gatewayProcess = Start-Process -FilePath $PythonExecutable `
        -ArgumentList $gatewayArgumentText `
        -WorkingDirectory $cleanBackendRoot `
        -RedirectStandardOutput $stdoutPath `
        -RedirectStandardError $stderrPath `
        -WindowStyle Hidden `
        -PassThru

    $healthUrl = "http://127.0.0.1:$GatewayPort/api/climate/health"
    $ready = $false
    $deadline = [DateTime]::UtcNow.AddMinutes(2)
    while ([DateTime]::UtcNow -lt $deadline -and -not $gatewayProcess.HasExited) {
        try {
            $health = Invoke-RestMethod -Uri $healthUrl -Method Get -TimeoutSec 2
            if ($health.ok -eq $true -and $health.publicSafe -eq $true) {
                $ready = $true
                break
            }
        } catch {
            Start-Sleep -Milliseconds 250
        }
    }
    if (-not $ready) { throw '로컬 검증 게이트웨이가 준비되지 않았습니다.' }

    $env:CTC_DEPLOYMENT_BASE_URL = $candidateUrl
    $env:CTC_GATEWAY_LOCAL_BASE_URL = "http://127.0.0.1:$GatewayPort"
    $env:CTC_PRODUCTION_ATTESTATION_OUTPUT = $attestationPath
    $env:CTC_PRODUCTION_DATA_ATTESTATION = $attestationPath
    $env:CTC_PRODUCTION_ATTESTATION_STRICT_GIT = '1'
    $env:CTC_PRODUCTION_AUTHORIZATION_TOKEN_FILE = $null
    Invoke-Checked node @((Join-Path $frontendRoot 'scripts\create-production-data-attestation.mjs'))
    Invoke-Checked node @(
        (Join-Path $frontendRoot 'scripts\verify-production-data-policy.mjs'),
        '--require-attestation'
    )

    if (-not $bootstrapService) {
        Invoke-Checked $gcloud @(
            'run', 'services', 'update-traffic', $ServiceName,
            '--to-revisions', "$($candidate.revisionName)=100",
            '--region', $Region,
            '--project', $ProjectId,
            '--quiet'
        )
        $trafficPromoted = $true
    }

    $serviceUrl = Invoke-Captured $gcloud @(
        'run', 'services', 'describe', $ServiceName,
        '--region', $Region,
        '--project', $ProjectId,
        '--format=value(status.url)'
    )
    if ($serviceUrl -notmatch '^https://') {
        throw '승격한 공개 API 주소를 확인할 수 없습니다.'
    }
    $attestation = Get-Content -LiteralPath $attestationPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $metadata = Invoke-RestMethod -Uri "$serviceUrl/api/climate/metadata" -Method Get -TimeoutSec 30
    if ($metadata.publicSafe -ne $true -or [string]$metadata.datasetVersion -ne [string]$attestation.datasetVersion) {
        throw '승격한 공개 API의 자료판이 검증한 후보와 일치하지 않습니다.'
    }
    $promotionVerified = $true

    [pscustomobject]@{
        Attestation = $attestationPath
        BackendCommit = $backendCommit
        Bootstrap = $bootstrapService
        CandidateUrl = $candidateUrl
        FrontendCommit = $frontendCommit
        Promoted = $true
        PublicApiOrigin = $serviceUrl
        Revision = $candidate.revisionName
        Service = $ServiceName
    } | ConvertTo-Json
}
finally {
    if (-not $promotionVerified -and $bootstrapService) {
        if (-not (Test-ExternalSuccess $gcloud @(
            'run', 'services', 'delete', $ServiceName,
            '--region', $Region,
            '--project', $ProjectId,
            '--quiet'
        ))) {
            Write-Warning '검증에 실패한 최초 Cloud Run 서비스를 자동 회수하지 못했습니다.'
        }
    }
    elseif (-not $promotionVerified -and $trafficPromoted -and $previousTrafficAllocation) {
        if (-not (Test-ExternalSuccess $gcloud @(
            'run', 'services', 'update-traffic', $ServiceName,
            '--to-revisions', $previousTrafficAllocation,
            '--region', $Region,
            '--project', $ProjectId,
            '--quiet'
        ))) {
            Write-Warning '검증에 실패한 Cloud Run 트래픽을 이전 리비전으로 복구하지 못했습니다.'
        }
    }
    if ($gatewayProcess -and -not $gatewayProcess.HasExited) {
        Stop-Process -Id $gatewayProcess.Id -Force -ErrorAction SilentlyContinue
        $gatewayProcess.WaitForExit(5000) | Out-Null
    }
    if ($worktreeCreated) {
        if (-not (Test-ExternalSuccess git @('-C', $backendRoot, 'worktree', 'remove', '--force', $cleanBackendRoot))) {
            Write-Warning '검증용 Backend worktree를 자동 회수하지 못했습니다.'
        }
    }
    $resolvedStaging = [System.IO.Path]::GetFullPath($stagingRoot)
    $stagingPrefix = [System.IO.Path]::GetFullPath($stagingBase).TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
    if ($resolvedStaging.StartsWith($stagingPrefix, [System.StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedStaging)) {
        Remove-Item -LiteralPath $resolvedStaging -Recurse -Force
    }
}
