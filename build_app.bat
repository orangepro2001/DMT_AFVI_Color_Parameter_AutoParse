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
rem   build_app.bat check        quick validation: frontend build + cargo check (all crates)
rem   build_app.bat agent        build the per-site LAN agent (dmt-agent.exe)
rem   build_app.bat clean        remove the Rust target directories (sccache keeps dep cache)
rem   build_app.bat stats        show sccache cache statistics
rem   /fresh as any argument     force a clean npm ci (wipes node_modules)

set "MODE=build"
set "FRESH="
set "AGENT_TOKEN="
:parse_args
if "%~1"=="" goto args_done
if /I "%~1"=="--token" (set "AGENT_TOKEN=%~2" & shift & shift & goto parse_args)
if /I "%~1"=="/fresh" (set "FRESH=1") else if /I "%~1"=="build" (set "MODE=build") else if /I "%~1"=="dev" (set "MODE=dev") else if /I "%~1"=="check" (set "MODE=check") else if /I "%~1"=="agent" (set "MODE=agent") else if /I "%~1"=="clean" (set "MODE=clean") else if /I "%~1"=="stats" (set "MODE=stats") else if "%MODE%"=="agent" if not defined AGENT_TOKEN (set "AGENT_TOKEN=%~1") else (
    echo [ERROR] Unknown argument "%~1".
    echo Usage: build_app.bat [build^|dev^|check^|agent^|clean^|stats] [/fresh] [--token ^<token^>]
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
if /I "%MODE%"=="agent" goto :agent
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
echo [3/3] Quick validation: frontend build + cargo check (app, core, agent)...
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
    echo [ERROR] cargo check failed (app).
    popd
    goto :fail
)
popd
pushd "%ROOT%dmt-copy-core"
call cargo check
if %errorlevel% neq 0 (
    echo [ERROR] cargo check failed (dmt-copy-core).
    popd
    goto :fail
)
popd
pushd "%ROOT%dmt-agent"
call cargo check
if %errorlevel% neq 0 (
    echo [ERROR] cargo check failed (dmt-agent).
    popd
    goto :fail
)
popd
echo.
echo CHECK SUCCESSFUL - frontend and all Rust crates compile cleanly.
goto :end_report

:agent
rem AGENT_TOKEN was parsed from the command line (`agent <token>` or `agent --token <token>`).
echo.
echo [agent] Building the per-site LAN agent (dmt-agent.exe, release)...
pushd "%ROOT%dmt-agent"
call cargo build --release
if %errorlevel% neq 0 (
    echo [ERROR] Agent build failed.
    popd
    goto :fail
)
popd
if not defined AGENT_TOKEN goto :agent_hint

set "AGENT_OUT=%ROOT%dmt-agent\target\release"
rem the script bodies are written with append redirects - clear leftovers from previous builds first
del "%AGENT_OUT%\install_service.bat" 2>nul
del "%AGENT_OUT%\uninstall_service.bat" 2>nul
> "%AGENT_OUT%\agent.json" echo { "port": 3777, "token": "%AGENT_TOKEN%" }
>> "%AGENT_OUT%\install_service.bat" echo @echo off
>> "%AGENT_OUT%\install_service.bat" echo rem One-click install: registers dmt-agent as a boot-start task (SYSTEM, hidden window).
>> "%AGENT_OUT%\install_service.bat" echo rem Run this script as Administrator AFTER copying the whole folder to the site host.
>> "%AGENT_OUT%\install_service.bat" echo set "DIR=%%~dp0"
>> "%AGENT_OUT%\install_service.bat" echo net session ^>nul 2^>^&1
>> "%AGENT_OUT%\install_service.bat" echo if errorlevel 1 goto not_admin
>> "%AGENT_OUT%\install_service.bat" echo if not exist "%%DIR%%dmt-agent.exe" goto no_exe
>> "%AGENT_OUT%\install_service.bat" echo if not exist "%%DIR%%agent.json" goto no_json
>> "%AGENT_OUT%\install_service.bat" echo rem stop and remove any previous registration first
>> "%AGENT_OUT%\install_service.bat" echo schtasks /End /TN dmt-agent ^>nul 2^>^&1
>> "%AGENT_OUT%\install_service.bat" echo taskkill /f /im dmt-agent.exe ^>nul 2^>^&1
>> "%AGENT_OUT%\install_service.bat" echo schtasks /Create /F /TN "dmt-agent" /SC ONSTART /RU SYSTEM /RL HIGHEST /TR "\"%%DIR%%dmt-agent.exe\""
>> "%AGENT_OUT%\install_service.bat" echo if errorlevel 1 goto create_failed
>> "%AGENT_OUT%\install_service.bat" echo schtasks /Run /TN "dmt-agent"
>> "%AGENT_OUT%\install_service.bat" echo if errorlevel 1 goto run_failed
>> "%AGENT_OUT%\install_service.bat" echo echo [OK] dmt-agent registered and started. It auto-starts at boot, no visible window.
>> "%AGENT_OUT%\install_service.bat" echo pause
>> "%AGENT_OUT%\install_service.bat" echo exit /b 0
>> "%AGENT_OUT%\install_service.bat" echo :not_admin
>> "%AGENT_OUT%\install_service.bat" echo echo [ERROR] Please run this script as Administrator.
>> "%AGENT_OUT%\install_service.bat" echo pause
>> "%AGENT_OUT%\install_service.bat" echo exit /b 1
>> "%AGENT_OUT%\install_service.bat" echo :no_exe
>> "%AGENT_OUT%\install_service.bat" echo echo [ERROR] dmt-agent.exe not found next to this script.
>> "%AGENT_OUT%\install_service.bat" echo pause
>> "%AGENT_OUT%\install_service.bat" echo exit /b 1
>> "%AGENT_OUT%\install_service.bat" echo :no_json
>> "%AGENT_OUT%\install_service.bat" echo echo [ERROR] agent.json not found next to this script.
>> "%AGENT_OUT%\install_service.bat" echo pause
>> "%AGENT_OUT%\install_service.bat" echo exit /b 1
>> "%AGENT_OUT%\install_service.bat" echo :create_failed
>> "%AGENT_OUT%\install_service.bat" echo echo [ERROR] Could not create the scheduled task - check Task Scheduler policy.
>> "%AGENT_OUT%\install_service.bat" echo pause
>> "%AGENT_OUT%\install_service.bat" echo exit /b 1
>> "%AGENT_OUT%\install_service.bat" echo :run_failed
>> "%AGENT_OUT%\install_service.bat" echo echo [WARN] Task registered, but the immediate start failed - it will start at next boot.
>> "%AGENT_OUT%\install_service.bat" echo pause
>> "%AGENT_OUT%\install_service.bat" echo exit /b 1
> "%AGENT_OUT%\uninstall_service.bat" echo @echo off
>> "%AGENT_OUT%\uninstall_service.bat" echo rem One-click uninstall: stops the running agent and removes the boot-start task.
>> "%AGENT_OUT%\uninstall_service.bat" echo rem Run this script as Administrator.
>> "%AGENT_OUT%\uninstall_service.bat" echo net session ^>nul 2^>^&1
>> "%AGENT_OUT%\uninstall_service.bat" echo if errorlevel 1 goto not_admin
>> "%AGENT_OUT%\uninstall_service.bat" echo schtasks /End /TN dmt-agent ^>nul 2^>^&1
>> "%AGENT_OUT%\uninstall_service.bat" echo taskkill /f /im dmt-agent.exe ^>nul 2^>^&1
>> "%AGENT_OUT%\uninstall_service.bat" echo schtasks /Delete /TN dmt-agent /F
>> "%AGENT_OUT%\uninstall_service.bat" echo echo [OK] dmt-agent stopped and unregistered.
>> "%AGENT_OUT%\uninstall_service.bat" echo pause
>> "%AGENT_OUT%\uninstall_service.bat" echo exit /b 0
>> "%AGENT_OUT%\uninstall_service.bat" echo :not_admin
>> "%AGENT_OUT%\uninstall_service.bat" echo echo [ERROR] Please run this script as Administrator.
>> "%AGENT_OUT%\uninstall_service.bat" echo pause
>> "%AGENT_OUT%\uninstall_service.bat" echo exit /b 1
echo.
echo ========================================================
echo AGENT BUILD SUCCESSFUL!
echo ========================================================
echo.
echo Generated in dmt-agent\target\release\:
echo - dmt-agent.exe          the agent binary
echo - agent.json             port 3777, token "%AGENT_TOKEN%"
echo - install_service.bat    copy folder to site host, run as Administrator once
echo - uninstall_service.bat  stops the agent and removes the boot-start task
goto :end_report

:agent_hint
echo.
echo ========================================================
echo AGENT BUILD SUCCESSFUL!
echo ========================================================
echo.
echo Binary: dmt-agent\target\release\dmt-agent.exe
echo No token given - agent.json and the service scripts were NOT generated.
echo Re-run with a token to generate them:
echo   build_app.bat agent my-secret-token
goto :end_report

:clean
echo.
echo Removing Rust target directories (compiled deps stay in sccache)...
if exist "%SRC_DIR%\target" rmdir /s /q "%SRC_DIR%\target"
if exist "%SRC_DIR%\target" (
    echo [ERROR] Could not fully remove %SRC_DIR%\target - a process may lock it.
    exit /b 1
)
if exist "%ROOT%dmt-copy-core\target" rmdir /s /q "%ROOT%dmt-copy-core\target"
if exist "%ROOT%dmt-agent\target" rmdir /s /q "%ROOT%dmt-agent\target"
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
