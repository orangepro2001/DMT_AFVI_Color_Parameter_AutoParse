@echo off
setlocal EnableExtensions
rem The project root is wherever .vfox.toml lives - the script works no matter
rem which directory it is invoked from (or copied into), by walking up from its
rem own location until the marker file is found.
set "ROOT=%~dp0"
if exist "%ROOT%.vfox.toml" goto :root_found
for /f "delims=" %%i in ('powershell -NoProfile -Command "$d=(Get-Item '%~f0').Directory; while($d -and -not (Test-Path (Join-Path $d.FullName '.vfox.toml'))){$d=$d.Parent}; if($d){$d.FullName}"') do set "ROOT=%%i\"
:root_found
if not exist "%ROOT%.vfox.toml" (
    echo [ERROR] Cannot locate .vfox.toml in any parent of the script - place build_app.bat inside the project tree.
    exit /b 1
)
set "APP_DIR=%ROOT%tauri-app"
set "SRC_DIR=%APP_DIR%\src-tauri"
set "EXPECTED_NODE=v24.11.1"
set "EXPECTED_RUST=rustc 1.91.1"

rem Usage:
rem   build_app.bat              full production build (default)
rem   build_app.bat dev          run the app in dev mode (hot reload, fast incremental)
rem   build_app.bat check        quick validation: Angular build + cargo check
rem   build_app.bat clean        remove the Rust target directory (sccache keeps dep cache)
rem   build_app.bat stats        show sccache cache statistics
rem   /fresh as any argument     force a clean npm ci (wipes node_modules)

set "MODE=build"
set "FRESH="
:parse_args
if "%~1"=="" goto args_done
if /I "%~1"=="/fresh" (set "FRESH=1") else if /I "%~1"=="build" (set "MODE=build") else if /I "%~1"=="dev" (set "MODE=dev") else if /I "%~1"=="check" (set "MODE=check") else if /I "%~1"=="clean" (set "MODE=clean") else if /I "%~1"=="stats" (set "MODE=stats") else (
    echo [ERROR] Unknown argument "%~1".
    echo Usage: build_app.bat [build^|dev^|check^|clean^|stats] [/fresh]
    exit /b 2
)
shift
goto parse_args
:args_done

echo ========================================================
echo AFVI Color Parameter AutoParse - Build Script (%MODE%)
echo ========================================================

echo.
echo [1] Checking locked toolchain...
if not exist "%ROOT%.vfox.toml" (
    echo [ERROR] Missing .vfox.toml.
    exit /b 1
)
where vfox >nul 2>&1
if %errorlevel% neq 0 (
    echo [WARNING] vfox was not found. Checking the active toolchain directly.
) else (
    echo vfox detected. Project versions are pinned in .vfox.toml.
)
for /f "delims=" %%i in ('node --version') do set "ACTIVE_NODE=%%i"
if /I not "%ACTIVE_NODE%"=="%EXPECTED_NODE%" (
    echo [ERROR] Node.js %EXPECTED_NODE% is required, found %ACTIVE_NODE%.
    exit /b 1
)
rustc --version | findstr /B /C:"%EXPECTED_RUST%" >nul
if %errorlevel% neq 0 (
    echo [ERROR] Rust %EXPECTED_RUST% is required.
    exit /b 1
)
echo Toolchain OK: %ACTIVE_NODE% and Rust 1.91.1

echo.
echo [2] Rust acceleration status...
where sccache >nul 2>&1
if %errorlevel% neq 0 (
    echo [WARNING] sccache not found - dep caching disabled. Install it with: scoop install sccache
) else (
    echo sccache: enabled as rustc wrapper (.cargo\config.toml^), rust-lld linker active.
    if /I not "%MODE%"=="stats" sccache --zero-stats >nul 2>&1
)
echo Build started at %DATE% %TIME%

if /I "%MODE%"=="stats" goto :stats
if /I "%MODE%"=="clean" goto :clean
if /I "%MODE%"=="dev" goto :dev
if /I "%MODE%"=="check" goto :check
goto :build

:install_deps
echo.
echo [deps] Installing locked frontend dependencies...
if exist "%APP_DIR%\node_modules" if not defined FRESH (
    echo [deps] node_modules already present - skipping npm ci. Use /fresh to force reinstall.
    goto :eof
)
pushd "%APP_DIR%"
call npm ci
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install locked npm dependencies.
    popd
    popd
    exit /b %errorlevel%
)
popd
goto :eof

:build
call :install_deps
if %errorlevel% neq 0 exit /b %errorlevel%
echo.
echo [3/3] Building Tauri executable and installers (Angular build included^)...
pushd "%APP_DIR%"
call npm run tauri build
if %errorlevel% neq 0 (
    echo [ERROR] Tauri build failed.
    popd
    goto :fail
)
popd
goto :success

:dev
call :install_deps
if %errorlevel% neq 0 exit /b %errorlevel%
echo.
echo [dev] Starting Tauri dev mode (first Rust build takes a few minutes; afterwards only changed code recompiles)...
pushd "%APP_DIR%"
call npm run tauri dev
set "DEV_EXIT=%errorlevel%"
popd
if %DEV_EXIT% neq 0 (
    echo [ERROR] Tauri dev exited with code %DEV_EXIT%.
    goto :fail
)
echo.
echo Dev session ended.
goto :end_report

:check
call :install_deps
if %errorlevel% neq 0 exit /b %errorlevel%
echo.
echo [3/3] Quick validation: Angular build + cargo check...
pushd "%APP_DIR%"
call npm run build
if %errorlevel% neq 0 (
    echo [ERROR] Frontend build failed.
    popd
    goto :fail
)
popd
pushd "%SRC_DIR%"
call cargo check
if %errorlevel% neq 0 (
    echo [ERROR] cargo check failed.
    popd
    goto :fail
)
popd
echo.
echo CHECK SUCCESSFUL - frontend and Rust compile cleanly.
goto :end_report

:clean
echo.
echo Removing Rust target directory (compiled deps stay in sccache)...
if exist "%SRC_DIR%\target" rmdir /s /q "%SRC_DIR%\target"
if exist "%SRC_DIR%\target" (
    echo [ERROR] Could not fully remove %SRC_DIR%\target - a process may lock it.
    exit /b 1
)
echo Clean done.
goto :end_report

:stats
echo.
echo sccache cache statistics:
sccache --show-stats
goto :end_report

:success
echo.
echo ========================================================
echo BUILD SUCCESSFUL!
echo ========================================================
echo.
echo Your executable files are located at:
echo - Standalone EXE: tauri-app\src-tauri\target\release\AFVI_Parse.exe
echo - MSI Installer: tauri-app\src-tauri\target\release\bundle\msi\AFVI_Parse_0.1.0_x64_en-US.msi
echo - NSIS Installer: tauri-app\src-tauri\target\release\bundle\nsis\AFVI_Parse_0.1.0_x64-setup.exe
goto :end_report

:fail
echo.
echo ========================================================
echo BUILD FAILED
echo ========================================================
echo Build ended at %DATE% %TIME%
endlocal
exit /b 1

:end_report
where sccache >nul 2>&1
if %errorlevel% equ 0 if /I not "%MODE%"=="stats" (
    echo.
    echo sccache for this run:
    sccache --show-stats | findstr /C:"Cache hits" /C:"Cache misses" /C:"Cache size"
)
echo Build ended at %DATE% %TIME%
endlocal
exit /b 0
