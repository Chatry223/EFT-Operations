@echo off
setlocal
if "%GameManagedDir%"=="" set "GameManagedDir=C:\SPT\EscapeFromTarkov_Data\Managed"
if "%BepInExCoreDir%"=="" set "BepInExCoreDir=C:\SPT\BepInEx\core"
dotnet build "%~dp0EFT.Operations.Client.csproj" -c Release -p:GameManagedDir="%GameManagedDir%" -p:BepInExCoreDir="%BepInExCoreDir%"
if errorlevel 1 exit /b %errorlevel%
echo Build completed. Copy bin\Release\net472\EFTOperations.Client.dll into BepInEx\plugins\EFTOperations\
