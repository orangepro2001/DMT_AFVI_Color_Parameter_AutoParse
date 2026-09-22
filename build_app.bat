@echo off
setlocal EnableExtensions
set "ROOT=%~dp0"
set "APP_DIR=%ROOT%tauri-app"
set "EXPECTED_NODE=v24.11.1"
set "EXPECTED_RUST=rustc 1.91.1"

echo ========================================================
echo AFVI Color Parameter AutoParse - Build Script
echo ========================================================

echo.
echo [1/4] Checking locked toolchain...
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
echo [2/4] Installing locked frontend dependencies...
pushd "%APP_DIR%"
call npm ci
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install locked npm dependencies.
    popd
    exit /b %errorlevel%
)

echo.
echo [3/4] Validating Angular production build...
call npm run build
if %errorlevel% neq 0 (
    echo [ERROR] Frontend build failed.
    popd
    exit /b %errorlevel%
)

echo.
echo [4/4] Building Tauri executable and installers...
call npm run tauri build
if %errorlevel% neq 0 (
    echo [ERROR] Tauri build failed.
    popd
    exit /b %errorlevel%
)

echo.
echo ========================================================
echo BUILD SUCCESSFUL!
echo ========================================================
echo.
echo Your executable files are located at:
echo - Standalone EXE: tauri-app\src-tauri\target\release\AFVI_Parse.exe
echo - MSI Installer: tauri-app\src-tauri\target\release\bundle\msi\AFVI_Parse_0.1.0_x64_en-US.msi
echo - NSIS Installer: tauri-app\src-tauri\target\release\bundle\nsis\AFVI_Parse_0.1.0_x64-setup.exe
echo.
popd
endlocal
