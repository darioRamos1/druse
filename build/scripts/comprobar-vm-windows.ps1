# La comprobación es de lectura: permite elegir dónde preparar la VM antes de reservar recursos.
[CmdletBinding()]
param(
    [string]$DirectorioVm = '',
    [string]$Iso = '',
    [ValidatePattern('^$|^[0-9a-fA-F]{64}$')]
    [string]$Sha256Iso = '',
    [switch]$Json
)

$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'Esta comprobación necesita un anfitrión Windows.' }

$taskOs = Get-CimInstance Win32_OperatingSystem
$taskSystem = Get-CimInstance Win32_ComputerSystem
$taskDisks = @(Get-CimInstance Win32_LogicalDisk | Where-Object DriveType -In @(2, 3))
$taskMissing = [Collections.Generic.List[string]]::new()
$taskVmPath = $null
$taskTargetDisk = $null

if ($DirectorioVm) {
    $taskVmPath = [IO.Path]::GetFullPath($DirectorioVm)
    if ($taskVmPath -notmatch '^[A-Za-z]:[\\/]') { throw 'Indica una ruta en una unidad local o externa conectada, como E:\Druse-VM.' }
    $taskRoot = [IO.Path]::GetPathRoot($taskVmPath).TrimEnd('\', '/')
    $taskTargetDisk = $taskDisks | Where-Object DeviceID -EQ $taskRoot | Select-Object -First 1
    if (-not $taskTargetDisk) { $taskMissing.Add('La unidad elegida no está disponible como disco local o extraíble.') }
    elseif ($taskTargetDisk.FreeSpace -lt 80GB) { $taskMissing.Add('La unidad elegida necesita al menos 80 GiB libres para el presupuesto de esta prueba.') }
} else { $taskMissing.Add('Falta elegir una carpeta para la VM con al menos 80 GiB libres.') }

# Cuatro GiB para Windows invitado y dos de margen libre para el anfitrión.
if (($taskOs.FreePhysicalMemory * 1KB) -lt 6GB) { $taskMissing.Add('Se necesitan al menos 6 GiB de RAM libre para arrancar con 4 GiB de invitado y margen para el anfitrión.') }

$taskVBoxCommand = Get-Command VBoxManage.exe -ErrorAction SilentlyContinue
$taskVBoxPath = if ($taskVBoxCommand) { $taskVBoxCommand.Source } else { Join-Path $env:ProgramFiles 'Oracle/VirtualBox/VBoxManage.exe' }
if (-not (Test-Path -LiteralPath $taskVBoxPath -PathType Leaf)) {
    $taskVBoxPath = $null
    $taskMissing.Add('VirtualBox no está instalado o VBoxManage no se encuentra en su ubicación habitual.')
}

$taskIsoPath = $null
$taskIsoHash = $null
if ($Iso) {
    $taskIsoPath = [IO.Path]::GetFullPath($Iso)
    if ([IO.Path]::GetExtension($taskIsoPath) -ine '.iso' -or -not (Test-Path -LiteralPath $taskIsoPath -PathType Leaf)) {
        $taskMissing.Add('La ISO indicada no existe como archivo .iso.')
    } elseif (-not $Sha256Iso) {
        $taskMissing.Add('Falta el SHA-256 oficial de la ISO para comprobar sus bytes.')
    } else {
        $taskIsoHash = (Get-FileHash -LiteralPath $taskIsoPath -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($taskIsoHash -ne $Sha256Iso.ToLowerInvariant()) { $taskMissing.Add('La ISO no coincide con el SHA-256 oficial indicado.') }
    }
} else { $taskMissing.Add('Falta una ISO oficial de Windows x64 con licencia o evaluación válida.') }

$taskReport = [pscustomobject][ordered]@{
    fechaUtc = [DateTimeOffset]::UtcNow.ToString('o')
    windows = $taskOs.Caption
    ramTotalGiB = [Math]::Round($taskSystem.TotalPhysicalMemory / 1GB, 2)
    ramLibreGiB = [Math]::Round(($taskOs.FreePhysicalMemory * 1KB) / 1GB, 2)
    hipervisorPresente = [bool]$taskSystem.HypervisorPresent
    discos = @($taskDisks | ForEach-Object { [pscustomobject]@{ unidad=$_.DeviceID; libreGiB=[Math]::Round($_.FreeSpace / 1GB, 2); capacidadGiB=[Math]::Round($_.Size / 1GB, 2) } })
    directorioVm = $taskVmPath
    virtualBox = $taskVBoxPath
    iso = $taskIsoPath
    isoSha256 = $taskIsoHash
    propuesta = @{ nombre='Druse-Windows-Limpio'; ramMiB=4096; procesadores=2; discoDinamicoGiB=64; firmware='UEFI'; tpm='2.0'; red='NAT sin reenvío de puertos' }
    prerrequisitosComprobados = ($taskMissing.Count -eq 0)
    pendientes = @($taskMissing.ToArray())
    limite = 'Presupuesto y archivos comprobados; no valida el arranque de VirtualBox, Windows ni el instalador de Druse.'
}

if ($Json) { $taskReport | ConvertTo-Json -Depth 5 } else { $taskReport }
