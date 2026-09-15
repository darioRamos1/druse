# Documentación de Druse

Índice de la documentación del proyecto. Para instalar, ejecutar o contribuir,
empieza por el [README principal](../README.md).

## Planes y seguimiento

- [Plan maestro](planes/PLAN_TRABAJO_DRUSE.md): alcance, arquitectura y fases.
- [Plan de mejoras](planes/PLAN_MEJORAS_DRUSE.md): fiabilidad y trabajo pendiente.
- [Bitácora de sesiones](seguimiento/BITACORA.md): avances y próximos pasos.
- [Mejoras visuales](planes/plan-mejoras-visuales.md).
- [Diagramas entidad-relación](planes/plan-mer-y-diagramas.md).
- [Migración de datos](planes/plan-migracion-de-datos.md).
- [Nuevos motores](planes/plan-nuevos-motores.md).
- [Respaldos y restauración](planes/plan-respaldos-y-restauracion.md).
- [SignPath y donaciones](planes/plan-signpath-donaciones.md).

## Guías y motores

- [Levantar y empaquetar Druse](guias/Guia-Druse-Levantar-y-Empaquetar.md).
- [Estrategia de código abierto](guias/guia-estrategia-open-source.md).
- [Landing y GitHub Pages](guias/landing-github-pages.md).
- [Cómo añadir un motor](motores/como-anadir-un-motor.md).
- [Matriz de motores comprobados](motores/matriz-de-motores.md).

## Distribución y financiación

- [Distribución en Windows y SmartScreen](distribucion/distribucion-windows-smartscreen.md).
- [Expediente de SignPath](distribucion/expediente-signpath.md).
- [Borrador de consulta a SignPath](distribucion/consulta-signpath-borrador.md).
- [Pruebas del instalador](distribucion/pruebas-instalador-signpath.md).
- [Financiación](distribucion/financiacion.md).
- [Notas de versiones](release-notes/).

## Privacidad y revisiones

- [Privacidad de la aplicación](privacidad/privacidad-aplicacion.md).
- [Privacidad de la landing](privacidad/landing-privacidad.md).
- [Auditoría de apertura — 13 de septiembre de 2026](revisiones/auditoria-apertura-2026-09-13.md).
- [Revisión de SignPath — 14 de septiembre de 2026](revisiones/revision-signpath-2026-09-14.md).
- [Controladores y SignPath — 15 de septiembre de 2026](revisiones/controladores-signpath-2026-09-15.md).
- [Revisión de interfaz y experiencia — 8 de septiembre de 2026](revisiones/revision-ui-ux-2026-09-08.md).

## Referencias técnicas y políticas

- [Decisiones de arquitectura](decisions/).
- [Contrato de la API](api/).
- [Mockups](mockups/).
- [Inventario de licencias de dependencias](licencias-dependencias.csv).
- [Contribuciones](../CONTRIBUTING.md), [seguridad](../SECURITY.md),
  [firma de código](../CODE_SIGNING_POLICY.md) y [avisos de terceros](../THIRD_PARTY_NOTICES.md).

## Dónde guardar nuevos documentos

Usa `planes/` para propuestas y fases de trabajo, `seguimiento/` para bitácoras,
`guias/` para procedimientos, `motores/` para compatibilidad y extensión de motores,
`distribucion/` para instaladores, firma y financiación, `privacidad/` para avisos
y `revisiones/` para auditorías fechadas. Conserva las decisiones de arquitectura
en `decisions/` y las notas de cada versión en `release-notes/`.

Añade aquí un enlace cuando crees un documento. Los enlaces entre documentos son
relativos al archivo que los contiene; las rutas dentro de ejemplos de comandos
se interpretan desde la raíz del repositorio, salvo indicación expresa.
