using Druse.Application.Abstractions;
using Druse.Application.Reports;
using Druse.Host.LocalApi.Contracts;

namespace Druse.Host.LocalApi.Endpoints;

/// <summary>
/// Conjuntos de datos de Reportes BI.
///
/// La definición solo lleva el identificador del perfil de conexión: las
/// credenciales se resuelven en el servidor con el llavero, como al abrir una
/// conexión guardada.
/// </summary>
internal static class ReportEndpoints
{
    public static void MapReportEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/reports/datasets", async (
            IReportDatasetStore datasets,
            CancellationToken cancellationToken) =>
            Results.Ok((await datasets.GetAllAsync(cancellationToken)).Select(dataset => dataset.ToDto())))
        .WithName("GetReportDatasets");

        app.MapGet("/api/reports/datasets/{id:guid}", async (
            Guid id,
            IReportDatasetStore datasets,
            CancellationToken cancellationToken) =>
            await datasets.FindAsync(id, cancellationToken) is { } dataset
                ? Results.Ok(dataset.ToDto())
                : Results.NotFound())
        .WithName("GetReportDataset");

        // Quien guarda pone el identificador, como en composiciones y diagramas:
        // crear y editar son la misma operación.
        app.MapPut("/api/reports/datasets/{id:guid}", async (
            Guid id,
            ReportDatasetDto request,
            IReportDatasetStore datasets,
            CancellationToken cancellationToken) =>
        {
            var dataset = request.ToDomain(id);
            var errors = ReportDatasetValidator.Validate(dataset);
            if (errors.Count > 0)
            {
                return Results.BadRequest(new { message = string.Join(" ", errors), errors });
            }

            return Results.Ok((await datasets.SaveAsync(dataset, cancellationToken)).ToDto());
        })
        .WithName("SaveReportDataset");

        app.MapDelete("/api/reports/datasets/{id:guid}", async (
            Guid id,
            IReportDatasetStore datasets,
            CancellationToken cancellationToken) =>
        {
            await datasets.DeleteAsync(id, cancellationToken);
            return Results.NoContent();
        })
        .WithName("DeleteReportDataset");

        // «Actualizar ahora». Un intento fallido responde 200 con el motivo: no
        // es un error de la API, es lo que hay que contar junto al dato anterior.
        app.MapPost("/api/reports/datasets/{id:guid}/refresh", async (
            Guid id,
            ReportRefreshService refresher,
            CancellationToken cancellationToken) =>
        {
            var result = await refresher.RefreshAsync(id, ReportRunOrigin.Manual, cancellationToken);
            return result.Outcome switch
            {
                ReportRefreshOutcome.NotFound => Results.NotFound(),
                ReportRefreshOutcome.Busy => Results.Conflict(new
                {
                    message = "Este conjunto de datos ya se está actualizando.",
                    reason = "busy",
                }),
                _ => Results.Ok(new ReportRefreshDto(result.Outcome.ToString(), result.Run?.ToDto())),
            };
        })
        .WithName("RefreshReportDataset");

        // Solo lee reports.db: se abre con los orígenes apagados. Sin resultado
        // todavía es un estado normal (204), no un error: un 404 queda para un
        // conjunto que no existe, y no ensucia la consola del navegador.
        app.MapGet("/api/reports/datasets/{id:guid}/snapshot", async (
            Guid id,
            IReportDatasetStore datasets,
            IReportSnapshotStore snapshots,
            CancellationToken cancellationToken) =>
        {
            var dataset = await datasets.FindAsync(id, cancellationToken);
            if (dataset is null)
            {
                return Results.NotFound();
            }

            var snapshot = await snapshots.FindAsync(id, cancellationToken);
            return snapshot is null ? Results.NoContent() : Results.Ok(snapshot.ToDto(dataset.Version));
        })
        .WithName("GetReportSnapshot");

        app.MapGet("/api/reports/datasets/{id:guid}/runs", async (
            Guid id,
            IReportRunStore runs,
            CancellationToken cancellationToken) =>
            Results.Ok((await runs.GetRecentAsync(id, ReportRefreshService.RunHistoryLimit, cancellationToken))
                .Select(run => run.ToDto())))
        .WithName("GetReportRuns");

        app.MapGet("/api/reports/datasets/{id:guid}/reports", async (
            Guid id,
            ISavedReportStore reports,
            CancellationToken cancellationToken) =>
            Results.Ok((await reports.GetByDatasetAsync(id, cancellationToken)).Select(report => report.ToDto())))
        .WithName("GetSavedReports");

        app.MapPut("/api/reports/reports/{id:guid}", async (
            Guid id,
            SavedReportDto request,
            IReportDatasetStore datasets,
            ISavedReportStore reports,
            CancellationToken cancellationToken) =>
        {
            var name = request.Name?.Trim() ?? string.Empty;
            if (name.Length == 0
                || int.TryParse(request.Visual, out _)
                || !Enum.TryParse<ReportVisualKind>(request.Visual, ignoreCase: true, out var visual)
                || !Enum.IsDefined(visual)
                || !IsJson(request.Settings))
            {
                return Results.BadRequest(new { message = "Un reporte necesita nombre, tipo de visualización y ajustes." });
            }

            if (await datasets.FindAsync(request.DatasetId, cancellationToken) is null)
            {
                return Results.NotFound(new { message = "El conjunto de datos de este reporte ya no existe." });
            }

            var saved = await reports.SaveAsync(new SavedReport
            {
                Id = id,
                DatasetId = request.DatasetId,
                Name = name,
                Visual = visual,
                Settings = request.Settings,
            }, cancellationToken);
            return Results.Ok(saved.ToDto());
        })
        .WithName("SaveReport");

        app.MapDelete("/api/reports/reports/{id:guid}", async (
            Guid id,
            ISavedReportStore reports,
            CancellationToken cancellationToken) =>
        {
            await reports.DeleteAsync(id, cancellationToken);
            return Results.NoContent();
        })
        .WithName("DeleteReport");

        // Con las credenciales guardadas: el constructor no pide contraseñas.
        app.MapGet("/api/reports/connections/{id:guid}/databases", async (
            Guid id,
            ReportDatasetPreviewService previews,
            CancellationToken cancellationToken) =>
            Results.Ok(await previews.ListDatabasesAsync(id, cancellationToken)))
        .WithName("ListReportSourceDatabases");

        // Sin guardar: el constructor previsualiza lo que se está editando.
        app.MapPost("/api/reports/datasets/preview", async (
            ReportDatasetDto request,
            ReportDatasetPreviewService previews,
            CancellationToken cancellationToken) =>
        {
            var dataset = request.ToDomain(request.Id == Guid.Empty ? Guid.NewGuid() : request.Id);
            var errors = ReportDatasetValidator.Validate(dataset with { Name = "vista previa" }, requireJoin: false);
            if (errors.Count > 0)
            {
                return Results.BadRequest(new { message = string.Join(" ", errors), errors });
            }

            return Results.Ok((await previews.PreviewAsync(dataset, cancellationToken)).ToDto());
        })
        .WithName("PreviewReportDataset");
    }

    private static bool IsJson(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return false;
        }

        try
        {
            using var _ = System.Text.Json.JsonDocument.Parse(text);
            return true;
        }
        catch (System.Text.Json.JsonException)
        {
            return false;
        }
    }
}
