@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul
title HE THONG PHIEU YEU CAU CHI - v3.4

rem ===========================================================================
rem  Khoi dong toan bo he thong: PostgreSQL -> Backend (NestJS) -> Frontend.
rem
rem    start.bat          Khoi dong binh thuong (dung hang ngay)
rem    start.bat setup    Cai dependencies + tao schema + nap du lieu mau
rem    start.bat reset    XOA SACH database roi dung lai tu dau (hoi xac nhan)
rem    start.bat stop     Tat backend va frontend dang chay
rem ===========================================================================

cd /d "%~dp0"
set "ROOT=%CD%"
set "API=%ROOT%\apps\api"
set "BACKEND_PORT=3000"
set "FRONTEND_PORT=5173"

if /i "%~1"=="stop"  goto :stop
if /i "%~1"=="reset" goto :reset
if /i "%~1"=="setup" set "DO_SETUP=1"

echo.
echo ==========================================================
echo   HE THONG PHIEU YEU CAU CHI - Workflow v3.4
echo ==========================================================
echo.

rem --- 1. Kiem tra Node.js ---------------------------------------------------
where node >nul 2>&1
if errorlevel 1 (
  echo [LOI] Khong tim thay Node.js. Cai dat tai https://nodejs.org roi chay lai.
  goto :fail
)
for /f "delims=" %%v in ('node -v') do set "NODEV=%%v"
echo [1/6] Node.js %NODEV%

rem --- 2. Kiem tra file .env -------------------------------------------------
if not exist "%ROOT%\.env" (
  echo [LOI] Thieu file .env tai %ROOT%
  echo       Can co DATABASE_URL va JWT_SECRET.
  goto :fail
)
echo [2/6] Da co file .env

rem --- 3. Kiem tra PostgreSQL dang chay --------------------------------------
set "PGOK="
for /f %%p in ('powershell -NoProfile -Command "(Get-NetTCPConnection -State Listen -LocalPort 5432 -ErrorAction SilentlyContinue | Measure-Object).Count" 2^>nul') do set "PGOK=%%p"
if "%PGOK%"=="0" (
  echo [3/6] PostgreSQL chua chay - dang thu khoi dong dich vu...
  powershell -NoProfile -Command "Get-Service -Name '*postgres*' -ErrorAction SilentlyContinue | Start-Service -ErrorAction SilentlyContinue" >nul 2>&1
  call :sleep 4
  for /f %%p in ('powershell -NoProfile -Command "(Get-NetTCPConnection -State Listen -LocalPort 5432 -ErrorAction SilentlyContinue | Measure-Object).Count" 2^>nul') do set "PGOK=%%p"
  if "!PGOK!"=="0" (
    echo       [LOI] Khong khoi dong duoc PostgreSQL o cong 5432.
    echo             Mo Services.msc va bat dich vu postgresql thu cong roi chay lai.
    goto :fail
  )
)
echo [3/6] PostgreSQL dang chay o cong 5432

rem --- 4. Cai dependencies neu thieu -----------------------------------------
if not exist "%ROOT%\node_modules" set "DO_SETUP=1"
if not exist "%API%\node_modules" set "DO_SETUP=1"

if defined DO_SETUP (
  echo [4/6] Cai dat dependencies ^(chi lam lan dau, mat vai phut^)...
  call npm install --no-audit --no-fund || goto :fail
  pushd "%API%"
  call npm install --no-audit --no-fund || (popd & goto :fail)
  echo       Sinh Prisma Client...
  call npx prisma generate || (popd & goto :fail)
  echo       Tao schema trong PostgreSQL...
  call npm run db:push || (popd & goto :fail)
  echo       Nap phong ban va tai khoan...
  call npm run db:seed || (popd & goto :fail)
  popd
) else (
  echo [4/6] Dependencies da san sang
)

rem --- 5. Bat backend --------------------------------------------------------
call :freePort %BACKEND_PORT%
echo [5/6] Khoi dong Backend ^(NestJS + Prisma^) o cong %BACKEND_PORT%...
start "Backend - Phieu yeu cau chi" cmd /k "cd /d ""%API%"" && npx ts-node src/main.ts"

echo       Cho backend san sang...
set "READY="
for /l %%i in (1,1,40) do (
  if not defined READY (
    call :sleep 2
    for /f %%c in ('powershell -NoProfile -Command "try { (Invoke-WebRequest -Uri 'http://127.0.0.1:%BACKEND_PORT%/api/v1/departments' -UseBasicParsing -TimeoutSec 3).StatusCode } catch { if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 } }" 2^>nul') do (
      if not "%%c"=="0" set "READY=%%c"
    )
  )
)
if not defined READY (
  echo       [LOI] Backend khong phan hoi. Xem cua so "Backend" de biet loi.
  goto :fail
)
echo       Backend OK ^(HTTP %READY% - 401 la dung, API yeu cau dang nhap^)

rem --- 6. Bat frontend -------------------------------------------------------
call :freePort %FRONTEND_PORT%
echo [6/6] Khoi dong Frontend ^(Vite^) o cong %FRONTEND_PORT%...
start "Frontend - Phieu yeu cau chi" cmd /k "cd /d ""%ROOT%"" && npm run dev -- --port %FRONTEND_PORT% --strictPort --host 127.0.0.1"

echo       Cho frontend san sang...
set "FREADY="
for /l %%i in (1,1,45) do (
  if not defined FREADY (
    call :sleep 2
    for /f %%c in ('powershell -NoProfile -Command "try { (Invoke-WebRequest -Uri 'http://127.0.0.1:%FRONTEND_PORT%/' -UseBasicParsing -TimeoutSec 3).StatusCode } catch { 0 }" 2^>nul') do (
      if "%%c"=="200" set "FREADY=1"
    )
  )
)
if not defined FREADY (
  echo       [LOI] Frontend khong phan hoi sau 90 giay.
      Xem cua so "Frontend - Phieu yeu cau chi" de biet loi cu the.
      Thuong gap: cong %FRONTEND_PORT% bi chiem, hoac thieu node_modules (chay: start.bat setup).
  goto :fail
)

echo.
echo ==========================================================
echo   HE THONG DA SAN SANG
echo ==========================================================
echo.
echo   Giao dien   : http://localhost:%FRONTEND_PORT%
echo   API         : http://localhost:%BACKEND_PORT%/api/v1
echo   Database    : PostgreSQL (localhost:5432)
echo.
echo   Mat khau chung: Password@123
echo   Kiem tra badge "PostgreSQL" mau xanh o goc phai man hinh
echo   de chac chan dang ghi that vao database.
echo.
echo   De tat: chay  start.bat stop
echo.
start "" "http://localhost:%FRONTEND_PORT%"
echo Nhan phim bat ky de dong cua so nay (backend va frontend van chay)...
pause >nul
exit /b 0

rem ===========================================================================
rem  Tien ich
rem ===========================================================================

:sleep
ping -n %1 127.0.0.1 >nul 2>&1
exit /b 0

:freePort
rem Tat tien trinh dang giu cong %1 de tranh loi "port in use"
powershell -NoProfile -Command "Get-NetTCPConnection -State Listen -LocalPort %1 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" >nul 2>&1
exit /b 0

:stop
echo Dang tat backend (cong %BACKEND_PORT%) va frontend (cong %FRONTEND_PORT%)...
call :freePort %BACKEND_PORT%
call :freePort %FRONTEND_PORT%
echo Da tat. PostgreSQL van chay binh thuong.
call :sleep 2
exit /b 0

:reset
echo.
echo  *** CANH BAO ***
echo  Thao tac nay XOA TOAN BO du lieu trong database roi tao lai tu dau.
echo  Moi phieu, nguoi dung va lich su da nhap se mat vinh vien.
echo.
set /p "CONFIRM=Go chinh xac  XOA  roi Enter de tiep tuc: "
if /i not "%CONFIRM%"=="XOA" (
  echo Da huy, khong thay doi gi.
  call :sleep 3
  exit /b 0
)
pushd "%API%"
call npm run db:reset || (popd & goto :fail)
call npm run db:seed  || (popd & goto :fail)
popd
echo.
echo Da dung lai database rong (chi co phong ban + tai khoan). Chay  start.bat  de bat he thong.
pause
exit /b 0

:fail
echo.
echo ==========================================================
echo   KHOI DONG THAT BAI - xem thong bao loi o tren
echo ==========================================================
echo.
pause
exit /b 1
