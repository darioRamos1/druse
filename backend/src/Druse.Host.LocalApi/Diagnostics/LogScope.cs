using System.Collections;
using System.Globalization;

namespace Druse.Host.LocalApi.Diagnostics;

/// <summary>
/// De qué operación es cada línea del registro.
///
/// Sin esto, dos cosas a la vez —una consulta mientras corre un respaldo—
/// producen un registro intercalado que no se puede separar: se lee como si todo
/// le hubiera pasado a lo mismo. Con el identificador delante, cada línea dice a
/// qué pertenece.
///
/// Lo que se guarda es **solo el identificador**, nunca el contenido: ni el SQL,
/// ni el destino, ni las credenciales de la sesión.
/// </summary>
internal static class LogScope
{
    private static readonly AsyncLocal<string?> Value = new();

    /// <summary>Lo que está abierto ahora mismo, o vacío.</summary>
    public static string? Current => Value.Value;

    /// <summary>
    /// Abre un ámbito con lo que se pueda leer del estado.
    ///
    /// De un estado con pares clave-valor —lo que produce `BeginScope(new { ... })`
    /// del propio ASP.NET— se toman solo los que nombran una operación; de
    /// cualquier otra cosa, su texto. Un ámbito que no nombra nada no se abre: una
    /// línea con corchetes vacíos es ruido.
    /// </summary>
    public static IDisposable? Push<TState>(TState state)
        where TState : notnull
    {
        var text = Describe(state);

        return string.IsNullOrEmpty(text) ? null : new Frame(text);
    }

    private static string Describe<TState>(TState state)
        where TState : notnull
    {
        if (state is IEnumerable<KeyValuePair<string, object?>> pairs)
        {
            var wanted = pairs
                .Where(pair => Interesting(pair.Key) && pair.Value is not null)
                .Select(pair => string.Create(
                    CultureInfo.InvariantCulture,
                    $"{pair.Key}={pair.Value}"));

            return string.Join(' ', wanted);
        }

        return state.ToString() ?? string.Empty;
    }

    /// <summary>
    /// Qué claves valen para nombrar la operación.
    ///
    /// La lista es corta a propósito: todo lo demás que llega en un ámbito
    /// —parámetros de ruta, cabeceras, el estado que ponga cualquier biblioteca—
    /// puede llevar datos del usuario dentro.
    /// </summary>
    private static bool Interesting(string key) =>
        key is "RequestId" or "SessionId" or "JobId" or "ExecutionId";

    private sealed class Frame : IDisposable
    {
        private readonly string? _previous;
        private bool _closed;

        public Frame(string text)
        {
            _previous = Value.Value;

            // Anidados se acumulan: una consulta dentro de una petición lleva los
            // dos identificadores, que es justo lo que hace falta para seguirla.
            Value.Value = string.IsNullOrEmpty(_previous) ? text : $"{_previous} {text}";
        }

        public void Dispose()
        {
            if (_closed)
            {
                return;
            }

            _closed = true;
            Value.Value = _previous;
        }
    }
}
