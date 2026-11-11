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
}
