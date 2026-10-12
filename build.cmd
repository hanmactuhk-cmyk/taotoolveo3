@echo off
setlocal
pushd "%~dp0"
echo Dang bien dich FlowDesk.exe voi trinh bien dich csc.exe...
"%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe /platform:x64 /optimize+ /out:FlowDesk.exe /reference:System.dll /reference:System.Core.dll /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll /reference:System.Xml.dll /resource:flow-bridge.js,FlowBridge FlowDesk.cs
if errorlevel 1 goto failed
echo ========================================================
echo Bien dich thanh cong! File FlowDesk.exe da duoc tao.
echo ========================================================
popd
pause
exit /b 0

:failed
echo ========================================================
echo Bien dich that bai! Vui long kiem tra loi tren.
echo ========================================================
popd
pause
exit /b 1
