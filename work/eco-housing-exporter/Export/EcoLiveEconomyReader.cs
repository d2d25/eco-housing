using EcoHousingExporter.Contracts;

namespace EcoHousingExporter.Export;

public interface IEcoLiveEconomyReader
{
    EcoLiveEconomySnapshot ReadSnapshot();
}

public sealed record EcoLiveEconomySnapshot(
    IReadOnlyList<EcoLiveCurrency> Currencies,
    IReadOnlyList<EcoLiveStoreOffer> SellOffers,
    IReadOnlyList<string> Warnings);

public sealed record EcoLiveCurrency(
    string Name,
    string? ClassName = null);

public sealed record EcoLiveStoreOffer(
    string ItemClass,
    double Quantity,
    double UnitPrice,
    string Currency,
    string? StoreName,
    string? Seller,
    string? StoreId = null,
    string? SellerId = null,
    double? TaxRate = null,
    double? Fee = null);

public sealed class EmptyEcoLiveEconomyReader : IEcoLiveEconomyReader
{
    public EcoLiveEconomySnapshot ReadSnapshot() => new(
        Currencies: [],
        SellOffers: [],
        Warnings:
        [
            "Live Eco economy reader is not connected yet.",
            "Expected Eco integration point: placed StoreObject instances with StoreComponent sell offers.",
        ]);
}

public sealed class EcoEconomySnapshotBuilder
{
    private readonly IEcoLiveEconomyReader reader;
    private readonly Func<DateTimeOffset> clock;

    public EcoEconomySnapshotBuilder(IEcoLiveEconomyReader reader, Func<DateTimeOffset>? clock = null)
    {
        this.reader = reader;
        this.clock = clock ?? (() => DateTimeOffset.UtcNow);
    }

    public EcoHousingEconomyDto Build()
    {
        var snapshot = reader.ReadSnapshot();
        var warnings = new List<string>(snapshot.Warnings);

        var validOffers = new List<EcoLiveStoreOffer>();
        foreach (var offer in snapshot.SellOffers)
        {
            var warning = ValidateOffer(offer);
            if (warning is not null)
            {
                warnings.Add(warning);
                continue;
            }
            validOffers.Add(offer);
        }

        var listings = validOffers
            .Select(offer => new EcoHousingListingDto(
                ItemClass: NormalizeClassName(offer.ItemClass),
                Quantity: offer.Quantity,
                Price: offer.UnitPrice,
                Currency: offer.Currency,
                StoreName: NullIfBlank(offer.StoreName),
                Seller: NullIfBlank(offer.Seller),
                StoreId: NullIfBlank(offer.StoreId),
                SellerId: NullIfBlank(offer.SellerId),
                TaxRate: offer.TaxRate,
                Fee: offer.Fee))
            .GroupBy(ListingKey)
            .Select(group => group.First() with { Quantity = group.Sum(listing => listing.Quantity) })
            .OrderBy(listing => listing.ItemClass)
            .ThenBy(listing => listing.Price)
            .ThenBy(listing => listing.StoreName)
            .ToArray();

        var currencies = snapshot.Currencies
            .Select(currency => NullIfBlank(currency.Name) ?? NullIfBlank(currency.ClassName))
            .Concat(listings.Select(listing => listing.Currency))
            .OfType<string>()
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Order(StringComparer.OrdinalIgnoreCase)
            .ToArray();

        return new EcoHousingEconomyDto(
            FetchedAt: clock().ToString("O"),
            Currencies: currencies,
            Listings: listings,
            Warnings: warnings);
    }

    private static string NormalizeClassName(string value)
    {
        var trimmed = value.Trim();
        if (trimmed.EndsWith("Item", StringComparison.Ordinal)) return trimmed;
        if (trimmed.EndsWith("Object", StringComparison.Ordinal)) return $"{trimmed[..^"Object".Length]}Item";
        return trimmed;
    }

    private static string? NullIfBlank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static string? ValidateOffer(EcoLiveStoreOffer offer)
    {
        if (string.IsNullOrWhiteSpace(offer.ItemClass)) return "Dropped economy offer without item class.";
        if (offer.Quantity <= 0) return $"Dropped economy offer for {offer.ItemClass}: quantity must be positive.";
        if (offer.UnitPrice < 0) return $"Dropped economy offer for {offer.ItemClass}: price must be non-negative.";
        if (string.IsNullOrWhiteSpace(offer.Currency)) return $"Dropped economy offer for {offer.ItemClass}: currency is missing.";
        return null;
    }

    private static string ListingKey(EcoHousingListingDto listing) => string.Join("|",
        listing.ItemClass,
        listing.Currency,
        listing.StoreName ?? "",
        listing.Seller ?? "",
        listing.StoreId ?? "",
        listing.SellerId ?? "",
        listing.Price,
        listing.TaxRate,
        listing.Fee);
}
