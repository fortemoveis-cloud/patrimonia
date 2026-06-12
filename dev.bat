@echo off
title PatrimonIA - Modo Desenvolvimento
color 0B
echo.
echo  ==========================================
echo   PatrimonIA - Modo Desenvolvimento
echo  ==========================================
echo.

echo  [1/3] Iniciando backend com hot-reload...
start "PatrimonIA - Backend (dev)" cmd /k "cd /d C:\Users\forte\projetos\gestor-financeiro\backend && .\.venv\Scripts\uvicorn main:app --reload --port 8000"

echo  Aguardando backend inicializar...
timeout /t 3 /nobreak >nul

echo  [2/3] Iniciando frontend (Vite dev server)...
start "PatrimonIA - Frontend (dev)" cmd /k "cd /d C:\Users\forte\projetos\gestor-financeiro\frontend && npm run dev"

echo  Aguardando frontend inicializar...
timeout /t 4 /nobreak >nul

echo  [3/3] Abrindo navegador...
start "" "http://localhost:5173"

echo.
echo  Modo dev ativo!
echo.
echo  Backend : http://localhost:8000  (hot-reload ativo)
echo  Frontend: http://localhost:5173  (HMR ativo)
echo  API Docs: http://localhost:8000/docs
echo.
timeout /t 3 /nobreak >nul
exit
