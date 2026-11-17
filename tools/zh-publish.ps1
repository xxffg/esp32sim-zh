# 在 AtomGit 创建仓库并把当前仓库推上去
# 用法(在本机 PowerShell 里,仓库根目录):
#   $env:ATOMGIT_TOKEN = "你的个人访问令牌"
#   tools\zh-publish.ps1 -Repo esp32sim-zh [-Public] [-Owner 你的登录名]
# 令牌在 https://atomgit.com 的「个人访问令牌」页面创建,勾选 repo 读写权限即可,用完可吊销。
param(
  [Parameter(Mandatory = $true)][string]$Repo,
  [string]$Owner = "",
  [switch]$Public
)

$ErrorActionPreference = 'Stop'
$token = $env:ATOMGIT_TOKEN
if (-not $token) { throw "请先设置环境变量 ATOMGIT_TOKEN(个人访问令牌)" }

$api = 'https://api.atomgit.com/api/v5'
$headers = @{ Authorization = "Bearer $token"; 'Content-Type' = 'application/json' }

if (-not $Owner) {
  $me = Invoke-RestMethod -Uri "$api/user" -Headers $headers
  $Owner = $me.login
  Write-Host "登录用户: $Owner"
}

$body = @{
  name        = $Repo
  description = 'esp32sim 简体中文版:自动汉化 + 三平台构建'
  private     = (-not $Public)
  auto_init   = $false
} | ConvertTo-Json

try {
  $r = Invoke-RestMethod -Method Post -Uri "$api/user/repos" -Headers $headers -Body $body
  Write-Host "仓库已创建: $($r.full_name)  $($r.html_url)"
} catch {
  $code = $_.Exception.Response.StatusCode.value__
  if ($code -eq 400) { Write-Host "仓库可能已存在,继续推送" } else { throw }
}

$url = "https://oauth2:$token@atomgit.com/$Owner/$Repo.git"
git remote remove atomgit 2>$null
git remote add atomgit $url
git push -u atomgit zh main
Write-Host "完成:https://atomgit.com/$Owner/$Repo"
Write-Host "下一步:在该仓库的 Settings → Secrets 加上 DEEPSEEK_API_KEY"
