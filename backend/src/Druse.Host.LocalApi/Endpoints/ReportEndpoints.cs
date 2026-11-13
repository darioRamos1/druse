using Druse.Application.Abstractions;
using Druse.Application.Reports;
using Druse.Domain;
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
            var errors = ReportDatasetValidator.ValidateMessages(dataset);
            if (errors.Count > 0)
            {
                return Problem(errors);
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
                    message = ReportMessages.Busy().Text,
                    messages = new[] { ReportMessages.Busy().ToDto() },
                    reason = "busy",
                }),
                _ => Results.Ok(new ReportRefreshDto(result.Outcome.ToString(), result.Run?.ToDto())),
            };
        })
        .WithName("RefreshReportDataset");

        // Sin programación es un estado normal (204), como un conjunto sin resultado.
        app.MapGet("/api/reports/datasets/{id:guid}/schedule", async (
            Guid id,
            IReportScheduleStore schedules,
            CancellationToken cancellationToken) =>
            await schedules.FindAsync(id, cancellationToken) is { } schedule
                ? Results.Ok(schedule.ToDto())
                : Results.NoContent())
        .WithName("GetReportSchedule");

        // Guardar recalcula siempre el próximo horario desde ahora: al quitar la
        // pausa no se dispara de golpe un horario que venció mientras estaba parada.
        app.MapPut("/api/reports/datasets/{id:guid}/schedule", async (
            Guid id,
            ReportScheduleDto request,
            IReportDatasetStore datasets,
            IReportScheduleStore schedules,
            TimeProvider clock,
            CancellationToken cancellationToken) =>
        {
            var (rule, problem) = request.ToRule();
            if (rule is null)
            {
                return Problem([problem!]);
            }

            if (await datasets.FindAsync(id, cancellationToken) is null)
            {
                return Results.NotFound();
            }

            var saved = await schedules.SaveAsync(new ReportSchedule
            {
                DatasetId = id,
                Rule = rule,
                Paused = request.Paused,
                NextRunUtc = ReportScheduleCalendar.NextAfter(rule, clock.GetUtcNow()),
            }, cancellationToken);
            return Results.Ok(saved.ToDto());
        })
        .WithName("SaveReportSchedule");

        app.MapDelete("/api/reports/datasets/{id:guid}/schedule", async (
            Guid id,
            IReportScheduleStore schedules,
            CancellationToken cancellationToken) =>
        {
            await schedules.DeleteAsync(id, cancellationToken);
            return Results.NoContent();
        })
        .WithName("DeleteReportSchedule");

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

        // «Borrar datos guardados»: el conjunto, sus reportes y su historial se
        // quedan; vuelve a tener datos con la próxima actualización.
        app.MapDelete("/api/reports/datasets/{id:guid}/snapshot", async (
            Guid id,
            IReportSnapshotStore snapshots,
            CancellationToken cancellationToken) =>
        {
            await snapshots.DeleteAsync(id, cancellationToken);
            return Results.NoContent();
        })
        .WithName("DeleteReportSnapshot");

        app.MapGet("/api/reports/storage", async (
            IReportSnapshotStore snapshots,
            CancellationToken cancellationToken) =>
            Results.Ok((await snapshots.GetUsageAsync(cancellationToken)).ToDto()))
        .WithName("GetReportStorage");

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

        app.MapGet("/api/reports/reports", async (
            ISavedReportStore reports,
            CancellationToken cancellationToken) =>
            Results.Ok((await reports.GetAllAsync(cancellationToken)).Select(report => report.ToDto())))
        .WithName("GetAllSavedReports");

        app.MapGet("/api/reports/dashboards", async (
            IReportDashboardStore dashboards,
            CancellationToken cancellationToken) =>
            Results.Ok((await dashboards.GetAllAsync(cancellationToken)).Select(dashboard => dashboard.ToDto())))
        .WithName("GetReportDashboards");

        app.MapPut("/api/reports/dashboards/{id:guid}", async (
            Guid id,
            ReportDashboardDto request,
            IReportDashboardStore dashboards,
            CancellationToken cancellationToken) =>
        {
            var name = request.Name?.Trim() ?? string.Empty;
            if (name.Length == 0 || !IsJson(request.Model))
            {
                return Problem([ReportMessages.DashboardInvalid()]);
            }

            var saved = await dashboards.SaveAsync(
                new ReportDashboard { Id = id, Name = name, Model = request.Model }, cancellationToken);
            return Results.Ok(saved.ToDto());
        })
        .WithName("SaveReportDashboard");

        app.MapDelete("/api/reports/dashboards/{id:guid}", async (
            Guid id,
            IReportDashboardStore dashboards,
            CancellationToken cancellationToken) =>
        {
            await dashboards.DeleteAsync(id, cancellationToken);
            return Results.NoContent();
        })
        .WithName("DeleteReportDashboard");

        app.MapPost("/api/reports/exports/xlsx", (
            ReportExportRequestDto request,
            IReportWorkbookWriter writer) =>
        {
            var document = request.ToDomain();
            if (ReportExportRules.Validate(document) is { } problem)
            {
                return Problem([problem]);
            }

            return Results.File(
                writer.Write(document),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        })
        .WithName("ExportReportWorkbook");

        app.MapGet("/api/reports/identities", async (
            IReportIdentityStore identities,
            CancellationToken cancellationToken) =>
            Results.Ok((await identities.GetAllAsync(cancellationToken)).Select(identity => identity.ToDto())))
        .WithName("GetReportIdentities");

        app.MapPut("/api/reports/identities/{id:guid}", async (
            Guid id,
            ReportIdentityDto request,
            IReportIdentityStore identities,
            CancellationToken cancellationToken) =>
        {
            var details = request.Details ?? [];

            if (ReportIdentityRules.Validate(request.Name, request.Subtitle, details, request.Footer, request.BrandColor)
                is { } problem)
            {
                return Problem([problem]);
            }

            var saved = await identities.SaveAsync(new ReportIdentity
            {
                Id = id,
                Name = request.Name,
                Subtitle = request.Subtitle,
                Details = details,
                Footer = request.Footer,
                BrandColor = request.BrandColor,
                LogoOnWhite = request.LogoOnWhite,
            }, cancellationToken);
            return Results.Ok(saved.ToDto());
        })
        .WithName("SaveReportIdentity");

        app.MapDelete("/api/reports/identities/{id:guid}", async (
            Guid id,
            IReportIdentityStore identities,
            CancellationToken cancellationToken) =>
        {
            await identities.DeleteAsync(id, cancellationToken);
            return Results.NoContent();
        })
        .WithName("DeleteReportIdentity");

        app.MapGet("/api/reports/identities/{id:guid}/logo", async (
            Guid id,
            IReportIdentityStore identities,
            CancellationToken cancellationToken) =>
            await identities.GetLogoAsync(id, cancellationToken) is { } logo
                ? Results.Ok(new ReportIdentityLogoDto
                {
                    ContentType = logo.ContentType,
                    Data = Convert.ToBase64String(logo.Data),
                })
                : Results.NotFound())
        .WithName("GetReportIdentityLogo");

        app.MapPut("/api/reports/identities/{id:guid}/logo", async (
            Guid id,
            ReportIdentityLogoDto request,
            IReportIdentityStore identities,
            CancellationToken cancellationToken) =>
        {
            byte[] data;
            try
            {
                data = Convert.FromBase64String(request.Data ?? string.Empty);
            }
            catch (FormatException)
            {
                return Problem([ReportMessages.IdentityLogoType()]);
            }

            if (ReportIdentityRules.ValidateLogo(data, out var info) is { } problem)
            {
                return Problem([problem]);
            }

            // El tipo es el que dicen los bytes, no el que diga la petición.
            if (await identities.SetLogoAsync(id, new ReportIdentityLogo(info!.ContentType, data), cancellationToken))
            {
                return Results.NoContent();
            }

            var missing = ReportMessages.IdentityMissing();
            return Results.NotFound(new { message = missing.Text, messages = new[] { missing.ToDto() } });
        })
        .WithName("SaveReportIdentityLogo");

        app.MapDelete("/api/reports/identities/{id:guid}/logo", async (
            Guid id,
            IReportIdentityStore identities,
            CancellationToken cancellationToken) =>
        {
            await identities.SetLogoAsync(id, null, cancellationToken);
            return Results.NoContent();
        })
        .WithName("DeleteReportIdentityLogo");

        app.MapGet("/api/reports/templates", async (
            IReportTemplateStore templates,
            CancellationToken cancellationToken) =>
            Results.Ok((await templates.GetAllAsync(cancellationToken)).Select(template => template.ToDto())))
        .WithName("GetReportTemplates");

        app.MapPut("/api/reports/templates/{id:guid}", async (
            Guid id,
            ReportTemplateDto request,
            IReportTemplateStore templates,
            CancellationToken cancellationToken) =>
        {
            if (int.TryParse(request.Scope, out _)
                || !Enum.TryParse<ReportTemplateScope>(request.Scope, ignoreCase: true, out var scope)
                || !Enum.IsDefined(scope))
            {
                return Problem([ReportMessages.TemplateScope()]);
            }

            if (ReportTemplateRules.Validate(request.Name, request.Description, request.Model) is { } problem)
            {
                return Problem([problem]);
            }

            var saved = await templates.SaveAsync(new ReportTemplate
            {
                Id = id,
                Name = request.Name.Trim(),
                Description = request.Description,
                Scope = scope,
                Model = request.Model,
            }, cancellationToken);
            return Results.Ok(saved.ToDto());
        })
        .WithName("SaveReportTemplate");

        app.MapDelete("/api/reports/templates/{id:guid}", async (
            Guid id,
            IReportTemplateStore templates,
            CancellationToken cancellationToken) =>
        {
            await templates.DeleteAsync(id, cancellationToken);
            return Results.NoContent();
        })
        .WithName("DeleteReportTemplate");

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
                return Problem([ReportMessages.ReportInvalid()]);
            }

            if (await datasets.FindAsync(request.DatasetId, cancellationToken) is null)
            {
                return Results.NotFound(new
                {
                    message = ReportMessages.ReportDatasetMissing().Text,
                    messages = new[] { ReportMessages.ReportDatasetMissing().ToDto() },
                });
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
            var errors = ReportDatasetValidator.ValidateMessages(dataset with { Name = "vista previa" }, requireJoin: false);
            if (errors.Count > 0)
            {
                return Problem(errors);
            }

            return Results.Ok((await previews.PreviewAsync(dataset, cancellationToken)).ToDto());
        })
        .WithName("PreviewReportDataset");
    }

    /// <summary>
    /// Un rechazo con sus motivos: `messages` con clave para la ventana,
    /// `message` y `errors` en español para quien llame a la API sin catálogo.
    /// </summary>
    private static IResult Problem(IReadOnlyList<UserMessage> problems) => Results.BadRequest(new
    {
        message = string.Join(" ", problems.Select(problem => problem.Text)),
        errors = problems.Select(problem => problem.Text).ToArray(),
        messages = problems.Select(problem => problem.ToDto()).ToArray(),
    });

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
