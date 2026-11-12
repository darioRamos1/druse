using Druse.Application.Abstractions;
using Druse.Application.Connections;
using Druse.Database.Abstractions;
using Druse.Domain;

namespace Druse.Application.Reports;

/// <summary>Lee una fuente de BI en una sesión dedicada.</summary>
public sealed class ReportQueryService(ConnectionService connections, IProviderRegistry providers)
{
    public const int SourceRowLimit = 20_000;

    public async Task<TypedQueryResult> ReadAsync(
        ConnectionProfile profile,
        DatabaseCredentials credentials,
        SshCredentials sshCredentials,
        string sql,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(profile);
        ArgumentException.ThrowIfNullOrWhiteSpace(sql);

        // Los motores los decide la edición: si su proveedor no está registrado,
        // el registro lanza NotSupportedException y la fuente lo dice.
        // En SQL Server los permisos de la cuenta deben impedir las escrituras
        // que el analizador de SQL no pueda detectar.
        if (SqlSafetyAnalyzer.IsMutating(sql))
        {
            throw new ReportProblemException(ReportMessages.ReadOnlyQuery());
        }

        var executor = providers.GetQueryExecutor(profile.Engine);
        var session = await connections.OpenAsync(
            profile with { ReadOnly = true }, credentials, sshCredentials, cancellationToken);
        try
        {
            var request = new QueryRequest
            {
                SessionId = session.Id,
                Sql = sql,
                MaxRows = SourceRowLimit,
                TimeoutSeconds = 60,
            };
            await using var reader = await executor.OpenReaderAsync(session, request, cancellationToken);
            if (reader is not ITypedQueryResultReader typed)
            {
                throw new NotSupportedException("La lectura tipada de BI no está disponible para este motor.");
            }

            return await typed.ReadTypedAsync(request.MaxRows, cancellationToken);
        }
        finally
        {
            await connections.CloseAsync(session.Id);
        }
    }
}
