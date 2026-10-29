using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Druse.Application.Ai;
using Druse.Domain;

namespace Druse.Host.LocalApi.Endpoints;

// Son presupuestos de Druse: solo una configuración explícita puede declarar capacidad conocida.
public sealed record AiChatLimits
{
    public int MaxSqlBytes { get; init; } = 16_384;
    public int MaxSchemaBytes { get; init; } = 32_768;
    public int MaxNotesBytes { get; init; } = 16_384;
    public int MaxErrorBytes { get; init; } = 16_384;
    public int MaxPlanBytes { get; init; } = 16_384;
    public int MaxRowsBytes { get; init; } = 32_768;
    public int MaxContextBytes { get; init; } = 49_152;
    public int MaxHistoryBytes { get; init; } = 32_768;
    public int MaxInputBytes { get; init; } = 65_536;
    public int MaxQuestionBytes { get; init; } = 8_192;
    public int MaxHistoryTurns { get; init; } = 20;
    public int WindowTokens { get; init; } = 16_384;
    public int QuestionReserveTokens { get; init; } = 1_024;
    public int ResponseReserveTokens { get; init; } = 2_048;
    public bool CapacityKnown { get; init; }
}

public sealed record AiChatIssue(string Code, int Used, int Max);
public sealed record AiChatUsage(int SqlBytes, int SchemaBytes, int NotesBytes, int ErrorBytes, int RowsBytes, int PlanBytes, int ContextBytes,
    int HistoryBytes, int InputBytes, int QuestionBytes, int HistoryTurns,
    int EstimatedTokens, int QuestionReserveTokens, int ResponseReserveTokens);
public sealed record AiPreviewMessage(string Role, string Text);
public sealed record AiChatPreview(string Hash, string Context, IReadOnlyList<AiPreviewMessage> Messages,
    AiChatLimits Limits, AiChatUsage Usage, IReadOnlyList<AiChatIssue> Issues)
{
    public bool Valid => Issues.Count == 0;
}

internal static partial class AiEndpoints
{
    private static IResult? ValidateChat(AiProviderProfile profile, AiChatDto request)
    {
        if (request.Model != profile.Model || request.Disclosure != ToDto(profile, false).Disclosure
            || request.ShareBusinessNotes != profile.ShareBusinessNotes)
        {
            return Results.Conflict(new { message = "La configuración del proveedor cambió. Actualiza el chat antes de volver a preguntar." });
        }
        if (request.Messages is null || request.Messages.Count == 0 || request.Messages.Count % 2 == 0
            || request.Messages.Where((message, index) => message is null ||
                message.Role != (index % 2 == 0 ? "user" : "assistant") || string.IsNullOrWhiteSpace(message.Text)
                || (message.Role == "assistant" && message.Context is not null)).Any())
        {
            return Results.BadRequest(new { message = "La conversación solo admite preguntas y respuestas alternadas; el contexto acompaña a las preguntas." });
        }
        return ValidateRows(profile, request) ?? ValidatePlans(profile, request);
    }

    private static AiChatPreview PrepareChat(AiProviderProfile profile, AiChatDto request, IConfiguration configuration)
    {
        var limits = configuration.GetSection($"AiChat:Providers:{profile.Id}").Get<AiChatLimits>()
            ?? configuration.GetSection("AiChat:Defaults").Get<AiChatLimits>() ?? new AiChatLimits();
        var byteLimits = new[] { limits.MaxSqlBytes, limits.MaxSchemaBytes, limits.MaxNotesBytes, limits.MaxErrorBytes, limits.MaxRowsBytes, limits.MaxPlanBytes,
            limits.MaxContextBytes, limits.MaxHistoryBytes, limits.MaxInputBytes, limits.MaxQuestionBytes };
        if (byteLimits.Any(value => value is < 1 or > 1_048_576) || limits.MaxHistoryTurns is < 0 or > 100
            || limits.WindowTokens is < 1024 or > 1_000_000 || limits.QuestionReserveTokens < 1
            || limits.ResponseReserveTokens < 1 || (long)limits.QuestionReserveTokens + limits.ResponseReserveTokens >= limits.WindowTokens)
        {
            throw new InvalidOperationException("La configuración AiChat contiene límites fuera de rango.");
        }

        static int Bytes(string? value) => Encoding.UTF8.GetByteCount(value ?? "");
        // No es un tokenizador: se muestra como estimación, con margen por mensaje.
        static int Estimate(int bytes) => (int)Math.Ceiling(bytes / 3d);
        var issues = new List<AiChatIssue>();
        void Check(string code, int used, int max)
        {
            if (used > max && !issues.Any(issue => issue.Code == code))
            {
                issues.Add(new AiChatIssue(code, used, max));
            }
        }
        (int Sql, int Schema, int Notes, int Error, int Rows, int Plan, int Context) Measure(AiContextDto? attached)
        {
            var allowed = profile.Disclosure != AiDisclosure.NothingButThePrompt;
            var sql = allowed ? Bytes(attached?.Sql) : 0;
            var schema = allowed ? Bytes(attached?.Schema) : 0;
            var notes = allowed ? Bytes(DescribeNotes(profile, attached)) : 0;
            var error = allowed ? Bytes(DescribeExecutionError(attached)) : 0;
            var rows = Bytes(DescribeRows(profile, attached));
            var plan = Bytes(DescribePlan(profile, attached));
            var total = Bytes(DescribeContext(profile, attached));
            Check("sql", sql, limits.MaxSqlBytes);
            Check("schema", schema, limits.MaxSchemaBytes);
            Check("notes", notes, limits.MaxNotesBytes);
            Check("error", error, limits.MaxErrorBytes);
            Check("rows", rows, limits.MaxRowsBytes);
            Check("plan", plan, limits.MaxPlanBytes);
            Check("context", total, limits.MaxContextBytes);
            return (sql, schema, notes, error, rows, plan, total);
        }
        var current = Measure(request.Context);
        foreach (var message in request.Messages.Take(request.Messages.Count - 1))
        {
            Measure(message.Context);
        }
        var composed = Compose(profile, request);
        var messages = composed.Select(message => new AiPreviewMessage(message.Role switch
        {
            AiRole.System => "system", AiRole.Assistant => "assistant", _ => "user",
        }, message.Text)).ToArray();
        var historyBytes = messages.Skip(1).Take(messages.Length - 2).Sum(message => Bytes(message.Text));
        var inputBytes = messages.Sum(message => Bytes(message.Text));
        var questionBytes = Bytes(request.Messages[^1].Text);
        var turns = (request.Messages.Count - 1) / 2;
        var estimated = Estimate(inputBytes) + messages.Length * 32;
        var questionReserve = Math.Max(0, limits.QuestionReserveTokens - Estimate(questionBytes));
        Check("history", historyBytes, limits.MaxHistoryBytes);
        Check("input", inputBytes, limits.MaxInputBytes);
        Check("question", questionBytes, limits.MaxQuestionBytes);
        Check("turns", turns, limits.MaxHistoryTurns);
        Check("budget", estimated + questionReserve + limits.ResponseReserveTokens, limits.WindowTokens);
        var normalized = request with { PreviewHash = null };
        Check("request", JsonSerializer.SerializeToUtf8Bytes(normalized).Length, 1_048_576);
        // Se liga al destino y a los límites además del texto: un cambio exige revisar otra vez.
        var hash = Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(new { profile, limits, request = normalized, messages })));
        return new AiChatPreview(hash, DescribeContext(profile, request.Context), messages, limits,
            new AiChatUsage(current.Sql, current.Schema, current.Notes, current.Error, current.Rows, current.Plan, current.Context,
                historyBytes, inputBytes, questionBytes, turns, estimated, questionReserve, limits.ResponseReserveTokens), issues);
    }
}
