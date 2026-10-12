@echo off
setlocal
pushd "%~dp0"
echo Dang bien dich FlowDesk.exe voi MSBuild...
msbuild FlowDesk.csproj /p:Configuration=Release /p:Platform=x64
if errorlevel 1 goto failed
copy /y bin\x64\Release\FlowDesk.exe FlowDesk.exe >nul 2>&1
copy /y bin\Release\FlowDesk.exe FlowDesk.exe >nul 2>&1
echo ========================================================
echo Bien dich thanh cong! File FlowDesk.exe da duoc tao.
echo ========================================================
popd
exit /b 0

:failed
echo ========================================================
echo Bien dich that bai! Vui long kiem tra loi tren.
echo ========================================================
popd
exit /b 1
