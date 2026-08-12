namespace Druse.Host.LocalApi.Security;

/// <summary>
/// Exige el token local en todas las rutas salvo las que deben ser públicas.
///
/// `/api/health` queda fuera porque su propósito es que el proceso que arranca la
/// aplicación pueda saber si la API ya responde, antes de tener nada más. No
/// expone ningún dato del usuario.
/// </summary>
internal sealed class TokenAuthenticationMiddleware(RequestDelegate next, LocalApiToken token)
{
    private const string HeaderName = "X-Druse-Token";

    /// <summary>Rutas que no requieren token.</summary>
    private static readonly string[] PublicPaths = ["/api/health"];

    private readonly RequestDelegate _next = next;
    private readonly LocalApiToken _token = token;

    public async Task InvokeAsync(HttpContext context)
    {
        ArgumentNullException.ThrowIfNull(context);

        var path = context.Request.Path.Value ?? string.Empty;

        var isPublic = PublicPaths.Any(
            candidate => path.Equals(candidate, StringComparison.OrdinalIgnoreCase));

        // Las peticiones de sondeo CORS no llevan cabeceras propias: rechazarlas
        // impediría al navegador enviar la petición real, que sí traerá el token.
        var isPreflight = HttpMethods.IsOptions(context.Request.Method);

        if (isPublic || isPreflight)
        {
            await _next(context);
            return;
        }

        if (!_token.Matches(context.Request.Headers[HeaderName].ToString()))
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;

            await context.Response.WriteAsJsonAsync(new
            {
                message = "Falta el token de la API local o no es válido.",
            });

            return;
        }

        await _next(context);
    }
}
