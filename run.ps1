param (
    [Parameter(Mandatory)]
    [string]
    $Url,
    [Parameter(Mandatory)]
    [string]
    $Login,
    [Parameter(Mandatory)]
    [string]
    $Password,
    [Parameter(Mandatory)]
    [string]
    $SrcPath,
    [Parameter(Mandatory)]
    [string]
    $DestPath
)
$ErrorActionPreference = "Stop"

# CI
Remove-Item -Force -Recurse ${DestPath} -ErrorAction "Ignore"
Copy-Item -Recurse ${SrcPath} ${DestPath}
(Get-Content .\${DestPath}\.env) -replace "\$\(baseURL\)", "${Url}" `
    -replace "\$\(login\)", "${Login}" `
    -replace "\$\(password\)", "`"${Password}`"" `
    | Set-Content .\${DestPath}\.env

npm --prefix ${DestPath} ci
if (!$?) {
    return 1;
}

# CD
docker run -e CI=1 -v ./${DestPath}/:/ui-test/ -w /ui-test/ mcr.microsoft.com/playwright:v1.64.0-noble npx playwright test --project=chromium