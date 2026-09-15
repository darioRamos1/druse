# Instalador de Druse y SmartScreen

Revisión: 12 de septiembre de 2026.

## Estado del proyecto

`build/scripts/package.ps1` ya genera un instalador NSIS para Windows x64 con la API autocontenida y el frontend. La versión configurada es 1.1.0. La tarea pendiente del plan es **REL-005: firma Authenticode y sellado de tiempo**.

En la revisión local no hay firma Authenticode configurada. Existe un certificado autofirmado de pruebas; no se utiliza para presentar los instaladores como confiables en otros equipos. La clave del actualizador sí está disponible: el archivo `.sig` resultante protege las actualizaciones de Tauri, pero no sustituye una firma Authenticode.

Para generar el instalador completo:

```powershell
./build/scripts/package.ps1 -Runtime win-x64 -RequireUpdaterSignature
```

Resultado: `shells/desktop-tauri/target/release/bundle/nsis/Druse_1.1.0_x64-setup-completo.exe`, acompañado de su `.sig`. La variante sin Informix se genera añadiendo `-WithoutInformix`.

La generación no instala Druse en el equipo ni publica una GitHub Release. No debe anunciarse actualización pública mientras sus artefactos sigan alojados únicamente en un repositorio privado.

## Qué se puede conseguir con SmartScreen

SmartScreen considera la reputación del archivo y del editor. Un EXE recién firmado puede seguir mostrando advertencias. Microsoft confirma que los certificados EV ya no conceden confianza inmediata. No hay un ajuste del instalador que garantice que Windows omita el aviso en todos los equipos. [Documentación de SmartScreen](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation).

La vía para distribuir sin comprar un certificado es **un paquete MSIX publicado mediante Microsoft Store**: Microsoft firma el paquete después de su certificación. Esto no se aplica a un MSIX descargado por fuera de la tienda ni al EXE de NSIS actual. Para enviar un MSI/EXE a la Store, el editor sigue teniendo que firmarlo. [Opciones de firma](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options).

La inscripción por el nuevo flujo de Microsoft Store se anuncia sin cuota de registro. Requiere elegir el tipo de cuenta correcto y completar la verificación correspondiente. No se crea una cuenta ni se acepta un contrato de distribución como parte de generar el EXE. [Registro oficial](https://learn.microsoft.com/en-us/windows/apps/publish/partner-center/open-a-developer-account).

## Ruta pendiente para Microsoft Store

La alternativa mediante código abierto está detallada en el [plan de SignPath y donaciones](../planes/plan-signpath-donaciones.md). Son rutas diferentes y ninguna está aprobada todavía para Druse.

1. Dar de alta la cuenta de desarrollador por el flujo oficial y reservar el nombre disponible. Obtener de Partner Center la identidad exacta del paquete y del editor; no inventarlas.
2. Preparar el empaquetado MSIX de Druse con sus binarios, API auxiliar, recursos e iconos. Declarar las capacidades requeridas y justificar las que exija la Store.
3. Adaptar el canal de actualizaciones para que la edición de Store utilice su mecanismo de distribución; evitar que el actualizador NSIS intente reemplazarla.
4. Comprobar el arranque del proceso auxiliar, la comunicación local, WebView2, conexiones, acceso a archivos y credenciales desde una instalación MSIX limpia. Probar actualización y desinstalación en otro equipo.
5. Completar privacidad de la aplicación, titular, licencia, redistribución de dependencias y ficha de la Store. La política de la landing no sustituye la de la aplicación.
6. Enviar a certificación. Solo después de su aprobación y publicación, añadir a la landing el enlace real a Microsoft Store.

El instalador NSIS se puede generar ahora. La distribución MSIX en Store es trabajo pendiente; todavía no hay una publicación aprobada ni una garantía de aceptación del paquete.
