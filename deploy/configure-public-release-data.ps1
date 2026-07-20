[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')]
    [string]$ProjectId,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$')]
    [string]$BucketName,

    [string]$BucketPrefix = 'ctc_latte',

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
        foreach ($propertyName in @('Path', 'Source')) {
            $property = $resolved.PSObject.Properties[$propertyName]
            if ($null -ne $property -and $property.Value) {
                return [string]$property.Value
            }
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
    throw 'Google Cloud CLI를 찾을 수 없습니다.'
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

function Read-JsonCommand {
    param([string]$Command, [string[]]$Arguments, [string]$FailureMessage)
    $json = Invoke-Captured $Command $Arguments
    try {
        return $json | ConvertFrom-Json
    }
    catch {
        throw $FailureMessage
    }
}

function Get-PublicBindings {
    param($Policy)
    $bindings = @()
    foreach ($binding in @(Get-NestedValue -InputObject $Policy -PropertyPath @('bindings'))) {
        $role = [string](Get-NestedValue -InputObject $binding -PropertyPath @('role'))
        foreach ($member in @(Get-NestedValue -InputObject $binding -PropertyPath @('members'))) {
            if ($member -eq 'allUsers' -or $member -eq 'allAuthenticatedUsers') {
                $bindings += [pscustomobject]@{ Member = [string]$member; Role = $role }
            }
        }
    }
    return @($bindings)
}

function Assert-PublicReleaseDataSecurity {
    param(
        [string]$Gcloud,
        [string]$Project,
        [string]$Bucket,
        [string]$ManagedFolder,
        [string]$ExpectedOrigin
    )
    $bucketDetails = Read-JsonCommand $Gcloud @(
        'storage', 'buckets', 'describe', "gs://$Bucket",
        '--project', $Project,
        '--format=json'
    ) '버킷 설정을 JSON으로 해석할 수 없습니다.'

    $publicAccessPrevention = Get-NestedValue $bucketDetails @('public_access_prevention')
    if ($null -eq $publicAccessPrevention) {
        $publicAccessPrevention = Get-NestedValue $bucketDetails @('iamConfiguration', 'publicAccessPrevention')
    }
    if (([string]$publicAccessPrevention).ToLowerInvariant() -eq 'enforced') {
        throw '버킷의 공개 액세스 방지(PAP)가 아직 enforced 상태입니다.'
    }

    $uniformAccess = Get-NestedValue $bucketDetails @('uniform_bucket_level_access')
    if ($null -eq $uniformAccess) {
        $uniformAccess = Get-NestedValue $bucketDetails @('iamConfiguration', 'uniformBucketLevelAccess', 'enabled')
    }
    if (([string]$uniformAccess).ToLowerInvariant() -ne 'true') {
        throw '버킷의 균일한 버킷 수준 액세스(UBLA)가 활성화되지 않았습니다.'
    }

    $corsEntries = @(Get-NestedValue $bucketDetails @('cors_config'))
    if ($corsEntries.Count -eq 0) {
        $corsEntries = @(Get-NestedValue $bucketDetails @('cors'))
    }
    $corsReady = $false
    foreach ($entry in $corsEntries) {
        $origins = @(Get-NestedValue $entry @('origin'))
        $methods = @(Get-NestedValue $entry @('method'))
        if ($origins -contains $ExpectedOrigin -and $methods -contains 'GET' -and $methods -contains 'HEAD') {
            $corsReady = $true
        }
    }
    if (-not $corsReady) {
        throw 'GitHub Pages용 GCS CORS 설정을 확인할 수 없습니다.'
    }

    $bucketPolicy = Read-JsonCommand $Gcloud @(
        'storage', 'buckets', 'get-iam-policy', "gs://$Bucket",
        '--project', $Project,
        '--format=json'
    ) '버킷 IAM 정책을 JSON으로 해석할 수 없습니다.'
    $bucketPublicBindings = @(Get-PublicBindings $bucketPolicy)
    if ($bucketPublicBindings.Count -gt 0) {
        throw '버킷 루트에 공개 IAM 역할이 남아 있습니다.'
    }

    $managedFolderUrl = "gs://$Bucket/$ManagedFolder"
    $folderPolicy = Read-JsonCommand $Gcloud @(
        'storage', 'managed-folders', 'get-iam-policy', $managedFolderUrl,
        '--project', $Project,
        '--format=json'
    ) '출시 자료 관리 폴더 IAM 정책을 JSON으로 해석할 수 없습니다.'
    $folderPublicBindings = @(Get-PublicBindings $folderPolicy)
    if ($folderPublicBindings.Count -ne 1 `
        -or $folderPublicBindings[0].Member -ne 'allUsers' `
        -or $folderPublicBindings[0].Role -ne 'roles/storage.objectViewer') {
        throw '출시 자료 관리 폴더는 allUsers 객체 조회 권한만 가져야 합니다.'
    }
}

$gcloud = Resolve-GcloudCommand
$publicWebUri = [Uri]$PublicWebOrigin
if ($publicWebUri.Scheme -ne 'https' `
    -or $publicWebUri.AbsolutePath -ne '/' `
    -or $publicWebUri.Query `
    -or $publicWebUri.Fragment) {
    throw 'PublicWebOrigin은 경로가 없는 HTTPS 출처여야 합니다.'
}
$PublicWebOrigin = $publicWebUri.GetLeftPart([System.UriPartial]::Authority)
$normalizedBucketPrefix = Normalize-ObjectPath -Value $BucketPrefix -Label 'BucketPrefix'
if ($normalizedBucketPrefix -notmatch '^[A-Za-z0-9][A-Za-z0-9._/-]{0,511}$') {
    throw 'BucketPrefix에는 영문자, 숫자, 점, 밑줄, 하이픈, 슬래시만 사용할 수 있습니다.'
}
$managedFolder = "$normalizedBucketPrefix/release-candidate"
$managedFolderUrl = "gs://$BucketName/$managedFolder"
$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("ctc-public-gcs-" + [guid]::NewGuid().ToString('N'))
$corsPath = Join-Path $temporaryRoot 'cors.json'

New-Item -ItemType Directory -Path $temporaryRoot -Force | Out-Null
try {
    $corsEntry = [ordered]@{
        origin = @($PublicWebOrigin)
        method = @('GET', 'HEAD')
        responseHeader = @('Content-Type', 'Content-Length', 'ETag', 'Range', 'Content-Range')
        maxAgeSeconds = 3600
    }
    $cors = '[' + ($corsEntry | ConvertTo-Json -Depth 5) + ']'
    [System.IO.File]::WriteAllText($corsPath, $cors, (New-Object System.Text.UTF8Encoding($false)))

    Invoke-Checked $gcloud @(
        'storage', 'buckets', 'update', "gs://$BucketName",
        '--no-public-access-prevention',
        "--cors-file=$corsPath",
        '--project', $ProjectId,
        '--quiet'
    )

    $bucketPolicy = Read-JsonCommand $gcloud @(
        'storage', 'buckets', 'get-iam-policy', "gs://$BucketName",
        '--project', $ProjectId,
        '--format=json'
    ) '버킷 IAM 정책을 JSON으로 해석할 수 없습니다.'
    foreach ($binding in @(Get-PublicBindings $bucketPolicy)) {
        if ($binding.Member -eq 'allUsers' -and $binding.Role -eq 'roles/storage.legacyObjectReader') {
            Invoke-Checked $gcloud @(
                'storage', 'buckets', 'remove-iam-policy-binding', "gs://$BucketName",
                '--member', 'allUsers',
                '--role', 'roles/storage.legacyObjectReader',
                '--project', $ProjectId,
                '--quiet'
            )
        }
        else {
            throw "버킷 루트에 제거 여부를 자동 판단할 수 없는 공개 역할이 있습니다: $($binding.Member) $($binding.Role)"
        }
    }

    if (-not (Test-ExternalSuccess $gcloud @(
        'storage', 'managed-folders', 'describe', "$managedFolderUrl/",
        '--project', $ProjectId,
        '--format=value(name)'
    ))) {
        Invoke-Checked $gcloud @(
            'storage', 'managed-folders', 'create', "$managedFolderUrl/",
            '--project', $ProjectId,
            '--quiet'
        )
    }
    Invoke-Checked $gcloud @(
        'storage', 'managed-folders', 'add-iam-policy-binding', $managedFolderUrl,
        '--member', 'allUsers',
        '--role', 'roles/storage.objectViewer',
        '--project', $ProjectId,
        '--quiet'
    )

    Assert-PublicReleaseDataSecurity `
        -Gcloud $gcloud `
        -Project $ProjectId `
        -Bucket $BucketName `
        -ManagedFolder $managedFolder `
        -ExpectedOrigin $PublicWebOrigin

    [pscustomobject]@{
        Bucket = $BucketName
        BucketRootPublic = $false
        CorsOrigin = $PublicWebOrigin
        ManagedFolder = $managedFolder
        PublicReadRole = 'roles/storage.objectViewer'
        PublicWriteAllowed = $false
        Verified = $true
    } | ConvertTo-Json
}
finally {
    if (Test-Path -LiteralPath $temporaryRoot -PathType Container) {
        Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
    }
}
