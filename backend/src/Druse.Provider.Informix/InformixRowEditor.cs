using System.Data.Common;
using System.Globalization;
using Druse.Database.Abstractions;
using Druse.Domain;

namespace Druse.Provider.Informix;

/// <summary>Escribe cambios de filas en Informix. Solo aporta su dialecto.</summary>
public sealed class InformixRowEditor : RowEditorBase
{
    public override DatabaseEngine Engine => DatabaseEngine.Informix;

    /// <summary>
    /// Comillas dobles, duplicándolas por dentro.
    ///
    /// Solo funcionan como delimitador de identificador si la conexión lleva
    /// `DELIMIDENT=Y`; sin eso, Informix las trataría como comillas de cadena. Lo
    /// pone <see cref="InformixConnectionStringFactory"/>, y de ahí depende que
    /// una columna pueda llamarse `order` o llevar acentos.
    /// </summary>
    protected override string Quote(string identifier) =>
        $"\"{identifier.Replace("\"", "\"\"", StringComparison.Ordinal)}\"";

    /// <summary>
    /// Informix usa marcadores posicionales: en el SQL todos son `?` y el enlace
    /// se hace por el orden en que se añaden al comando.
    /// </summary>
    protected override string Parameter(int index) => "?";

    /// <summary>
    /// Aunque el marcador sea siempre el mismo, cada parámetro necesita un nombre
    /// distinto para poder convivir en la colección del comando.
    /// </summary>
    protected override string ParameterName(int index) =>
        $"p{index.ToString(CultureInfo.InvariantCulture)}";

    protected override DbConnection Connection(IDatabaseSession session) =>
        session is InformixSession informix
            ? informix.Connection
            : throw new ArgumentException(
                "La sesión no pertenece al proveedor Informix.",
                nameof(session));
}
