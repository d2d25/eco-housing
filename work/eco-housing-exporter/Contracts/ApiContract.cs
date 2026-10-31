namespace EcoHousingExporter.Contracts;

public static class EcoHousingApiContract
{
    public const string ExporterVersion = "0.2.0-dev";
    public const string ApiPrefix = "/api/v1/eco-housing";
    public const string StatusPath = $"{ApiPrefix}/status";
    public const string DataPath = $"{ApiPrefix}/data";
    public const string EconomyPath = $"{ApiPrefix}/economy";

    public static readonly IReadOnlyList<string> Endpoints =
    [
        StatusPath,
        DataPath,
        EconomyPath,
    ];
}

public sealed record EcoHousingStatusDto(
    string? ServerName,
    string? EcoVersion,
    string ExporterVersion,
    string GeneratedAt,
    IReadOnlyList<string> Endpoints,
    IReadOnlyList<string> Warnings,
    EcoHousingDataCacheStatusDto? DataCache = null);

public sealed record EcoHousingDataCacheStatusDto(
    string State,
    string? StartedAt,
    string? ReadyAt,
    string? LastError);

public sealed record EcoHousingEconomyDto(
    string FetchedAt,
    IReadOnlyList<string> Currencies,
    IReadOnlyList<EcoHousingListingDto> Listings,
    IReadOnlyList<string> Warnings);

public sealed record EcoHousingListingDto(
    string ItemClass,
    double Quantity,
    double Price,
    string Currency,
    string? StoreName,
    string? Seller,
    string? StoreId = null,
    string? SellerId = null,
    double? TaxRate = null,
    double? Fee = null);
