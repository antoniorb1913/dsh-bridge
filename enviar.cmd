@echo off
setlocal
where node >nul 2>nul
if errorlevel 1 goto :sin_node
goto :sigue
:sin_node
echo No encuentro Node.js en este equipo.
echo Instala el LTS desde https://nodejs.org y vuelve a abrir este acceso.
pause
exit /b 1
:sigue
echo.
echo   dsh-bridge - enviar conversaciones (abre el navegador)
echo   Deja esta ventana abierta: si la cierras, la pagina deja de funcionar.
echo.
node "%~dp0bin\lanzador.js" enviar %*
echo.
pause
