param(
  [string]$ProjectName = "campeonato-gameleiras",
  [string]$ProductionBranch = "main",
  [string]$CustomDomain = "campeonato.speedlinemg.com.br",
  [string]$ZoneName = "speedlinemg.com.br"
)

$ErrorActionPreference = "Stop"

function Get-RequiredEnv {
  param([string]$Name)

  # Procura a credencial em 3 lugares, nesta ordem: no processo atual, e depois
  # nas variaveis persistentes do usuario e da maquina. As persistentes so
  # aparecem no processo quando ele e criado DEPOIS de terem sido salvas, por
  # isso a busca explicita — assim o deploy funciona em qualquer terminal.
  $value = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($value)) {
    $value = [Environment]::GetEnvironmentVariable($Name, "User")
  }
  if ([string]::IsNullOrWhiteSpace($value)) {
    $value = [Environment]::GetEnvironmentVariable($Name, "Machine")
  }
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "Missing required environment variable: $Name"
  }

  return $value
}

$ApiToken = Get-RequiredEnv "CLOUDFLARE_API_TOKEN"
$AccountId = Get-RequiredEnv "CLOUDFLARE_ACCOUNT_ID"

# O wrangler roda como processo FILHO e le a credencial do ambiente. Se ela
# veio das variaveis persistentes (User/Machine), ainda nao esta no ambiente
# deste processo — entao publicamos aqui para o filho herdar.
$env:CLOUDFLARE_API_TOKEN = $ApiToken
$env:CLOUDFLARE_ACCOUNT_ID = $AccountId
$ApiBase = "https://api.cloudflare.com/client/v4"
$Headers = @{
  "Authorization" = "Bearer $ApiToken"
  "Content-Type" = "application/json"
}

function ConvertTo-CfJson {
  param($Value)

  return ($Value | ConvertTo-Json -Depth 20 -Compress)
}

function Read-ErrorResponseBody {
  param($Exception)

  if ($Exception.Response -eq $null) {
    return $Exception.Message
  }

  $stream = $Exception.Response.GetResponseStream()
  if ($stream -eq $null) {
    return $Exception.Message
  }

  $reader = New-Object System.IO.StreamReader($stream)
  return $reader.ReadToEnd()
}

function Invoke-CfApi {
  param(
    [ValidateSet("GET", "POST", "PATCH", "PUT", "DELETE")]
    [string]$Method,
    [string]$Path,
    $Body = $null,
    [switch]$AllowNotFound
  )

  $params = @{
    Method = $Method
    Uri = "$ApiBase$Path"
    Headers = $Headers
  }

  if ($Body -ne $null) {
    $params.Body = ConvertTo-CfJson $Body
  }

  try {
    $response = Invoke-RestMethod @params
  } catch {
    $statusCode = $null
    if ($_.Exception.Response -ne $null) {
      $statusCode = [int]$_.Exception.Response.StatusCode
    }

    if ($AllowNotFound -and $statusCode -eq 404) {
      return $null
    }

    $errorBody = Read-ErrorResponseBody $_.Exception
    throw "Cloudflare API $Method $Path failed: $errorBody"
  }

  if ($response.success -eq $false) {
    throw "Cloudflare API $Method $Path failed: $(ConvertTo-CfJson $response.errors)"
  }

  return $response
}

function Escape-UrlPart {
  param([string]$Value)

  return [System.Uri]::EscapeDataString($Value)
}

function Invoke-Wrangler {
  param([string[]]$Arguments)

  $npx = Get-Command npx.cmd -ErrorAction SilentlyContinue
  if ($npx -eq $null) {
    $npx = Get-Command npx -ErrorAction Stop
  }

  & $npx.Source --yes wrangler@latest @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Wrangler command failed with exit code $LASTEXITCODE."
  }
}

Write-Host "Using Cloudflare account $AccountId"

$projectPath = "/accounts/$AccountId/pages/projects/$ProjectName"
$project = Invoke-CfApi -Method GET -Path $projectPath -AllowNotFound

if ($project -eq $null) {
  Write-Host "Creating Pages project '$ProjectName'..."
  Invoke-CfApi -Method POST -Path "/accounts/$AccountId/pages/projects" -Body @{
    name = $ProjectName
    production_branch = $ProductionBranch
  } | Out-Null
} else {
  Write-Host "Pages project '$ProjectName' already exists."
}

# ATENCAO: 'wrangler pages deploy' NAO respeita o .assetsignore (isso e recurso
# de Workers Assets). Publicar a raiz do projeto subia tudo: backups com dump do
# banco, este script, firestore.rules, .gitignore, documentos internos. Por isso
# montamos uma pasta temporaria com SOMENTE os arquivos do site e publicamos ela.
$publishDir = Join-Path ([System.IO.Path]::GetTempPath()) ("cfpages-" + $ProjectName)
if (Test-Path $publishDir) { Remove-Item -Recurse -Force $publishDir }
New-Item -ItemType Directory -Force -Path $publishDir | Out-Null

Copy-Item -Path "index.html" -Destination $publishDir
Copy-Item -Path "assets" -Destination $publishDir -Recurse

# imagens de origem pesadas nunca vao para o ar (o site usa as versoes .webp)
$sobras = @("assets\img\Esporte", "assets\img\Esporte.zip")
foreach ($s in $sobras) {
  $p = Join-Path $publishDir $s
  if (Test-Path $p) { Remove-Item -Recurse -Force $p }
}

# trava de seguranca: nada fora do site pode estar na pasta de publicacao
$proibidos = Get-ChildItem -Path $publishDir -Recurse -File | Where-Object {
  $_.Extension -in @(".ps1", ".toml", ".rules", ".md", ".log", ".zip", ".json") -or
  $_.Name -in @(".gitignore", ".assetsignore", ".env") -or
  $_.FullName -like "*\backups\*"
}
if ($proibidos.Count -gt 0) {
  $lista = ($proibidos | ForEach-Object { $_.FullName.Replace($publishDir, "") }) -join ", "
  throw "Arquivos que nao pertencem ao site foram encontrados na pasta de publicacao: $lista"
}

$totalArquivos = (Get-ChildItem -Path $publishDir -Recurse -File).Count
if (-not (Test-Path (Join-Path $publishDir "index.html"))) {
  throw "index.html nao chegou na pasta de publicacao. Deploy abortado."
}
Write-Host "Publicando $totalArquivos arquivos (somente o site) de $publishDir..."

Invoke-Wrangler -Arguments @(
  "pages", "deploy", $publishDir,
  "--project-name", $ProjectName,
  "--branch", $ProductionBranch,
  "--commit-dirty=true"
)

Remove-Item -Recurse -Force $publishDir

$project = Invoke-CfApi -Method GET -Path $projectPath
$pagesSubdomain = $project.result.subdomain
if ([string]::IsNullOrWhiteSpace($pagesSubdomain)) {
  $pagesSubdomain = "$ProjectName.pages.dev"
}

Write-Host "Ensuring Pages custom domain '$CustomDomain'..."
$domains = Invoke-CfApi -Method GET -Path "$projectPath/domains"
$existingDomain = @($domains.result | Where-Object { $_.name -eq $CustomDomain })[0]
if ($existingDomain -eq $null) {
  Invoke-CfApi -Method POST -Path "$projectPath/domains" -Body @{
    name = $CustomDomain
  } | Out-Null
} else {
  Write-Host "Pages custom domain already exists."
}

Write-Host "Ensuring Cloudflare DNS CNAME in zone '$ZoneName'..."
$zoneQuery = Escape-UrlPart $ZoneName
$zones = Invoke-CfApi -Method GET -Path "/zones?name=$zoneQuery"
$zone = @($zones.result | Where-Object { $_.name -eq $ZoneName })[0]
if ($zone -eq $null) {
  throw "Cloudflare zone '$ZoneName' was not found for this token/account."
}

$zoneId = $zone.id
$recordNameQuery = Escape-UrlPart $CustomDomain
$records = Invoke-CfApi -Method GET -Path "/zones/$zoneId/dns_records?name=$recordNameQuery"
$blockingRecords = @($records.result | Where-Object { $_.type -ne "CNAME" })
if ($blockingRecords.Count -gt 0) {
  $types = ($blockingRecords | ForEach-Object { $_.type }) -join ", "
  throw "Cannot create CNAME for '$CustomDomain' because existing non-CNAME DNS records were found: $types"
}

$recordBody = @{
  type = "CNAME"
  name = $CustomDomain
  content = $pagesSubdomain
  ttl = 1
  proxied = $true
  comment = "Cloudflare Pages project: $ProjectName"
}

$cname = @($records.result | Where-Object { $_.type -eq "CNAME" })[0]
if ($cname -eq $null) {
  Invoke-CfApi -Method POST -Path "/zones/$zoneId/dns_records" -Body $recordBody | Out-Null
} elseif ($cname.content -ne $pagesSubdomain -or $cname.proxied -ne $true) {
  Invoke-CfApi -Method PATCH -Path "/zones/$zoneId/dns_records/$($cname.id)" -Body $recordBody | Out-Null
} else {
  Write-Host "DNS CNAME is already correct."
}

Write-Host ""
Write-Host "Deployment complete."
Write-Host "Pages URL: https://$pagesSubdomain"
Write-Host "Custom domain: https://$CustomDomain"
Write-Host "DNS: CNAME $CustomDomain -> $pagesSubdomain (proxied)"
