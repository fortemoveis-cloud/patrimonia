@echo off
title PatrimonIA - Iniciando...
color 0A
echo.
echo  ==========================================
echo   Iniciando PatrimonIA... aguarde
echo  ==========================================
echo.

echo  [1/4] Iniciando backend (FastAPI)...
start "PatrimonIA - Backend" cmd /k "cd /d C:\Users\forte\projetos\gestor-financeiro\backend && .\.venv\Scripts\uvicorn main:app --port 8000"

echo  Aguardando backend inicializar...
timeout /t 3 /nobreak >nul

echo  [2/4] Iniciando frontend (React)...
start "PatrimonIA - Frontend" cmd /k "cd /d C:\Users\forte\projetos\gestor-financeiro\frontend && npm run dev"

echo  Aguardando frontend inicializar...
timeout /t 4 /nobreak >nul

echo  [3/4] Abrindo navegador...
start "" "http://localhost:5173"

echo.
echo  [4/4] PatrimonIA iniciada com sucesso!
echo.
echo  Backend : http://localhost:8000
echo  Frontend: http://localhost:5173
echo.
timeout /t 3 /nobreak >nul
exit
