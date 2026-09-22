# Apoyar el mantenimiento de Druse — borrador

Estado al 22 de septiembre de 2026: propuesta para revisión del titular. **No hay un perfil de cobro verificado ni enlaces de pago activos en este documento.** La compilación de Comunidad en GitHub ya funciona; el bloqueo observado el 13 de septiembre es un antecedente resuelto para ese workflow, no una necesidad actual de financiación.

## Presentación propuesta

Druse es una aplicación de escritorio para trabajar con bases de datos. Los aportes voluntarios ayudarán a dedicar tiempo a corregir errores, probar la compatibilidad y mejorar la documentación. Podrás usar la aplicación sin aportar.

El apoyo no promete fechas de entrega, soporte permanente ni funciones exclusivas. Cualquier servicio profesional se acordaría por separado. Solo publicaremos nombres o reconocimientos de patrocinadores con su permiso.

Responsable propuesto del perfil: Darío, mantenedor de Druse; identidad del receptor pendiente de confirmar en DEC-04. Contacto público: `druse.contacto@gmail.com`.

## Canal y niveles candidatos

Se propone GitHub Sponsors. Colombia figura como región admitida; siguen pendientes el alta, la verificación de residencia, los datos del receptor y la aprobación de GitHub. [Disponibilidad](https://docs.github.com/en/sponsors/getting-started-with-github-sponsors/about-github-sponsors).

| Modalidad | Importe propuesto | Destino |
| --- | ---: | --- |
| Aporte único | US$5 | Mantenimiento general |
| Mensual | US$3 | Mantenimiento general |
| Mensual | US$5 | Mantenimiento general |
| Mensual | US$10 | Mantenimiento general |

Los importes son propuestas, no planes publicados. El checkout del proveedor debe mostrar importe, moneda y periodicidad antes del pago. El titular debe completar identidad, datos bancarios/fiscales y 2FA en el proveedor, nunca en el repositorio. [Alta de Sponsors](https://docs.github.com/en/sponsors/receiving-sponsorships-through-github-sponsors/setting-up-github-sponsors-for-your-personal-account).

## Presupuesto inicial

Revisión técnica del 22 de septiembre de 2026. No se contrató ningún servicio durante esta preparación. No se consultó la facturación privada, por lo que los importes de esta tabla describen el presupuesto previsto, no un balance contable certificado.

| Concepto | Gasto comprobado | Qué se sabe | Qué haría falta |
| --- | --- | --- | --- |
| Integración continua | US| Integración continua | US$0, y **sin ejecutar** | Los trabajos terminan en tres segundos, sin runner asignado y sin ejecutar un solo paso. GitHub lo dice en la anotación de cada uno: «The job was not started because recent account payments have failed or your spending limit needs to be increased». Mismo mensaje al menos desde el 11 de septiembre de 2026. Son dos causas distintas bajo el mismo aviso —un pago rechazado o el límite de gasto agotado— y distinguirlas necesita leer la facturación de la cuenta | Revisar «Billing & plans» en la cuenta antes de depender de CI para una release. En privado los minutos salen de la cuota y no valen igual: Windows cuenta ×2 y macOS ×10, así que la matriz de CI se recortó para que cada push gaste lo mínimo y el recorrido completo sea semanal. Un repositorio público usa runners estándar sin coste, lo que haría desaparecer este gasto. [Facturación de Actions](https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions) | previsto para minutos en runners estándar públicos | Repositorio público; [Comunidad construida y verificada](https://github.com/darioRamos1/druse/actions/runs/35687912136). GitHub documenta uso gratuito de runners estándar para repositorios públicos; almacenamiento y runners mayores tienen condiciones propias. [Facturación de Actions](https://docs.github.com/en/billing/concepts/product-billing/github-actions) | Mantener la retención de artefactos acotada y revisar consumo antes de ampliar infraestructura. No se verificó el saldo de facturación privado |
| Pruebas contra motores | US$0 | Contenedores locales de PostgreSQL, SQL Server, MySQL, Oracle Free e Informix Developer. Cuestan disco y descarga —las imágenes de Oracle y SQL Server rondan 2 GB y 1,5 GB—, no dinero | Nada, mientras las imágenes de desarrollo sigan siendo gratuitas y sus términos lo permitan |
| Equipo de pruebas | US$0 | Un solo equipo Windows. No hay una máquina limpia para probar instalación y desinstalación, que es lo que pide **PKG-04** | Un Windows sin herramientas de desarrollo, propio o virtualizado |
| Firma de código | US$0 | No hay certificado. SignPath Foundation no cobra a los proyectos que admite, y la solicitud todavía no se ha presentado | Si SignPath no admite el proyecto, pedir presupuesto antes de escribir una cifra aquí |
| Alojamiento de la landing | US$0 | GitHub Pages | Nada |
| Dominio propio | US$0 | No se ha comprado ninguno | Decidir solo si la dirección gratuita resulta insuficiente |
| Tiempo de mantenimiento | Sin valorar | No hay registro de horas | Anotar horas durante un mes antes de poner precio a nada |

**Prioridad de los aportes, si llegan:** pruebas en un Windows limpio, corrección de errores, mantenimiento y compatibilidad de motores. CI de Comunidad ya funciona. Ninguna función nueva depende de que alguien aporte.

La meta inicial sugerida de US$25/mes en aportes recurrentes es una señal de validación, no una previsión de ingresos ni autorización para contratar nada. **El presupuesto se sostiene con cero donaciones**, que es como está hoy.

## Cuando el perfil esté aprobado

La configuración candidata de `.github/FUNDING.yml` es esta, y **no está creada a propósito**: un botón de patrocinio que lleva a un perfil inexistente es peor que no tenerlo.

```yaml
github: darioRamos1
```

`github: darioRamos1` es el nombre de la cuenta, no una prueba de que Sponsors esté activo. Se crea el archivo cuando GitHub apruebe el perfil y se haya visto la URL real funcionando, según **DON-04**.

## Registro y transparencia

Mantener de forma privada fecha, proveedor, importe bruto, deducciones, moneda recibida y gasto asociado. Confirmar el tratamiento fiscal del titular antes de atribuir beneficios tributarios a los aportes. No publicar cuentas bancarias, recibos con datos personales ni identidades sin permiso.

Cada mes se puede publicar un resumen agregado de aportes recibidos, gastos y trabajo realizado. Al inicio, evitar comprometer gastos fijos que dependan de donaciones futuras.

## Activación pendiente

Tras verificar el perfil aprobado: añadir `.github/FUNDING.yml`, un enlace en README y el botón «Apoyar Druse» en la landing. Usar un enlace externo al proveedor, sin formulario propio para tarjetas ni rastreo nuevo. Probar la navegación y el receptor sin efectuar un pago de prueba no autorizado.
