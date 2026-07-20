[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$LocalMountRoot,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$')]
    [string]$ReleaseId,

    [Parameter(Mandatory = $true)]
    [string]$RelativePath,

    [Parameter(Mandatory = $true)]
    [string]$ProjectId,

    [Parameter(Mandatory = $true)]
    [string]$BucketName,

    [string]$BucketPrefix = 'ctc_latte'
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

function Resolve-GcloudCommand {
    $resolved = Get-Command -Name 'gcloud' -ErrorAction SilentlyContinue
    if ($null -ne $resolved) {
        $pathProperty = $resolved.PSObject.Properties['Path']
        if ($null -ne $pathProperty -and $pathProperty.Value) {
            return [string]$pathProperty.Value
        }
        $sourceProperty = $resolved.PSObject.Properties['Source']
        if ($null -ne $sourceProperty -and $sourceProperty.Value) {
            return [string]$sourceProperty.Value
        }
    }

    $candidates = @()
    if ($env:LOCALAPPDATA) {
        $candidates += (Join-Path $env:LOCALAPPDATA 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd')
    }
    if ($env:ProgramFiles) {
        $candidates += (Join-Path $env:ProgramFiles 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd')
    }
    if (${env:ProgramFiles(x86)}) {
        $candidates += (Join-Path ${env:ProgramFiles(x86)} 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd')
    }
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return [System.IO.Path]::GetFullPath($candidate)
        }
    }
    throw 'Google Cloud CLI를 찾을 수 없습니다. PATH 또는 기본 설치 경로를 확인하세요.'
}

function Normalize-ObjectPath {
    param([string]$Value, [string]$Label)
    $normalized = $Value.Replace('\', '/').Trim('/')
    if (-not $normalized -or $normalized -match '[\x00-\x1f\x7f]') {
        throw "$Label 형식이 올바르지 않습니다."
    }
    foreach ($segment in $normalized.Split('/')) {
        if (-not $segment -or $segment -eq '.' -or $segment -eq '..') {
            throw "$Label 형식이 올바르지 않습니다."
        }
    }
    return $normalized
}

function Assert-PathWithinRoot {
    param([string]$Root, [string]$Candidate)
    $rootPrefix = $Root.TrimEnd([char[]]@('\', '/')) + [System.IO.Path]::DirectorySeparatorChar
    if (-not $Candidate.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw '자료 경로가 로컬 마운트 루트를 벗어났습니다.'
    }
}

function Test-FilesExactlyEqual {
    param([string]$ExpectedPath, [string]$ActualPath)
    $expectedHash = (Get-FileHash -LiteralPath $ExpectedPath -Algorithm SHA256).Hash
    $actualHash = (Get-FileHash -LiteralPath $ActualPath -Algorithm SHA256).Hash
    return $expectedHash -eq $actualHash
}

function Copy-RemoteObjectForComparison {
    param(
        [string]$Gcloud,
        [string]$RemoteObject,
        [string]$Destination,
        [string]$Project
    )
    Invoke-Checked $Gcloud @(
        'storage', 'cp', $RemoteObject, $Destination,
        '--project', $Project,
        '--quiet'
    )
}

function Assert-RsyncDryRunClean {
    param([object[]]$Output, [string]$FailureMessage)
    $differenceLines = @($Output | Where-Object {
        [string]$_ -match '(?i)would\s+(copy|delete|remove)|copying|deleting|removing'
    })
    if ($differenceLines.Count -gt 0) {
        throw "$FailureMessage 차이 작업 수: $($differenceLines.Count)"
    }
}

$frontendRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$mountRoot = [System.IO.Path]::GetFullPath($LocalMountRoot)
$normalizedRelativePath = Normalize-ObjectPath -Value $RelativePath -Label 'RelativePath'
$normalizedBucketPrefix = Normalize-ObjectPath -Value $BucketPrefix -Label 'BucketPrefix'
$bucketPrefixPattern = '^[A-Za-z0-9][A-Za-z0-9._/-]{0,511}$'
if ($normalizedBucketPrefix -notmatch $bucketPrefixPattern) {
    throw 'BucketPrefix에는 영문자, 숫자, 점, 밑줄, 하이픈, 슬래시만 사용할 수 있습니다.'
}
$localRelativePath = $normalizedRelativePath.Replace('/', [System.IO.Path]::DirectorySeparatorChar)
$localDataRoot = [System.IO.Path]::GetFullPath((Join-Path $mountRoot $localRelativePath))
Assert-PathWithinRoot -Root $mountRoot -Candidate $localDataRoot
if (-not $normalizedRelativePath.EndsWith('.ctwebui', [System.StringComparison]::OrdinalIgnoreCase)) {
    throw '자료 경로는 .ctwebui 디렉터리여야 합니다.'
}
if (-not (Test-Path -LiteralPath $localDataRoot -PathType Container)) {
    throw '로컬 .ctwebui 디렉터리를 찾을 수 없습니다.'
}
$gcloud = Resolve-GcloudCommand

$sourceRemoteRoot = "gs://$BucketName/$normalizedBucketPrefix/$normalizedRelativePath"
$comparisonOutput = & $gcloud storage rsync $localDataRoot $sourceRemoteRoot --recursive --checksums-only --dry-run --delete-unmatched-destination-objects --project $ProjectId 2>&1
if ($LASTEXITCODE -ne 0) {
    throw 'GCS 자료와 로컬 정본의 비교가 실패했습니다.'
}
Assert-RsyncDryRunClean -Output $comparisonOutput -FailureMessage 'GCS 업로드가 로컬 정본과 일치하지 않습니다.'

$evidenceRoot = Join-Path $frontendRoot '.release-evidence'
New-Item -ItemType Directory -Path $evidenceRoot -Force | Out-Null
$identityPointerPath = Join-Path $evidenceRoot "identity-$ReleaseId-$([guid]::NewGuid().ToString('N')).json"
$temporaryPointerPath = Join-Path $evidenceRoot "pointer-$ReleaseId-$([guid]::NewGuid().ToString('N')).json"
$remoteComparisonPath = Join-Path $evidenceRoot "remote-$([guid]::NewGuid().ToString('N')).json"
try {
    & node (Join-Path $frontendRoot 'scripts\create-release-pointer.mjs') `
        --mount-root $mountRoot `
        --relative-path $normalizedRelativePath `
        --release-id $ReleaseId `
        --output $identityPointerPath
    if ($LASTEXITCODE -ne 0) {
        throw '자료 포인터 생성이 실패했습니다.'
    }

    try {
        $pointer = Get-Content -LiteralPath $identityPointerPath -Raw -Encoding UTF8 | ConvertFrom-Json
    }
    catch {
        throw '생성한 자료 포인터를 JSON으로 해석할 수 없습니다.'
    }
    $datasetVersion = [string]$pointer.datasetVersion
    if ($datasetVersion -notmatch '^[0-9a-f]{64}$') {
        throw '자료 포인터의 datasetVersion이 올바르지 않습니다.'
    }

    $snapshotRelativePath = "release-candidate/datasets/$datasetVersion.ctwebui"
    $snapshotUrl = "gs://$BucketName/$normalizedBucketPrefix/$snapshotRelativePath"
    $pointerObject = "$normalizedBucketPrefix/release-candidate/releases/$datasetVersion.json"
    $pointerUrl = "gs://$BucketName/$pointerObject"
    $pointerAlreadyPublished = Test-ExternalSuccess $gcloud @(
        'storage', 'objects', 'describe', $pointerUrl,
        '--project', $ProjectId,
        '--format=value(generation)'
    )
    if (-not $pointerAlreadyPublished) {
        Invoke-Checked $gcloud @(
            'storage', 'rsync', $sourceRemoteRoot, $snapshotUrl,
            '--recursive',
            '--checksums-only',
            '--delete-unmatched-destination-objects',
            '--project', $ProjectId
        )
    }
    $snapshotComparisonOutput = & $gcloud storage rsync $localDataRoot $snapshotUrl --recursive --checksums-only --dry-run --delete-unmatched-destination-objects --project $ProjectId 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw '불변 GCS 자료판과 로컬 정본의 비교가 실패했습니다.'
    }
    Assert-RsyncDryRunClean -Output $snapshotComparisonOutput -FailureMessage '불변 GCS 자료판이 로컬 정본과 일치하지 않습니다.'

    & node (Join-Path $frontendRoot 'scripts\create-release-pointer.mjs') `
        --mount-root $mountRoot `
        --relative-path $normalizedRelativePath `
        --pointer-relative-path $snapshotRelativePath `
        --release-id $ReleaseId `
        --output $temporaryPointerPath
    if ($LASTEXITCODE -ne 0) {
        throw '불변 자료판 포인터 생성이 실패했습니다.'
    }

    $immutableCreated = $false
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $immutableUploadOutput = & $gcloud storage cp $temporaryPointerPath $pointerUrl `
            --if-generation-match=0 `
            --cache-control 'public,max-age=31536000,immutable' `
            --content-type 'application/json' `
            --project $ProjectId `
            --quiet 2>&1
        $immutableUploadExitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    if ($immutableUploadExitCode -eq 0) {
        $immutableCreated = $true
    }
    else {
        if (-not (Test-ExternalSuccess $gcloud @(
            'storage', 'objects', 'describe', $pointerUrl,
            '--project', $ProjectId,
            '--format=value(generation)'
        ))) {
            $details = ($immutableUploadOutput | Out-String).Trim()
            throw "불변 자료 포인터를 생성하지 못했습니다. $details"
        }
        Copy-RemoteObjectForComparison -Gcloud $gcloud -RemoteObject $pointerUrl -Destination $remoteComparisonPath -Project $ProjectId
        if (-not (Test-FilesExactlyEqual -ExpectedPath $temporaryPointerPath -ActualPath $remoteComparisonPath)) {
            throw '같은 datasetVersion의 불변 포인터가 이미 존재하지만 내용이 정확히 일치하지 않습니다.'
        }
        Remove-Item -LiteralPath $remoteComparisonPath -Force
    }

    $currentAliasObject = "$normalizedBucketPrefix/release-candidate/current.json"
    $currentAliasUrl = "gs://$BucketName/$currentAliasObject"
    $currentAliasUpdated = $false
    if (Test-ExternalSuccess $gcloud @(
        'storage', 'objects', 'describe', $currentAliasUrl,
        '--project', $ProjectId,
        '--format=value(generation)'
    )) {
        $currentGeneration = Invoke-Captured $gcloud @(
            'storage', 'objects', 'describe', $currentAliasUrl,
            '--project', $ProjectId,
            '--format=value(generation)'
        )
        if ($currentGeneration -notmatch '^\d+$') {
            throw 'current.json의 세대 번호를 확인할 수 없습니다.'
        }
        Copy-RemoteObjectForComparison -Gcloud $gcloud -RemoteObject $currentAliasUrl -Destination $remoteComparisonPath -Project $ProjectId
        $aliasAlreadyCurrent = Test-FilesExactlyEqual -ExpectedPath $temporaryPointerPath -ActualPath $remoteComparisonPath
        Remove-Item -LiteralPath $remoteComparisonPath -Force
        if (-not $aliasAlreadyCurrent) {
            Invoke-Checked $gcloud @(
                'storage', 'cp', $temporaryPointerPath, $currentAliasUrl,
                "--if-generation-match=$currentGeneration",
                '--cache-control', 'no-store',
                '--content-type', 'application/json',
                '--project', $ProjectId,
                '--quiet'
            )
            $currentAliasUpdated = $true
        }
    }
    else {
        Invoke-Checked $gcloud @(
            'storage', 'cp', $temporaryPointerPath, $currentAliasUrl,
            '--if-generation-match=0',
            '--cache-control', 'no-store',
            '--content-type', 'application/json',
            '--project', $ProjectId,
            '--quiet'
        )
        $currentAliasUpdated = $true
    }

    [pscustomobject]@{
        CurrentAliasObject = $currentAliasObject
        CurrentAliasUpdated = $currentAliasUpdated
        DatasetVersion = $datasetVersion
        ImmutablePointerCreated = $immutableCreated
        PointerObject = $pointerObject
        ReleaseId = $ReleaseId
        SnapshotObject = "$normalizedBucketPrefix/$snapshotRelativePath"
        SourceObject = "$normalizedBucketPrefix/$normalizedRelativePath"
        Verified = $true
    } | ConvertTo-Json
}
finally {
    foreach ($temporaryPath in @($identityPointerPath, $temporaryPointerPath, $remoteComparisonPath)) {
        if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) {
            Remove-Item -LiteralPath $temporaryPath -Force
        }
    }
}
