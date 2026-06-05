@echo off
setlocal EnableDelayedExpansion
chcp 65001 > nul

echo.
echo ============================================================
echo   PatrimonIA - Build Completo v1.0.0
echo ============================================================

REM ── Verificar pré-requisitos ──────────────────────────────────
where python >nul 2>&1 || (
    echo [ERRO] Python nao encontrado no PATH.
    echo        Instale Python 3.12 em https://python.org
    pause & exit /b 1
)
where node >nul 2>&1 || (
    echo [ERRO] Node.js nao encontrado no PATH.
    echo        Instale Node.js em https://nodejs.org
    pause & exit /b 1
)
where npm >nul 2>&1 || (
    echo [ERRO] npm nao encontrado no PATH.
    pause & exit /b 1
)

REM ── Verificar ícone ───────────────────────────────────────────
if not exist "electron\assets\icon.ico" (
    echo.
    echo [AVISO] electron\assets\icon.ico nao encontrado!
    echo         Para gerar o instalador com icone personalizado:
    echo           1. Salve seu logo em electron\assets\icon.ico (256x256 pixels)
    echo           2. Salve tambem como electron\assets\icon.png
    echo         Para usar sem icone: edite electron\package.json
    echo         e remova as linhas "icon": "assets/icon.ico"
    echo.
    set /p CONTINUE="Continuar sem icone? (S/N): "
    if /I not "!CONTINUE!"=="S" (
        echo Build cancelado.
        pause & exit /b 1
    )
)

REM ── Criar pasta dist ─────────────────────────────────────────
if not exist "dist" mkdir dist

REM ═══════════════════════════════════════════════════════════════
echo.
echo [1/4] Compilando backend Python com PyInstaller...
echo ─────────────────────────────────────────────────
cd backend

REM Instalar PyInstaller no venv existente
echo     Instalando PyInstaller...
.\.venv\Scripts\pip.exe install pyinstaller --quiet
if !errorlevel! neq 0 (
    echo [ERRO] Falha ao instalar PyInstaller.
    cd ..
    pause & exit /b 1
)

REM Rodar PyInstaller com o spec
echo     Executando PyInstaller (pode demorar 2-5 min)...
.\.venv\Scripts\pyinstaller.exe patrimonia.spec --clean --noconfirm
if !errorlevel! neq 0 (
    echo [ERRO] Falha no PyInstaller! Veja o log acima.
    cd ..
    pause & exit /b 1
)

if not exist "dist\patrimonia-backend.exe" (
    echo [ERRO] patrimonia-backend.exe nao foi gerado.
    cd ..
    pause & exit /b 1
)

echo     Backend compilado: backend\dist\patrimonia-backend.exe
cd ..

REM ═══════════════════════════════════════════════════════════════
echo.
echo [2/4] Compilando frontend React...
echo ─────────────────────────────────────────────────
cd frontend

call npm install --silent
if !errorlevel! neq 0 (
    echo [ERRO] Falha no npm install do frontend.
    cd ..
    pause & exit /b 1
)

call npm run build
if !errorlevel! neq 0 (
    echo [ERRO] Falha no build do frontend.
    cd ..
    pause & exit /b 1
)

if not exist "dist\index.html" (
    echo [ERRO] frontend\dist\index.html nao foi gerado.
    cd ..
    pause & exit /b 1
)

echo     Frontend compilado: frontend\dist\
cd ..

REM ═══════════════════════════════════════════════════════════════
echo.
echo [3/4] Instalando dependencias Electron...
echo ─────────────────────────────────────────────────
cd electron

call npm install --silent
if !errorlevel! neq 0 (
    echo [ERRO] Falha no npm install do Electron.
    cd ..
    pause & exit /b 1
)

echo     Dependencias instaladas.

REM ═══════════════════════════════════════════════════════════════
echo.
echo [4/4] Gerando instalador Windows...
echo ─────────────────────────────────────────────────
echo     Aguarde — pode demorar 3-8 minutos...

call npm run build:installer
if !errorlevel! neq 0 (
    echo [ERRO] Falha no electron-builder! Veja o log acima.
    cd ..
    pause & exit /b 1
)
cd ..

REM ── Verificar saída ──────────────────────────────────────────
set INSTALLER=dist\PatrimonIA-Setup-1.0.0.exe
if not exist "!INSTALLER!" (
    REM electron-builder pode ter gerado com nome diferente
    for %%f in (dist\PatrimonIA-Setup-*.exe) do set INSTALLER=%%f
)

if not exist "!INSTALLER!" (
    echo [AVISO] Instalador nao encontrado em dist\
    echo         Verifique a pasta dist\ manualmente.
) else (
    echo.
    echo ============================================================
    echo   BUILD CONCLUIDO COM SUCESSO!
    echo.
    echo   Instalador gerado em:
    echo   !INSTALLER!
    echo.
    echo   Para distribuir: envie este arquivo .exe para os
    echo   beta testers. Eles instalam normalmente e os dados
    echo   ficam em %%APPDATA%%\PatrimonIA\
    echo ============================================================
)

echo.
pause
