@echo off
title JARVIS
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [JARVIS] No encuentro Node.js. Instalalo desde https://nodejs.org ^(version LTS^) y vuelve a abrir este archivo.
  pause
  exit /b 1
)

node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=5)?0:1)"
if errorlevel 1 (
  echo [JARVIS] Tu version de Node.js es antigua: JARVIS necesita la 22.5 o superior. Ejecuta instalar.ps1 o instala la LTS desde https://nodejs.org
  pause
  exit /b 1
)

rem Si JARVIS ya esta en marcha, solo abre el dashboard (asi el acceso directo sirve para todo)
for /f "delims=" %%u in ('node scripts\en-marcha.js --url') do set "JARVIS_URL=%%u"
if not defined JARVIS_URL set "JARVIS_URL=http://localhost:3333/"
if exist node_modules (
  node scripts\en-marcha.js
  if not errorlevel 1 goto :abrir
)

if not exist node_modules (
  echo [JARVIS] Instalando dependencias por primera vez...
  call npm install || goto :error
)

if not exist web\dist\index.html (
  echo [JARVIS] Preparando la interfaz...
  call npm run build || goto :error
)

if not exist .env copy .env.example .env >nul

if /i not "%~1"=="--sin-navegador" start "" "%JARVIS_URL%"
echo.
echo  [JARVIS] En marcha en %JARVIS_URL%  -  Minimiza esta ventana, no la cierres: si la cierras, JARVIS se para.
echo.
node --disable-warning=ExperimentalWarning server\index.js
goto :eof

:abrir
if /i not "%~1"=="--sin-navegador" start "" "%JARVIS_URL%"
exit /b 0

:error
echo [JARVIS] Algo ha fallado. Revisa el mensaje de arriba.
pause
exit /b 1
