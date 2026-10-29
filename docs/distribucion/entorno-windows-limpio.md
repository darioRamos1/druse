# Preparar Windows limpio para probar Comunidad

Estado al 14 de octubre de 2026: preparación iniciada; VM no creada y pruebas de instalación no ejecutadas. Desarrolla REA-04/15 del [plan de reaplicación](../planes/plan-reaplicacion-signpath-2026-10-11.md) y el [protocolo de instalación](pruebas-instalador-signpath.md).

## Comprobación del equipo actual

Windows 11 Home Single Language, con 16 GiB de RAM total y unos 4,3 GiB disponibles al comprobarlo. Se observó un hipervisor activo; ese dato no demuestra por sí solo que VirtualBox pueda arrancar una VM. Windows Sandbox no está admitido en Home. [Microsoft](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/).

| Unidad | Espacio libre observado | Consecuencia |
| --- | ---: | --- |
| C: | Aproximadamente 23 GiB | Insuficiente para el presupuesto de la VM |
| P: | Aproximadamente 11 GiB | Insuficiente para el presupuesto de la VM |

Darío confirmó que no dispone de otro disco o carpeta con **al menos 80 GiB libres**. La VM queda pendiente por falta de espacio. Es un presupuesto propio para disco virtual, ISO, actualizaciones e instantánea; no una cifra exigida por SignPath. La propuesta asigna 4 GiB al invitado y pide 6 GiB de RAM libre al arrancar, para dejar margen al anfitrión. Hace falta recuperar memoria disponible antes de iniciar la VM.

Limpieza solicitada por Darío el 14 de octubre: se eliminaron cachés de descarga de npm, pip y NuGet, cachés de Angular y resultados regenerables de compilación de Druse. El espacio libre pasó de unos 21,4 a **27,5 GiB en C:** y de 10,6 a **18,4 GiB en P:**, aproximadamente 14 GiB recuperados entre ambas unidades. Los instaladores, el kit de Windows limpio, los manifiestos y los registros de pruebas se conservaron; el SHA-256 del instalador y del kit no cambió. Los binarios y objetos de compilación eliminados deben regenerarse antes de repetir las pruebas.

Docker eliminó además unos 17 GB de caché de construcción interna, sin borrar imágenes, contenedores ni volúmenes. Ese tamaño no se suma al espacio físico recuperado: no se compactó su disco virtual ni se detuvieron los tres contenedores que estaban en ejecución. La revisión automática rechazó la eliminación de carpetas temporales de Visual Studio con «blocked by policy», sin más detalle; esas carpetas quedaron intactas. Ninguna unidad alcanza todavía el presupuesto de la VM.

## Software preparado

La consulta al catálogo `winget`, fuente `winget`, identificó VirtualBox 7.2.20. Se descargó el instalador oficial a:

```text
artifacts/vm-windows-2026-10-14/VirtualBox-7.2.20-175154-Win.exe
```

- Tamaño: 178.192.488 bytes.
- SHA-256: `a81777d2b36380ce042a29e9c554cf032eb46a793f62e3cc82e7411e535c2c26`, coincidente con el catálogo.
- Authenticode: `Valid`, editor `Oracle America, Inc.`.
- [Origen del instalador](https://download.virtualbox.org/virtualbox/7.2.20/VirtualBox-7.2.20-175154-Win.exe).

El software está descargado, **no instalado**. La instalación del hipervisor puede necesitar elevación y afectar temporalmente la red; se hará cuando exista espacio para la VM y se pueda atender el instalador. El paquete base permite esta preparación; no se necesita el Extension Pack para el recorrido propuesto. Las capacidades y la configuración se contrastan con el [manual oficial de VirtualBox 7.2](https://docs.oracle.com/en/virtualization/virtualbox/7.2/user/EN-VBOX-7-2-USER.pdf).

## ISO de Windows

Obtener una ISO oficial x64 con licencia válida. La [evaluación de Windows 11 Enterprise](https://www.microsoft.com/en-us/evalcenter/evaluate-windows-11-enterprise) ofrece 90 días y requiere registro; no es una licencia permanente. El titular debe completar los datos solicitados y el inicio de sesión que corresponda. No se ha registrado al usuario ni descargado la ISO.

Conservar el SHA-256 publicado para la descarga seleccionada y comprobarlo antes de conectarla a la VM. La ISO es el medio del **invitado virtual**; no se utiliza para reinstalar el equipo habitual.

## Configuración preparada

| Ajuste | Propuesta |
| --- | --- |
| Nombre | `Druse-Windows-Limpio` |
| Invitado | Windows 11 x64 |
| Memoria y CPU | 4096 MiB y 2 procesadores |
| Disco | VDI dinámico de 64 GiB, bajo la ruta elegida |
| Arranque | UEFI y TPM virtual 2.0 |
| Vídeo | VBoxSVGA, según el perfil de Windows del asistente; comprobar el arranque antes de pruebas |
| Red | NAT, sin reenvío de puertos; desconectada para el caso sin red |
| Integración | Portapapeles y arrastrar/soltar desactivados inicialmente |
| Instantánea | Windows iniciado y estado de WebView2 registrado, antes de instalar Druse |

La ruta, el registro de VirtualBox y los discos existentes se revisarán antes de crear archivos. La preparación debe crear una VM nueva; no reutilizar ni borrar una máquina ajena. La asignación dinámica no elimina la necesidad de espacio físico disponible.

## Comprobación repetible

El guion siguiente solo consulta el anfitrión y verifica archivos; no instala software, no crea discos y no inicia procesos virtuales:

```powershell
./build/scripts/comprobar-vm-windows.ps1 -Json
# Cuando se conozcan la ubicación y la ISO:
./build/scripts/comprobar-vm-windows.ps1 -DirectorioVm 'E:\Druse-VM' -Iso 'E:\ISO\Windows.iso' -Sha256Iso '<SHA-256 oficial>' -Json
```

`prerrequisitosComprobados` solo se cumple cuando hay espacio, memoria, VBoxManage e ISO con el hash indicado. No acredita compatibilidad del hipervisor ni una instalación de Windows completada.

Después de instalar Windows en la VM y guardar la instantánea inicial, trasladar el kit `artifacts/signpath-seguridad-2026-10-14/kit-windows-limpio.zip` y ejecutar el protocolo. Registrar expresamente si se instalan Guest Additions para transferir archivos y qué versión de WebView2 había. Una prueba que necesite otra versión o un canal de actualización ausente permanece «no probado».

## Qué falta ahora

1. Elegir una ubicación con el espacio indicado y disponer de memoria libre suficiente.
2. Instalar VirtualBox y obtener la ISO con el registro/licencia del titular.
3. Crear la VM y comprobar que Windows inicia; preparar la instantánea.
4. Ejecutar el protocolo y devolver resultados y evidencia sin datos sensibles.

El kit y la preparación del anfitrión no cierran PKG-04 ni constituyen pruebas externas de adopción.

Mientras no exista un entorno adecuado, se puede avanzar con la [consulta técnica preparada para SignPath](consulta-signpath-pendientes-2026-10-14.md). No se ha instalado VirtualBox ni descargado la ISO; las pruebas siguen pendientes.
