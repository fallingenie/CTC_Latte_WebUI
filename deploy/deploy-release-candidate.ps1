[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')]
    [string]$ProjectId,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$')]
    [string]$BucketName,

    [Parameter(Mandatory = $true)]
    [string]$ReleasePointerObject,

    [string]$BucketPrefix = 'ctc_latte',
    [string]$Region = 'asia-northeast3',
    [string]$ServiceName = 'ctc-latte-rc',
    [string]$ArtifactRepository = 'ctc-latte',
    [string]$BackendRepository,
    [ValidatePattern('^https://[A-Za-z0-9.-]+$')]
    [string]$PublicWebOrigin = 'https://fallingenie.github.io'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

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

function Get-RemoteMainCommit {
    param([string]$Repository, [string]$Label)
    $remoteOutput = Invoke-Captured git @(
        '-C', $Repository,
        'ls-remote', '--heads', 'origin', 'refs/heads/main'
    )
    $match = [regex]::Match($remoteOutput, '(?m)^([0-9a-f]{40})\s+refs/heads/main$')
    if (-not $match.Success) {
        throw "$Label 원격 main SHA를 확인할 수 없습니다."
    }
    $remoteCommit = $match.Groups[1].Value
    $commitObject = '{0}^{{commit}}' -f $remoteCommit
    if (-not (Test-ExternalSuccess git @('-C', $Repository, 'cat-file', '-e', $commitObject))) {
        Invoke-Checked git @('-C', $Repository, 'fetch', '--no-tags', 'origin', 'refs/heads/main')
    }
    if (-not (Test-ExternalSuccess git @('-C', $Repository, 'cat-file', '-e', $commitObject))) {
        throw "$Label 원격 main commit 객체를 로컬에서 확인할 수 없습니다."
    }
    return $remoteCommit
}

function Assert-FrontendRemoteMain {
    param([string]$Repository)
    $status = Invoke-Captured git @('-C', $Repository, 'status', '--porcelain')
    if ($status) {
        throw 'Frontend 저장소에 커밋되지 않은 변경이 있습니다. 배포를 중단합니다.'
    }
    $head = Invoke-Captured git @('-C', $Repository, 'rev-parse', 'HEAD')
    $remoteCommit = Get-RemoteMainCommit -Repository $Repository -Label 'Frontend'
    if ($head -ne $remoteCommit) {
        throw 'Frontend HEAD가 현재 원격 main SHA와 다릅니다. 배포를 중단합니다.'
    }
    return $remoteCommit
}

function Get-NestedValue {
    param($InputObject, [string[]]$PropertyPath)
    $current = $InputObject
    foreach ($propertyName in $PropertyPath) {
        if ($null -eq $current) { return $null }
        $property = $current.PSObject.Properties[$propertyName]
        if ($null -eq $property) { return $null }
        $current = $property.Value
    }
    return $current
}

function Assert-PublicReleaseDataSecurity {
    param(
        [string]$Gcloud,
        [string]$Project,
        [string]$Bucket,
        [string]$ManagedFolder,
        [string]$ExpectedOrigin
    )
    $bucketJson = Invoke-Captured $Gcloud @(
        'storage', 'buckets', 'describe', "gs://$Bucket",
        '--project', $Project,
        '--format=json'
    )
    try {
        $bucketDetails = $bucketJson | ConvertFrom-Json
    }
    catch {
        throw '버킷 보안 설정 응답을 JSON으로 해석할 수 없습니다.'
    }

    $publicAccessPrevention = Get-NestedValue -InputObject $bucketDetails -PropertyPath @('iamConfiguration', 'publicAccessPrevention')
    if ($null -eq $publicAccessPrevention) {
        $publicAccessPrevention = Get-NestedValue -InputObject $bucketDetails -PropertyPath @('iam_configuration', 'public_access_prevention')
    }
    if ($null -eq $publicAccessPrevention) {
        $publicAccessPrevention = Get-NestedValue -InputObject $bucketDetails -PropertyPath @('public_access_prevention')
    }
    if (([string]$publicAccessPrevention).ToLowerInvariant() -eq 'enforced') {
        throw '버킷의 공개 액세스 방지(PAP)가 아직 enforced 상태입니다.'
    }

    $uniformAccess = Get-NestedValue -InputObject $bucketDetails -PropertyPath @('iamConfiguration', 'uniformBucketLevelAccess', 'enabled')
    if ($null -eq $uniformAccess) {
        $uniformAccess = Get-NestedValue -InputObject $bucketDetails -PropertyPath @('iam_configuration', 'uniform_bucket_level_access', 'enabled')
    }
    if ($null -eq $uniformAccess) {
        $uniformAccess = Get-NestedValue -InputObject $bucketDetails -PropertyPath @('uniform_bucket_level_access')
    }
    if (([string]$uniformAccess).ToLowerInvariant() -ne 'true') {
        throw '버킷의 균일한 버킷 수준 액세스(UBLA)가 활성화되지 않았습니다.'
    }

    $policyJson = Invoke-Captured $Gcloud @(
        'storage', 'buckets', 'get-iam-policy', "gs://$Bucket",
        '--project', $Project,
        '--format=json'
    )
    try {
        $policy = $policyJson | ConvertFrom-Json
    }
    catch {
        throw '버킷 IAM 정책 응답을 JSON으로 해석할 수 없습니다.'
    }
    foreach ($binding in @(Get-NestedValue -InputObject $policy -PropertyPath @('bindings'))) {
        $role = [string](Get-NestedValue -InputObject $binding -PropertyPath @('role'))
        foreach ($member in @(Get-NestedValue -InputObject $binding -PropertyPath @('members'))) {
            if ($member -eq 'allAuthenticatedUsers' -or $member -eq 'allUsers') {
                throw "버킷 루트에 공개 IAM 역할이 남아 있습니다: $member $role"
            }
        }
    }

    $managedFolderUrl = "gs://$Bucket/$ManagedFolder"
    $folderPolicyJson = Invoke-Captured $Gcloud @(
        'storage', 'managed-folders', 'get-iam-policy', $managedFolderUrl,
        '--project', $Project,
        '--format=json'
    )
    try {
        $folderPolicy = $folderPolicyJson | ConvertFrom-Json
    }
    catch {
        throw '출시 자료 관리 폴더 IAM 정책 응답을 JSON으로 해석할 수 없습니다.'
    }
    $publicBindings = @()
    foreach ($binding in @(Get-NestedValue -InputObject $folderPolicy -PropertyPath @('bindings'))) {
        $role = [string](Get-NestedValue -InputObject $binding -PropertyPath @('role'))
        foreach ($member in @(Get-NestedValue -InputObject $binding -PropertyPath @('members'))) {
            if ($member -eq 'allAuthenticatedUsers' -or $member -eq 'allUsers') {
                $publicBindings += [pscustomobject]@{ Member = [string]$member; Role = $role }
            }
        }
    }
    if ($publicBindings.Count -ne 1 `
        -or $publicBindings[0].Member -ne 'allUsers' `
        -or $publicBindings[0].Role -ne 'roles/storage.objectViewer') {
        throw '출시 자료 관리 폴더는 allUsers 객체 조회 권한만 가져야 합니다.'
    }

    $corsEntries = @(Get-NestedValue -InputObject $bucketDetails -PropertyPath @('cors_config'))
    if ($corsEntries.Count -eq 0) {
        $corsEntries = @(Get-NestedValue -InputObject $bucketDetails -PropertyPath @('cors'))
    }
    $corsReady = $false
    foreach ($entry in $corsEntries) {
        $origins = @(Get-NestedValue -InputObject $entry -PropertyPath @('origin'))
        $methods = @(Get-NestedValue -InputObject $entry -PropertyPath @('method'))
        if ($origins -contains $ExpectedOrigin -and $methods -contains 'GET' -and $methods -contains 'HEAD') {
            $corsReady = $true
        }
    }
    if (-not $corsReady) {
        throw 'GitHub Pages용 GCS CORS 설정을 확인할 수 없습니다.'
    }
}

$frontendRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $BackendRepository) {
    $BackendRepository = Join-Path $frontendRoot '..\CTC_Latte_main_runtime'
}
$backendRoot = [System.IO.Path]::GetFullPath($BackendRepository)
$stagingBase = [System.IO.Path]::GetFullPath((Join-Path $frontendRoot '.deploy-staging'))
$stagingRoot = Join-Path $stagingBase ([guid]::NewGuid().ToString('N'))
$normalizedBucketPrefix = Normalize-ObjectPath -Value $BucketPrefix -Label 'BucketPrefix'
$bucketPrefixPattern = '^[A-Za-z0-9][A-Za-z0-9._/-]{0,511}$'
if ($normalizedBucketPrefix -notmatch $bucketPrefixPattern) {
    throw 'BucketPrefix에는 영문자, 숫자, 점, 밑줄, 하이픈, 슬래시만 사용할 수 있습니다.'
}
$normalizedPointerObject = Normalize-ObjectPath -Value $ReleasePointerObject -Label 'ReleasePointerObject'
$pointerPattern = '^{0}/release-candidate/releases/(?<datasetVersion>[0-9a-f]{{64}})\.json$' -f [regex]::Escape($normalizedBucketPrefix)
$pointerMatch = [regex]::Match($normalizedPointerObject, $pointerPattern)
if (-not $pointerMatch.Success) {
    throw "ReleasePointerObject는 $normalizedBucketPrefix/release-candidate/releases/<datasetVersion>.json 형식이어야 합니다."
}
$datasetVersion = $pointerMatch.Groups['datasetVersion'].Value
$mountedPointerObject = $normalizedPointerObject.Substring($normalizedBucketPrefix.Length).TrimStart('/')
$gcloud = Resolve-GcloudCommand

if (-not (Test-Path -LiteralPath $backendRoot -PathType Container)) {
    throw 'Backend 저장소를 찾을 수 없습니다.'
}

$frontendCommit = Assert-FrontendRemoteMain -Repository $frontendRoot
$backendCommit = Get-RemoteMainCommit -Repository $backendRoot -Label 'Backend'

Invoke-Checked $gcloud @(
    'services', 'enable',
    'artifactregistry.googleapis.com',
    'cloudbuild.googleapis.com',
    'run.googleapis.com',
    '--project', $ProjectId,
    '--quiet'
)
Assert-PublicReleaseDataSecurity `
    -Gcloud $gcloud `
    -Project $ProjectId `
    -Bucket $BucketName `
    -ManagedFolder "$normalizedBucketPrefix/release-candidate" `
    -ExpectedOrigin $PublicWebOrigin

New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null
try {
    $pointerUrl = "gs://$BucketName/$normalizedPointerObject"
    $pointerLocalPath = Join-Path $stagingRoot 'release-pointer.json'
    Invoke-Checked $gcloud @(
        'storage', 'cp', $pointerUrl, $pointerLocalPath,
        '--project', $ProjectId,
        '--quiet'
    )
    try {
        $pointer = Get-Content -LiteralPath $pointerLocalPath -Raw -Encoding UTF8 | ConvertFrom-Json
    }
    catch {
        throw 'GCS 불변 자료 포인터를 JSON으로 해석할 수 없습니다.'
    }
    $pointerFields = @($pointer.PSObject.Properties.Name | Sort-Object)
    $expectedPointerFields = @('datasetVersion', 'relativePath', 'releaseId', 'schemaVersion')
    if (($pointerFields -join ',') -ne ($expectedPointerFields -join ',') `
        -or $pointer.schemaVersion -ne 1 `
        -or [string]$pointer.releaseId -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' `
        -or [string]$pointer.datasetVersion -ne $datasetVersion) {
        throw 'GCS 불변 자료 포인터가 고정 스키마 또는 자료 버전과 일치하지 않습니다.'
    }
    $pointerRelativePath = Normalize-ObjectPath -Value ([string]$pointer.relativePath) -Label 'pointer.relativePath'
    if (-not $pointerRelativePath.EndsWith('.ctwebui', [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'GCS 불변 자료 포인터의 대상이 .ctwebui 디렉터리가 아닙니다.'
    }
    foreach ($identityPath in @('manifest.json', 'meta/array_index.json', 'meta/raw_cmip6_index.json')) {
        $identityUrl = "gs://$BucketName/$normalizedBucketPrefix/$pointerRelativePath/$identityPath"
        if (-not (Test-ExternalSuccess $gcloud @(
            'storage', 'objects', 'describe', $identityUrl,
            '--project', $ProjectId,
            '--format=value(generation)'
        ))) {
            throw "자료판 식별 파일을 GCS에서 확인할 수 없습니다: $identityPath"
        }
    }

    $frontendArchive = Join-Path $stagingRoot 'frontend.zip'
    $backendArchive = Join-Path $stagingRoot 'backend.zip'
    Invoke-Checked git @('-C', $frontendRoot, 'archive', '--format=zip', "--output=$frontendArchive", $frontendCommit)
    Invoke-Checked git @('-C', $backendRoot, 'archive', '--format=zip', "--output=$backendArchive", $backendCommit)
    Expand-Archive -LiteralPath $frontendArchive -DestinationPath (Join-Path $stagingRoot 'frontend')
    Expand-Archive -LiteralPath $backendArchive -DestinationPath (Join-Path $stagingRoot 'backend')
    Remove-Item -LiteralPath $frontendArchive, $backendArchive -Force
    Set-Content -LiteralPath (Join-Path $stagingRoot '.dockerignore') -Encoding utf8 -Value @(
        '*.log'
        '.git'
        '.release-evidence'
        'node_modules'
    )

    if (-not (Test-ExternalSuccess $gcloud @(
        'artifacts', 'repositories', 'describe', $ArtifactRepository,
        '--location', $Region,
        '--project', $ProjectId,
        '--quiet'
    ))) {
        Invoke-Checked $gcloud @(
            'artifacts', 'repositories', 'create', $ArtifactRepository,
            '--repository-format', 'docker',
            '--location', $Region,
            '--project', $ProjectId,
            '--description', '기후 타임캡슐 출시 후보 이미지',
            '--quiet'
        )
    }

    $serviceAccountName = 'ctc-latte-rc-runtime'
    $serviceAccount = "$serviceAccountName@$ProjectId.iam.gserviceaccount.com"
    if (-not (Test-ExternalSuccess $gcloud @(
        'iam', 'service-accounts', 'describe', $serviceAccount,
        '--project', $ProjectId,
        '--quiet'
    ))) {
        Invoke-Checked $gcloud @(
            'iam', 'service-accounts', 'create', $serviceAccountName,
            '--display-name', '기후 타임캡슐 출시 후보 읽기 전용 계정',
            '--project', $ProjectId,
            '--quiet'
        )
    }
    Invoke-Checked $gcloud @(
        'storage', 'buckets', 'add-iam-policy-binding', "gs://$BucketName",
        '--member', "serviceAccount:$serviceAccount",
        '--role', 'roles/storage.objectViewer',
        '--project', $ProjectId,
        '--quiet'
    )

    $frontendShort = $frontendCommit.Substring(0, 12)
    $backendShort = $backendCommit.Substring(0, 12)
    $datasetShort = $datasetVersion.Substring(0, 8)
    $timestamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmss')
    $revisionTag = "rc-$frontendShort-$backendShort-$datasetShort-$timestamp"
    $imageName = "$Region-docker.pkg.dev/$ProjectId/$ArtifactRepository/webui"
    $imageTag = "${imageName}:$revisionTag"
    $buildId = Invoke-Captured $gcloud @(
        'builds', 'submit', $stagingRoot,
        '--config', (Join-Path $stagingRoot 'frontend\deploy\cloudbuild.yaml'),
        '--substitutions', "_IMAGE_TAG=$imageTag",
        '--project', $ProjectId,
        '--format=value(id)',
        '--quiet'
    )
    if (-not $buildId) {
        throw 'Cloud Build 식별자를 확인할 수 없습니다.'
    }

    $imageDigest = Invoke-Captured $gcloud @(
        'artifacts', 'docker', 'images', 'describe', $imageTag,
        '--project', $ProjectId,
        '--format=value(image_summary.digest)'
    )
    if ($imageDigest -notmatch '^sha256:[0-9a-f]{64}$') {
        throw '빌드한 컨테이너 이미지의 SHA-256 digest를 확인할 수 없습니다.'
    }
    $imageReference = "$imageName@$imageDigest"

    $mount = "mount-path=/mnt/ctc-latte,type=cloud-storage,bucket=$BucketName,readonly=true,mount-options=only-dir=$normalizedBucketPrefix;uid=10001;gid=10001;file-mode=0440;dir-mode=0550"
    $environment = @(
        'CTC_BACKEND_ROOT=/app/backend',
        'CTC_GATEWAY_HOST=127.0.0.1',
        'CTC_GATEWAY_PORT=8765',
        'CTC_PREPARED_DATA_MOUNT_ROOT=/mnt/ctc-latte',
        'CTC_PREPARED_DATA_PROVIDER=gcs',
        'CTC_PYTHON_EXECUTABLE=python3',
        "CTC_RELEASE_POINTER=/mnt/ctc-latte/$mountedPointerObject",
        "CTC_RELEASE_TOKEN=$datasetVersion",
        "CTC_PUBLIC_WEB_ORIGINS=$PublicWebOrigin",
        'CTC_WEBUI_CMIP6_ZARR_ROOT=gs://cmip6'
    ) -join ','
    $serviceExists = Test-ExternalSuccess $gcloud @(
        'run', 'services', 'describe', $ServiceName,
        '--region', $Region,
        '--project', $ProjectId,
        '--quiet'
    )
    $deployArguments = @(
        'run', 'deploy', $ServiceName,
        '--image', $imageReference,
        '--region', $Region,
        '--project', $ProjectId,
        '--service-account', $serviceAccount,
        '--execution-environment', 'gen2',
        '--add-volume', $mount,
        '--set-env-vars', $environment,
        '--memory', '4Gi',
        '--cpu', '2',
        '--concurrency', '4',
        '--min', '0',
        '--max', '2',
        '--timeout', '900',
        '--ingress', 'all',
        '--allow-unauthenticated',
        '--no-iap'
    )
    if ($serviceExists) {
        $deployArguments += '--no-traffic'
    }
    $deployArguments += @(
        '--tag', $revisionTag,
        '--quiet'
    )
    Invoke-Checked $gcloud $deployArguments

    $serviceJson = Invoke-Captured $gcloud @(
        'run', 'services', 'describe', $ServiceName,
        '--region', $Region,
        '--project', $ProjectId,
        '--format=json'
    )
    $serviceDetails = $serviceJson | ConvertFrom-Json
    $revisionName = [string](Get-NestedValue -InputObject $serviceDetails -PropertyPath @('status', 'latestCreatedRevisionName'))
    $serviceUrl = [string](Get-NestedValue -InputObject $serviceDetails -PropertyPath @('status', 'url'))
    $taggedUrl = $null
    foreach ($trafficTarget in @(Get-NestedValue -InputObject $serviceDetails -PropertyPath @('status', 'traffic'))) {
        if ((Get-NestedValue -InputObject $trafficTarget -PropertyPath @('tag')) -eq $revisionTag) {
            $taggedUrl = [string](Get-NestedValue -InputObject $trafficTarget -PropertyPath @('url'))
            break
        }
    }

    [pscustomobject]@{
        BackendCommit = $backendCommit
        BuildId = $buildId
        DatasetVersion = $datasetVersion
        FrontendCommit = $frontendCommit
        Image = $imageReference
        PointerObject = $normalizedPointerObject
        Revision = $revisionName
        ServiceUrl = $serviceUrl
        Tag = $revisionTag
        TaggedUrl = $taggedUrl
        TrafficPromoted = $false
    } | ConvertTo-Json
}
finally {
    $resolvedStaging = [System.IO.Path]::GetFullPath($stagingRoot)
    $expectedPrefix = $stagingBase.TrimEnd([char[]]@('\', '/')) + [System.IO.Path]::DirectorySeparatorChar
    if ($resolvedStaging.StartsWith($expectedPrefix, [System.StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedStaging)) {
        Remove-Item -LiteralPath $resolvedStaging -Recurse -Force
    }
}
