# Cómo añadir un motor a Druse

> Guía de trabajo. El plan de los motores que vienen —Oracle y SQLite— está en
> [`plan-nuevos-motores.md`](../planes/plan-nuevos-motores.md); aquí está el procedimiento,
> que sirve para cualquiera.

Druse habla con cinco motores hoy —PostgreSQL, SQL Server, MySQL/MariaDB e
Informix por sus dos protocolos— y la arquitectura está pensada para que el
sexto entre sin tocar el núcleo. Un motor son **unas 2.000 líneas dentro de su
propia carpeta** y una docena de líneas fuera.

Lo que sigue es esa docena de líneas, y por qué cada una está donde está.

---

## 1. El contrato

Un motor aporta seis piezas y nadie más las conoce:

| Contrato | De qué responde |
| --- | --- |
| `IDatabaseProvider` | Abrir, probar, puerto y base por omisión, bases del sistema, **y lo que el motor sabe hacer** |
| `IDatabaseMetadataReader` | El catálogo: bases, hijos, columnas, definiciones, estructura, firmas de rutinas |
| `IQueryExecutor` | Ejecutar, cancelar, leer por streaming, normalizar errores |
| `IRowEditor` | `INSERT`, `UPDATE` y `DELETE` desde la cuadrícula |
| `ITableDesigner` | El DDL del diseñador, los tipos que ofrece y sus capacidades de índice |
| `IDatabaseScripter` | El DDL y los datos que reproducen lo que ya existe, para respaldar |

`ProviderRegistry` las localiza por `DatabaseEngine`, y por eso **no hay ni un
`switch` por motor en los casos de uso**. El diseñador y el guionizador son la
misma clase: escribir un `CREATE TABLE` desde un diseño y escribirlo desde el
catálogo son la misma tarea con distinta entrada.

---

## 2. Los pasos

### 2.1. En el dominio

1. **Número nuevo en `DatabaseEngine`.** Se guarda en el SQLite del usuario junto
   a cada perfil, así que **nunca se reordena ni se reutiliza**: cambiarlo
   convertiría las conexiones guardadas de un motor en las de otro.

### 2.2. El proveedor

2. Proyecto `Druse.Provider.<Motor>`, referenciado en `backend/Druse.slnx` y en el
   `.csproj` del host.
3. Las nueve clases. Tomar como plantilla `Druse.Provider.MySql`, que es el
   último que se escribió desde cero y el más limpio:
   - `<Motor>ConnectionStringFactory` — con pruebas unitarias que comprueben la
     cadena **sin conectar**.
   - `<Motor>DatabaseProvider`
   - `<Motor>ErrorNormalizer` — del error del driver a `QueryError`, sin dejar
     pasar credenciales.
   - `<Motor>MetadataReader` — la mitad del trabajo.
   - `<Motor>QueryExecutor` y `<Motor>ResultReader`
   - `<Motor>RowEditor`
   - `<Motor>TableDesigner`, que también implementa `IDatabaseScripter`.
   - `<Motor>ValueFormatter`
4. **`GetTableDetailsAsync` en una sola lectura.** La implementación por omisión
   recorre las tablas de una en una y existe solo para arrancar; la prueba
   contractual cuenta viajes y la rechaza. Sin esto no hay diagramas: leer
   sesenta tablas de una en una son más de doscientos viajes sobre una conexión
   que no admite dos cosas a la vez.
5. **Declarar `EngineCapabilities`.** Lo que el motor necesita para conectar y
   qué familias de datos guarda con un tipo propio. `NativeFamilies` es
   `required` a propósito: un motor que no lo declarara heredaría «lo conserva
   todo», y el asistente de traslado prometería una traducción exacta que pierde
   datos.

### 2.3. Enchufarlo

6. Seis líneas en `Druse.Host.LocalApi/DependencyInjection.cs`, una por contrato.
   Si el driver pesa mucho —el de Informix ocupa 111 MB— va tras una compilación
   condicional, como `#if DRUSE_INFORMIX`.
7. `ContractMapper.EngineId` y `EngineName`, **solo** si se quiere un
   identificador distinto del nombre del enumerado. El caso general ya funciona.
8. Revisar `ConnectionProfileValidator`: no hace falta tocarlo si las capacidades
   describen bien al motor. Pregunta por ellas, no por el motor.

### 2.4. En la interfaz

La lista de motores sale de `/api/engines`, así que **aparecer no cuesta nada**.
Lo que hay que decidir es cómo se dibuja, y son cinco registros exhaustivos: si
falta uno, no compila.

9. En `shared/ui/engine-badge/engine-badge.ts`:
   - `ENGINE_LABELS` — el distintivo de dos letras.
   - `ENGINE_NAMES` — el nombre completo.
   - `ENGINE_VERSIONS` — las versiones que se anuncian.
   - `ENGINE_FAMILIES` — a qué producto pertenece. Casi siempre a sí mismo; la
     excepción es Informix, que son dos motores para un solo producto.
   - `ENGINE_TRANSPORTS` — cómo se llama su camino, o `null` si es el único.
   - `ENGINE_ORDER` — dónde va en la lista. Lo que falte va al final.
   - El bloque `:host([data-engine='…'])` con su color.
10. En `styles/_tokens.scss`, las tres variables `--dr-engine-<motor>`,
    `-tint` y `-line`, **en los dos temas**: los tonos que funcionan sobre negro
    no funcionan sobre blanco.
11. En `query-editor/sql-language/`:
    - `sql-dialects.ts` — comillas, límite de filas, truncado de fechas e
      `INSERT` sin columnas.
    - `sql-formatting.ts` — el dialecto de `sql-formatter`. Formatear con el
      equivocado parte el SQL por sitios que cambian su significado.
    - `sql-keywords.ts` y `sql-snippets.ts`.
    - `buildCall` en `sql-writer.ts`, que no tiene rama por omisión.

### 2.5. Comprobarlo

12. `<Motor>Fixture` en `Druse.ProviderContractTests`, implementando
    `IProviderFixture` **entero**. Lo que comprueba el contrato es idéntico para
    todos los motores: si hubiera que cambiar una comprobación para que pase en
    uno concreto, es señal de que se coló una fuga de dialecto en las
    abstracciones.
13. Contenedor desechable en `build/scripts/test-db.ps1` y `test-db.sh`.
14. **Recorrerlo a mano contra un servidor real**, con capturas, y anotarlo en
    `docs/seguimiento/BITACORA.md`. Las pruebas en verde no son la verificación: la lista de
    dieciocho funcionalidades que hay que recorrer está en el §5 de
    [`plan-nuevos-motores.md`](../planes/plan-nuevos-motores.md).

---

## 3. Dos cosas que conviene saber antes de empezar

**Una familia de datos ausente es una declaración, no un olvido.** Cuando el
motor no tiene tipo para algo, se dice y se explica qué se pierde. Los avisos del
traslado entre motores son el producto de esa pantalla: acertar con el nombre del
tipo es fácil, y lo que hace falta saber antes de copiar es qué deja de ser
cierto en el destino.

**Si `IProviderFixture` crece al añadir un motor, mirarlo dos veces.** Cada
propiedad de esa interfaz es una diferencia de dialecto declarada de forma
explícita. Que crezca mucho no significa que el motor sea raro: significa que las
abstracciones están dejando pasar diferencias que deberían absorber.
