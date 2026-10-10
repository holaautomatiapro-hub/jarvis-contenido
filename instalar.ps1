<#
  JARVIS · instalador para Windows
  Uso (desde la carpeta de JARVIS):
    powershell -ExecutionPolicy Bypass -File instalar.ps1                     instala o actualiza y arranca
    powershell -ExecutionPolicy Bypass -File instalar.ps1 -InstalarObsidian   además instala Obsidian si falta
    powershell -ExecutionPolicy Bypass -File instalar.ps1 -Reiniciar          reinicia JARVIS (p. ej. tras cambiar claves)
    powershell -ExecutionPolicy Bypass -File instalar.ps1 -Parar              para JARVIS
    powershell -ExecutionPolicy Bypass -File instalar.ps1 -Desinstalar        quita el arranque automático y el acceso directo
  Otras opciones: -SinAutoarranque (no arranca con Windows), -SinArrancar (no lo abre al terminar).
  No necesita permisos de administrador (solo si falta Node.js, Windows te pedirá permiso para instalarlo).
  Tus notas, datos y claves nunca se borran.
#>
[CmdletBinding()]
param(
  [switch]$InstalarObsidian,
  [switch]$SinAutoarranque,
  [switch]$SinArrancar,
  [switch]$Reiniciar,
  [switch]$Parar,
  [switch]$Desinstalar
)

$ErrorActionPreference = 'Stop'
$Raiz = $PSScriptRoot
Set-Location -LiteralPath $Raiz
$EsWindows = $env:OS -eq 'Windows_NT'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
$Npm = if ($EsWindows) { 'npm.cmd' } else { 'npm' }
$PidFile = Join-Path $Raiz 'data\jarvis.pid'
$Oculto = Join-Path $Raiz 'data\arrancar-jarvis.vbs'
$NodeMinimo = [version]'22.5.0'
# Windows está retirando VBScript poco a poco: si ya no existe, se usa iniciar-jarvis.bat minimizado
$HayVbs = $EsWindows -and (Test-Path -LiteralPath (Join-Path $env:WINDIR 'System32\wscript.exe'))

function Titulo($t) { Write-Host ''; Write-Host "  > $t" -ForegroundColor Cyan }
function Ok($t) { Write-Host "    ✓ $t" -ForegroundColor Green }
function Aviso($t) { Write-Host "    ! $t" -ForegroundColor Yellow }
function Fallo($t) { Write-Host ''; Write-Host "    ✗ $t" -ForegroundColor Red; Write-Host ''; exit 1 }
function Tiene($cmd) { return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

function Actualizar-Path {
  if (-not $EsWindows) { return }
  $rutas = @([Environment]::GetEnvironmentVariable('Path', 'Machine'), [Environment]::GetEnvironmentVariable('Path', 'User'), "$env:USERPROFILE\.local\bin")
  $env:Path = ($rutas | Where-Object { $_ }) -join ';'
}

function Con-Winget($id, $nombre) {
  if (-not (Tiene 'winget')) { return $false }
  Write-Host "    Instalando $nombre con winget (puede tardar un par de minutos; si Windows pide permiso, acéptalo)..."
  & winget install -e --id $id --accept-source-agreements --accept-package-agreements --silent | Out-Host
  Actualizar-Path
  return $true
}

function Version-Node {
  if (-not (Tiene 'node')) { return $null }
  try { return [version](& node -p 'process.versions.node') } catch { return $null }
}

function Puerto {
  $p = 3333
  $envFile = Join-Path $Raiz '.env'
  if (Test-Path -LiteralPath $envFile) {
    $linea = Get-Content -LiteralPath $envFile -Encoding UTF8 | Where-Object { $_ -match '^\s*PORT\s*=\s*(\d+)' } | Select-Object -First 1
    if ($linea -and $linea -match '(\d+)') { $p = [int]$Matches[1] }
  }
  return $p
}

function Responde($puerto) {
  try {
    $r = Invoke-RestMethod -Uri "http://127.0.0.1:$puerto/api/health" -TimeoutSec 2
    return $r.name -eq 'JARVIS'
  } catch { return $false }
}

function Parar-Jarvis {
  if (-not (Test-Path -LiteralPath $PidFile)) { return $false }
  $id = [int](Get-Content -LiteralPath $PidFile -Raw).Trim()
  $p = Get-Process -Id $id -ErrorAction SilentlyContinue
  if ($p -and $p.ProcessName -like 'node*') {
    Stop-Process -Id $id -Force
    $p.WaitForExit(5000) | Out-Null
  }
  Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
  return [bool]$p
}

# Script oculto que arranca JARVIS en segundo plano (sin ventana) y guarda el registro en data\jarvis.log
function Escribir-Arranque {
  $node = (Get-Command node).Source
  $comando = 'cmd /c ""' + $node + '" --disable-warning=ExperimentalWarning server\index.js >> data\jarvis.log 2>&1"'
  $vbs = @(
    "' JARVIS: arranca el dashboard en segundo plano. Lo crea instalar.ps1; si lo borras, JARVIS no arrancará solo.",
    'Set fso = CreateObject("Scripting.FileSystemObject")',
    'Set sh = CreateObject("WScript.Shell")',
    ('sh.CurrentDirectory = "' + $Raiz.Replace('"', '""') + '"'),
    'If fso.FileExists("data\jarvis.log") Then',
    '  If fso.GetFile("data\jarvis.log").Size > 5242880 Then fso.DeleteFile "data\jarvis.log"',
    'End If',
    ('sh.Run "' + $comando.Replace('"', '""') + '", 0, False')
  ) -join "`r`n"
  New-Item -ItemType Directory -Force -Path (Join-Path $Raiz 'data') | Out-Null
  # UTF-16 con BOM: Windows Script Host lo lee bien aunque la ruta tenga tildes o eñes
  Set-Content -LiteralPath $Oculto -Value $vbs -Encoding Unicode
}

function Arrancar-Jarvis($puerto) {
  if (Responde $puerto) { Ok "JARVIS ya estaba en marcha en http://localhost:$puerto"; return $true }
  if ($HayVbs) {
    Escribir-Arranque
    Start-Process -FilePath 'wscript.exe' -ArgumentList ('"' + $Oculto + '"')
  } elseif ($EsWindows) {
    Start-Process -FilePath (Join-Path $Raiz 'iniciar-jarvis.bat') -ArgumentList '--sin-navegador' -WorkingDirectory $Raiz -WindowStyle Minimized
  } else {
    New-Item -ItemType Directory -Force -Path (Join-Path $Raiz 'data') | Out-Null
    Start-Process -FilePath 'node' -ArgumentList '--disable-warning=ExperimentalWarning', 'server/index.js' -RedirectStandardOutput (Join-Path $Raiz 'data/jarvis.log') -RedirectStandardError (Join-Path $Raiz 'data/jarvis.err.log') | Out-Null
  }
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 750
    if (Responde $puerto) { Ok "JARVIS en marcha en http://localhost:$puerto"; return $true }
  }
  Aviso "JARVIS no responde todavía. Mira data\jarvis.log o ábrelo a mano con iniciar-jarvis.bat"
  return $false
}

function Rutas-Windows {
  $inicio = [Environment]::GetFolderPath('Startup')
  return @{
    Inicio = Join-Path $inicio 'JARVIS.vbs'
    InicioLnk = Join-Path $inicio 'JARVIS.lnk'
    Escritorio = Join-Path ([Environment]::GetFolderPath('Desktop')) 'JARVIS.lnk'
  }
}

Write-Host ''
Write-Host '  J A R V I S  ·  instalador para Windows' -ForegroundColor White
Write-Host "  Carpeta: $Raiz" -ForegroundColor DarkGray

# ---------- Modos rápidos ----------
if ($Parar) {
  if (Parar-Jarvis) { Ok 'JARVIS parado' } else { Aviso 'JARVIS no estaba en marcha' }
  exit 0
}
if ($Reiniciar) {
  Titulo 'Reiniciando JARVIS'
  Parar-Jarvis | Out-Null
  Start-Sleep -Milliseconds 500
  if (Arrancar-Jarvis (Puerto)) { exit 0 } else { exit 1 }
}
if ($Desinstalar) {
  Titulo 'Quitando JARVIS del arranque de Windows'
  Parar-Jarvis | Out-Null
  if ($EsWindows) {
    $r = Rutas-Windows
    foreach ($f in @($r.Inicio, $r.InicioLnk, $r.Escritorio, $Oculto)) { if (Test-Path -LiteralPath $f) { Remove-Item -LiteralPath $f -Force; Ok "Borrado $f" } }
  }
  Write-Host ''
  Write-Host '    Tus notas (vault), tu base de datos (data\) y tus claves (.env) siguen en su sitio.'
  Write-Host '    Para borrarlo todo, elimina esta carpeta y la del vault a mano.'
  exit 0
}

# ---------- 1. Node.js ----------
Titulo 'Node.js'
Actualizar-Path
$v = Version-Node
if (-not $v -or $v -lt $NodeMinimo) {
  if ($v) { Aviso "Tienes Node $v y JARVIS necesita $NodeMinimo o superior" }
  if ($EsWindows -and (Con-Winget 'OpenJS.NodeJS.LTS' 'Node.js LTS')) { $v = Version-Node }
}
if (-not $v -or $v -lt $NodeMinimo) { Fallo "Instala Node.js LTS desde https://nodejs.org y vuelve a ejecutar este instalador en una ventana nueva." }
Ok "Node $v"

# ---------- 2. Claude Code (el motor) ----------
Titulo 'Claude Code'
if (-not (Tiene 'claude')) {
  if ($EsWindows) {
    Write-Host '    Instalando Claude Code (instalador oficial)...'
    try { Invoke-Expression (Invoke-RestMethod -Uri 'https://claude.ai/install.ps1') } catch { Aviso "No he podido instalarlo: $($_.Exception.Message)" }
    Actualizar-Path
  }
}
if (Tiene 'claude') {
  Ok 'Claude Code instalado'
  if ($EsWindows) {
    $sinSesion = -not (Test-Path -LiteralPath (Join-Path $env:USERPROFILE '.claude.json')) -and -not (Test-Path -LiteralPath (Join-Path $env:USERPROFILE '.claude\.credentials.json'))
    if ($sinSesion) { Aviso 'Si aún no has iniciado sesión, abre una terminal, escribe claude y sigue los pasos (con tu cuenta Pro o Max).' }
  }
} else {
  Aviso 'Sin Claude Code el dashboard funciona, pero JARVIS no puede pensar. Instálalo con: irm https://claude.ai/install.ps1 | iex'
}

# ---------- 3. Obsidian (opcional) ----------
if ($EsWindows) {
  Titulo 'Obsidian'
  $obsidian = @("$env:LOCALAPPDATA\Programs\Obsidian\Obsidian.exe", "$env:ProgramFiles\Obsidian\Obsidian.exe") | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if (-not $obsidian -and $InstalarObsidian) { Con-Winget 'Obsidian.Obsidian' 'Obsidian' | Out-Null; $obsidian = Test-Path -LiteralPath "$env:LOCALAPPDATA\Programs\Obsidian\Obsidian.exe" }
  if ($obsidian) { Ok 'Obsidian instalado' } else { Aviso 'No tienes Obsidian (opcional, para ver tus notas). Descárgalo de https://obsidian.md o vuelve a ejecutar con -InstalarObsidian' }
}

# ---------- 4. Dependencias e interfaz ----------
Titulo 'Dependencias'
if (Parar-Jarvis) { Write-Host '    (He parado JARVIS para actualizarlo)' }
& $Npm install --no-audit --no-fund --no-update-notifier --loglevel=error
if ($LASTEXITCODE -ne 0) { Fallo 'npm install ha fallado (mira el mensaje de arriba). Comprueba tu conexión y vuelve a intentarlo.' }
Ok 'Dependencias instaladas'

Titulo 'Interfaz'
& $Npm run build --silent | Out-Null
if ($LASTEXITCODE -ne 0) { Fallo 'No he podido preparar la interfaz (npm run build).' }
Ok 'Interfaz preparada'

# ---------- 5. Configuración, vault y base de datos ----------
Titulo 'Vault y datos'
$documentos = [Environment]::GetFolderPath('MyDocuments')
if (-not $documentos) { $documentos = Join-Path $HOME 'Documents' }
$info = (& node --disable-warning=ExperimentalWarning scripts/preparar.js --documentos $documentos) | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $info) { Fallo 'No he podido crear el vault o la base de datos.' }
if ($info.vaultNuevo) { Ok "Vault creado en $($info.vault)" } else { Ok "Vault: $($info.vault)" }
Ok "Base de datos: $($info.db)"
$puerto = [int]$info.port

# ---------- 6. Arranque con Windows y acceso directo ----------
if ($EsWindows) {
  Titulo 'Arranque y acceso directo'
  $r = Rutas-Windows
  foreach ($f in @($r.Inicio, $r.InicioLnk)) { if (Test-Path -LiteralPath $f) { Remove-Item -LiteralPath $f -Force } }
  if ($SinAutoarranque) {
    Aviso 'Sin arranque automático: ábrelo con iniciar-jarvis.bat'
  } elseif ($HayVbs) {
    Escribir-Arranque
    Copy-Item -LiteralPath $Oculto -Destination $r.Inicio -Force
    Ok 'JARVIS arrancará solo (en segundo plano) al iniciar sesión en Windows'
  } else {
    $lnk = (New-Object -ComObject WScript.Shell).CreateShortcut($r.InicioLnk)
    $lnk.TargetPath = Join-Path $Raiz 'iniciar-jarvis.bat'
    $lnk.Arguments = '--sin-navegador'
    $lnk.WorkingDirectory = $Raiz
    $lnk.WindowStyle = 7
    $lnk.IconLocation = (Join-Path $Raiz 'assets\jarvis.ico') + ',0'
    $lnk.Save()
    Ok 'JARVIS arrancará solo (minimizado) al iniciar sesión en Windows'
  }
  try {
    # Acceso directo que abre el dashboard en tu navegador, con el icono de JARVIS
    $lnk = (New-Object -ComObject WScript.Shell).CreateShortcut($r.Escritorio)
    $lnk.TargetPath = Join-Path $env:WINDIR 'explorer.exe'
    $lnk.Arguments = "http://localhost:$puerto/"
    $lnk.IconLocation = (Join-Path $Raiz 'assets\jarvis.ico') + ',0'
    $lnk.Description = 'JARVIS · Sistema Operativo de IA'
    $lnk.Save()
    Ok 'Acceso directo "JARVIS" en el escritorio'
  } catch { Aviso "No he podido crear el acceso directo: $($_.Exception.Message)" }
}

# ---------- 7. Arrancar y revisar ----------
$enMarcha = $false
if (-not $SinArrancar) {
  Titulo 'Arrancando JARVIS'
  $enMarcha = Arrancar-Jarvis $puerto
}

Titulo 'Revisión'
& node --disable-warning=ExperimentalWarning scripts/doctor.js
$esencialOk = $LASTEXITCODE -eq 0

if ($enMarcha -and $EsWindows) { Start-Process "http://localhost:$puerto/" }

Write-Host '  Siguientes pasos:' -ForegroundColor White
Write-Host '   1. Tus claves (ElevenLabs, Meta…): abre PowerShell en esta carpeta y ejecuta  npm run claves'
Write-Host '      y después  powershell -ExecutionPolicy Bypass -File instalar.ps1 -Reiniciar'
Write-Host '   2. Instagram y Meta Ads: docs\INSTAGRAM.md y docs\META-ADS.md'
Write-Host '   3. JARVIS en el móvil (Telegram): docs\HERMES.md'
Write-Host ''
if (-not $esencialOk) { exit 1 }
