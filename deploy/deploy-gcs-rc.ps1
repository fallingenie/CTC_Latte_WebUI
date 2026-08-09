[CmdletBinding()]
param(
    [string]$ProjectId = 'ee-tenerif2',
    [string]$Region = 'asia-northeast3',
    [string]$ArtifactRepository = 'ctc-latte',
    [string]$RuntimeBaseImage,
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
    throw 'Google Cloud CLI를 찾을 수 없습니다.'
}

$serviceName = 'ctc-latte-rc'
$bucketName = 'ctc_latte'
$bucketPrefix = 'webui'
$serviceAccount = "ctc-latte-rc-runtime@$ProjectId.iam.gserviceaccount.com"
$frontendRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$stagingBase = [System.IO.Path]::GetFullPath((Join-Path $frontendRoot '.deploy-staging'))
$stagingRoot = Join-Path $stagingBase ("gcs-rc-" + [guid]::NewGuid().ToString('N'))
$datasetRoot = Join-Path $stagingRoot 'current.ctwebui'
$buildRoot = Join-Path $stagingRoot 'build'
$gcloud = Resolve-GcloudCommand

New-Item -ItemType Directory -Path (Join-Path $datasetRoot 'meta') -Force | Out-Null
try {
    foreach ($relativePath in @(
        'manifest.json',
        'meta/array_index.json',
        'meta/raw_cmip6_index.json',
        'meta/completion.json'
    )) {
        $target = Join-Path $datasetRoot ($relativePath.Replace('/', [System.IO.Path]::DirectorySeparatorChar))
        Invoke-Checked $gcloud @(
            'storage', 'cp', "gs://$bucketName/$bucketPrefix/$relativePath", $target,
            '--project', $ProjectId,
            '--quiet'
        )
    }

    $bindingJson = Invoke-Captured node @(
        (Join-Path $frontendRoot 'scripts\inspect-gcs-rc-dataset.mjs'),
        $datasetRoot
    )
    try {
        $binding = $bindingJson | ConvertFrom-Json
    }
    catch {
        throw 'GCS RC 자료판 결합값 응답을 JSON으로 해석할 수 없습니다.'
    }

    Invoke-Checked pnpm @('test')
    Invoke-Checked pnpm @('build')

    $frontendStatus = Invoke-Captured git @('-C', $frontendRoot, 'status', '--porcelain')
    if ($frontendStatus) {
        throw 'Frontend 저장소에 커밋되지 않은 변경이 있습니다.'
    }
    $frontendCommit = Invoke-Captured git @('-C', $frontendRoot, 'rev-parse', 'HEAD')

    if (-not $RuntimeBaseImage) {
        $readyRevision = Invoke-Captured $gcloud @(
            'run', 'services', 'describe', $serviceName,
            '--region', $Region,
            '--project', $ProjectId,
            '--format=value(status.latestReadyRevisionName)'
        )
        if (-not $readyRevision) {
            throw '현재 준비된 RC 런타임 revision을 확인할 수 없습니다.'
        }
        $RuntimeBaseImage = Invoke-Captured $gcloud @(
            'run', 'revisions', 'describe', $readyRevision,
            '--region', $Region,
            '--project', $ProjectId,
            '--format=value(spec.containers[0].image)'
        )
    }
    if (-not $RuntimeBaseImage) {
        throw 'RC 런타임 기반 이미지를 확인할 수 없습니다.'
    }

    New-Item -ItemType Directory -Path $buildRoot -Force | Out-Null
    $frontendArchive = Join-Path $stagingRoot 'frontend.zip'
    Invoke-Checked git @('-C', $frontendRoot, 'archive', '--format=zip', "--output=$frontendArchive", $frontendCommit)
    Expand-Archive -LiteralPath $frontendArchive -DestinationPath (Join-Path $buildRoot 'frontend')

    Invoke-Checked $gcloud @(
        'storage', 'buckets', 'add-iam-policy-binding', "gs://$bucketName",
        '--member', "serviceAccount:$serviceAccount",
        '--role', 'roles/storage.objectViewer',
        '--project', $ProjectId,
        '--quiet'
    )

    $sourceCommit = $frontendCommit.Substring(0, 8)
    $datasetShort = ([string]$binding.datasetVersion).Substring(0, 8)
    $revisionTag = "rc-$sourceCommit-$datasetShort"
    $imageName = "$Region-docker.pkg.dev/$ProjectId/$ArtifactRepository/webui-rc"
    $imageTag = "${imageName}:$revisionTag"
    $buildId = Invoke-Captured $gcloud @(
        'builds', 'submit', $buildRoot,
        '--config', (Join-Path $buildRoot 'frontend\deploy\cloudbuild-gcs-rc.yaml'),
        '--substitutions', "_IMAGE=$imageTag,_BASE_IMAGE=$RuntimeBaseImage",
        '--project', $ProjectId,
        '--format=value(id)',
        '--quiet'
    )
    if (-not $buildId) {
        throw 'RC 이미지 Cloud Build 식별자를 확인할 수 없습니다.'
    }
    $imageDigest = Invoke-Captured $gcloud @(
        'artifacts', 'docker', 'images', 'describe', $imageTag,
        '--project', $ProjectId,
        '--format=value(image_summary.digest)'
    )
    if ($imageDigest -notmatch '^sha256:[0-9a-f]{64}$') {
        throw 'RC 컨테이너 이미지 digest를 확인할 수 없습니다.'
    }
    $imageReference = "$imageName@$imageDigest"

    $mountPath = '/mnt/ctc-latte/current.ctwebui'
    $mount = "mount-path=$mountPath,type=cloud-storage,bucket=$bucketName,readonly=true,mount-options=only-dir=$bucketPrefix;uid=10001;gid=10001;file-mode=0440;dir-mode=0550"
    $environment = @(
        'CTC_BACKEND_ROOT=/app/backend',
        'CTC_GATEWAY_HOST=127.0.0.1',
        'CTC_GATEWAY_PORT=8765',
        'CTC_PREPARED_DATA_MOUNT_ROOT=/mnt/ctc-latte',
        'CTC_PREPARED_DATA_PROVIDER=gcs',
        'CTC_PYTHON_EXECUTABLE=python3',
        "CTC_WEB_DATA_ROOT=$mountPath",
        'CTC_RC_DATA_MODE=gcs-current',
        "CTC_RC_EXPECTED_DATASET_VERSION=$($binding.datasetVersion)",
        "CTC_PUBLIC_WEB_ORIGINS=$PublicWebOrigin",
        'CTC_WEBUI_CMIP6_ZARR_ROOT=gs://cmip6'
    ) -join ','

    Invoke-Checked $gcloud @(
        'run', 'deploy', $serviceName,
        '--image', $imageReference,
        '--region', $Region,
        '--project', $ProjectId,
        '--service-account', $serviceAccount,
        '--execution-environment', 'gen2',
        '--clear-volumes',
        '--clear-volume-mounts',
        '--add-volume', $mount,
        '--set-env-vars', $environment,
        '--memory', '4Gi',
        '--cpu', '2',
        '--concurrency', '4',
        '--max', '2',
        '--timeout', '900',
        '--ingress', 'all',
        '--allow-unauthenticated',
        '--no-iap',
        '--no-traffic',
        '--tag', $revisionTag,
        '--quiet'
    )

    $serviceUrl = Invoke-Captured $gcloud @(
        'run', 'services', 'describe', $serviceName,
        '--region', $Region,
        '--project', $ProjectId,
        '--format=value(status.url)'
    )
    [pscustomobject]@{
        Bucket = $bucketName
        BucketPrefix = $bucketPrefix
        BuildId = $buildId
        DatasetVersion = $binding.datasetVersion
        FrontendCommit = $frontendCommit
        Image = $imageReference
        RuntimeBaseImage = $RuntimeBaseImage
        Service = $serviceName
        ServiceAccount = $serviceAccount
        ServiceUrl = $serviceUrl
    } | ConvertTo-Json
}
finally {
    $resolvedStaging = [System.IO.Path]::GetFullPath($stagingRoot)
    $expectedPrefix = $stagingBase.TrimEnd([char[]]@('\', '/')) + [System.IO.Path]::DirectorySeparatorChar
    if ($resolvedStaging.StartsWith($expectedPrefix, [System.StringComparison]::OrdinalIgnoreCase) `
        -and (Test-Path -LiteralPath $resolvedStaging)) {
        Remove-Item -LiteralPath $resolvedStaging -Recurse -Force
    }
}
