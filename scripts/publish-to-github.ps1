$ErrorActionPreference = 'Stop'
$repo = 'just2512/fund-boll-ledger'

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  throw '未找到 GitHub CLI（gh）。请先安装 GitHub CLI，再执行 gh auth login。官方安装说明：https://cli.github.com/'
}
& gh auth status
if ($LASTEXITCODE -ne 0) { throw 'GitHub CLI 尚未登录。请执行 gh auth login 后重试。' }

if (-not (Test-Path '.git')) {
  git init
  if ($LASTEXITCODE -ne 0) { throw 'git init 失败。' }
  git branch -M main
  if ($LASTEXITCODE -ne 0) { throw '无法设置 main 分支。' }
}

# Set local commit identity only; do not alter global Git configuration.
$name = git config user.name
$email = git config user.email
if (-not $name) {
  $name = (& gh api user --jq '.login').Trim()
  git config user.name $name
}
if (-not $email) {
  $userId = (& gh api user --jq '.id').Trim()
  $login = (& gh api user --jq '.login').Trim()
  git config user.email "$userId+$login@users.noreply.github.com"
}

git add -A
if ($LASTEXITCODE -ne 0) { throw 'git add 失败。' }
$hasHead = $true
git rev-parse --verify HEAD *> $null
if ($LASTEXITCODE -ne 0) { $hasHead = $false }
git diff --cached --quiet
$hasChanges = $LASTEXITCODE -ne 0
if (-not $hasHead -or $hasChanges) {
  git commit -m 'feat: bootstrap fund BOLL ledger PWA'
  if ($LASTEXITCODE -ne 0) { throw 'git commit 失败。请检查 Git 身份和暂存区。' }
}

gh repo view $repo --json name *> $null
$repoExists = $LASTEXITCODE -eq 0
if (-not $repoExists) {
  Write-Host "准备创建私有 GitHub 仓库 $repo 并推送 main 分支……"
  gh repo create $repo --private --source . --remote origin --push
  if ($LASTEXITCODE -ne 0) { throw 'GitHub 仓库创建或首次推送失败。检查 GitHub 权限后重试。' }
} else {
  $origin = git remote get-url origin 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $origin) {
    git remote add origin "https://github.com/$repo.git"
    if ($LASTEXITCODE -ne 0) { throw '添加 origin 远程地址失败。' }
  }
  git push -u origin main
  if ($LASTEXITCODE -ne 0) { throw '推送失败。检查仓库权限、远程分支和本地提交。' }
}
Write-Host "完成。仓库地址：https://github.com/$repo"
