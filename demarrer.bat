@echo off
rem ---------------------------------------------------------------------------
rem  IRTS Suite — demarrage sur Windows
rem
rem  Double-cliquez ce fichier. Il installe ce qu'il faut la premiere fois,
rem  construit l'application si necessaire, demarre le serveur partage et ouvre
rem  le navigateur. Les fois suivantes, il demarre directement.
rem
rem  Pour arreter : fermez cette fenetre, ou Ctrl+C.
rem ---------------------------------------------------------------------------
setlocal
cd /d "%~dp0"
if "%PORT%"=="" set PORT=8080

echo.
echo   IRTS Suite - Maree Sonore . MSR . Owlaris
echo   -----------------------------------------
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo   Node.js n'est pas installe sur cet ordinateur.
  echo.
  echo   Installez-le depuis https://nodejs.org ^(version 20 ou plus recente^),
  echo   puis double-cliquez a nouveau ce fichier.
  echo.
  pause
  exit /b 1
)

for /f "delims=" %%V in ('node -p "process.versions.node.split('.')[0]"') do set NODEMAJOR=%%V
if %NODEMAJOR% LSS 20 (
  echo   Node.js est trop ancien : il faut la version 20 ou plus.
  echo   Mettez-le a jour depuis https://nodejs.org, puis relancez.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo   Premiere installation, cela prend une minute...
  call npm install --no-audit --no-fund
  if errorlevel 1 ( echo   L'installation a echoue. & pause & exit /b 1 )
  echo.
)

if not exist dist\index.html (
  echo   Construction de l'application...
  call npm run build
  if errorlevel 1 ( echo   La construction a echoue. & pause & exit /b 1 )
  echo.
)

rem Le navigateur s'ouvre pendant que le serveur demarre.
start "" /b cmd /c "timeout /t 3 >nul & start http://localhost:%PORT%"

node server\index.js
pause
