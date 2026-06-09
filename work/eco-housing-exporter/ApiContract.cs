namespace EcoHousingExporter;

public sealed record EcoHousingStatusDto(
    string? ServerName,
    string? EcoVersion,
    string ExporterVersion,
    string GeneratedAt,
    IReadOnlyList<string> Endpoints,
    IReadOnlyList<string> Warnings);

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
    string? Seller);

public static class EcoHousingApiContract
{
    public const string ExporterVersion = "0.2.0-stub";
    public const string StatusPath = "/api/v1/eco-housing/status";
    public const string DataPath = "/api/v1/eco-housing/data";
    public const string EconomyPath = "/api/v1/eco-housing/economy";

    public static EcoHousingStatusDto StubStatus() => new(
        ServerName: null,
        EcoVersion: null,
        ExporterVersion: ExporterVersion,
        GeneratedAt: DateTimeOffset.UtcNow.ToString("O"),
        Endpoints: [StatusPath, DataPath, EconomyPath],
        Warnings: ["Eco ModKit references are not wired yet. This project currently documents the API contract."]);
}
