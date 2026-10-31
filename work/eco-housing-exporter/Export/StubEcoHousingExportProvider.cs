using EcoHousingExporter.Contracts;

namespace EcoHousingExporter.Export;

public sealed class StubEcoHousingExportProvider : IEcoHousingExportProvider
{
    private static readonly string[] StubWarnings =
    [
        "Eco ModKit bindings are not connected yet.",
        "This response validates the EcoHousingExporter wire contract only.",
    ];

    public EcoHousingStatusDto GetStatus() => new(
        ServerName: null,
        EcoVersion: null,
        ExporterVersion: EcoHousingApiContract.ExporterVersion,
        GeneratedAt: Now(),
        Endpoints: EcoHousingApiContract.Endpoints,
        Warnings: StubWarnings);

    public EcoHousingDataDto GetData() => new(
        Meta: new Dictionary<string, object?>
        {
            ["source"] = "EcoHousingExporter stub",
            ["generatedAt"] = Now(),
            ["counts"] = new Dictionary<string, int>
            {
                ["housing"] = 0,
                ["items"] = 0,
                ["recipes"] = 0,
                ["skills"] = 0,
                ["constructionMaterials"] = VanillaConstructionMaterials.All.Count,
            },
        },
        HousingConfig: null,
        Housing: [],
        Items: [],
        Recipes: [],
        Skills: [],
        RoomCategories: [],
        RoomTiers: [],
        WorldObjects: [],
        Occupancy: [],
        HousingEquivalenceGroups: [],
        ConstructionMaterials: VanillaConstructionMaterials.All,
        Warnings: StubWarnings);

    public EcoHousingEconomyDto GetEconomy() => new(
        FetchedAt: Now(),
        Currencies: [],
        Listings: [],
        Warnings: StubWarnings);

    private static string Now() => DateTimeOffset.UtcNow.ToString("O");
}
