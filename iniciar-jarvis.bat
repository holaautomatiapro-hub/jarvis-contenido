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

if not exist node_modules (
  echo [JARVIS] Instalando dependencias por primera vez...
  call npm install || goto :error
)

if not exist web\dist\index.html (
  echo [JARVIS] Preparando la interfaz...
  call npm run build || goto :error
)

if not exist .env copy .env.example .env >nul

if /i not "%~1"=="--sin-navegador" start "" http://localhost:3333
node --disable-warning=ExperimentalWarning server\index.js
goto :eof

:error
echo [JARVIS] Algo ha fallado. Revisa el mensaje de arriba.
pause
exit /b 1
