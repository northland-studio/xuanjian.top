# GIS third deploy driver (frontend only). ASCII only for Windows PowerShell 5.1.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

$tag = '20261115-gis-fe3'
$stage = Join-Path $root "_deploy_$tag"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage | Out-Null

Write-Host "[1/4] pack ..."
tar -czf (Join-Path $stage 'dist.tgz') -C frontend/dist .
tar -czf (Join-Path $stage 'dist-ssr.tgz') -C frontend/dist-ssr .
Copy-Item scripts/deploy-gis-remote-20261115c.sh (Join-Path $stage 'deploy.sh')

Write-Host "[2/4] upload ..."
ssh HK "rm -rf /root/deploy-$tag && mkdir -p /root/deploy-$tag"
scp "$stage/dist.tgz" "$stage/dist-ssr.tgz" "$stage/deploy.sh" "HK:/root/deploy-$tag/"
ssh HK "sed -i 's/\r$//' /root/deploy-$tag/deploy.sh && chmod +x /root/deploy-$tag/deploy.sh"

Write-Host "[3/4] run remote deploy ..."
ssh HK "bash /root/deploy-$tag/deploy.sh"

Write-Host "[4/4] done."
