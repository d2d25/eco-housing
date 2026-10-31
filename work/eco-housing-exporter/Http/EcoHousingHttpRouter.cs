using System.Text.Json;
using EcoHousingExporter.Contracts;
using EcoHousingExporter.Export;

namespace EcoHousingExporter.Http;

public sealed class EcoHousingHttpRouter
{
    private readonly IEcoHousingExportProvider provider;
    private readonly JsonSerializerOptions jsonOptions;

    public EcoHousingHttpRouter(IEcoHousingExportProvider provider, JsonSerializerOptions? jsonOptions = null)
    {
        this.provider = provider;
        this.jsonOptions = jsonOptions ?? new JsonSerializerOptions(JsonSerializerDefaults.Web)
        {
            WriteIndented = false,
        };
    }

    public EcoHousingHttpResponse Handle(string path, string method = "GET")
    {
        var normalized = NormalizePath(path);
        var normalizedMethod = string.IsNullOrWhiteSpace(method) ? "GET" : method.Trim().ToUpperInvariant();
        if (normalizedMethod == "OPTIONS")
        {
            return new EcoHousingHttpResponse(
                StatusCode: 204,
                ContentType: "application/json; charset=utf-8",
                Body: "",
                Headers: CorsHeaders());
        }
        if (normalizedMethod != "GET")
        {
            return new EcoHousingHttpResponse(
                StatusCode: 405,
                ContentType: "application/json; charset=utf-8",
                Body: JsonSerializer.Serialize(new { error = "Method not allowed", method = normalizedMethod, path = normalized }, jsonOptions),
                Headers: CorsHeaders());
        }

        object? payload = normalized switch
        {
            EcoHousingApiContract.StatusPath => provider.GetStatus(),
            EcoHousingApiContract.DataPath => provider.GetData(),
            EcoHousingApiContract.EconomyPath => provider.GetEconomy(),
            _ => null,
        };

        if (payload is null)
        {
            return new EcoHousingHttpResponse(
                StatusCode: 404,
                ContentType: "application/json; charset=utf-8",
                Body: JsonSerializer.Serialize(new { error = "Not found", path = normalized }, jsonOptions),
                Headers: CorsHeaders());
        }

        return new EcoHousingHttpResponse(
            StatusCode: 200,
            ContentType: "application/json; charset=utf-8",
            Body: JsonSerializer.Serialize(payload, jsonOptions),
            Headers: CorsHeaders());
    }

    private static string NormalizePath(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) return "/";
        var withoutQuery = path.Split('?', 2)[0]!;
        return withoutQuery.EndsWith('/') && withoutQuery.Length > 1
            ? withoutQuery[..^1]
            : withoutQuery;
    }

    private static IReadOnlyDictionary<string, string> CorsHeaders() => new Dictionary<string, string>
    {
        ["Access-Control-Allow-Origin"] = "*",
        ["Access-Control-Allow-Methods"] = "GET, OPTIONS",
        ["Access-Control-Allow-Headers"] = "Content-Type",
        ["Access-Control-Max-Age"] = "3600",
    };
}

public sealed record EcoHousingHttpResponse(
    int StatusCode,
    string ContentType,
    string Body,
    IReadOnlyDictionary<string, string> Headers);
