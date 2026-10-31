using System.Collections;
using System.Reflection;

namespace EcoHousingExporter.Export;

public sealed class ReflectionEcoLiveEconomyReader : IEcoLiveEconomyReader
{
    private readonly Func<IEnumerable<object>> storeSource;
    private readonly Func<IReadOnlyList<string>>? warningSource;

    public ReflectionEcoLiveEconomyReader(Func<IEnumerable<object>> storeSource, Func<IReadOnlyList<string>>? warningSource = null)
    {
        this.storeSource = storeSource;
        this.warningSource = warningSource;
    }

    public EcoLiveEconomySnapshot ReadSnapshot()
    {
        var warnings = new List<string>();
        var offers = new List<EcoLiveStoreOffer>();
        var currencies = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var store in SafeStores(warnings))
        {
            var parent = ReadObject(store, "Parent");
            var storeName = ReadString(store, "StoreName", "Name", "DisplayName")
                ?? (parent is null ? null : ReadString(parent, "Name", "DisplayName", "FriendlyName", "MarkedUpName"));
            var seller = ReadString(store, "Seller", "Owner", "OwnerName", "User", "Creator", "NameOfCreator")
                ?? (parent is null ? null : ReadString(parent, "NameOfCreator", "Owners", "OwnersMarkedUpName", "Creator"));
            var storeId = ReadString(store, "StoreId", "Id", "ID", "NetId")
                ?? (parent is null ? null : ReadString(parent, "ObjectID", "Id", "ID", "NetId"));
            var sellerId = ReadString(store, "SellerId", "OwnerId", "UserId", "CreatorId")
                ?? (parent is null ? null : ReadString(parent, "CreatorId", "CreatorID", "Owners"));
            var storeCurrency = ReadCurrency(store) ?? ReadString(store, "CurrencyName");
            var foundOffer = false;

            foreach (var offerObject in FindOfferObjects(store))
            {
                foundOffer = true;
                if (TryReadOffer(offerObject, storeName, seller, storeId, sellerId, storeCurrency, warnings) is { } offer)
                {
                    offers.Add(offer);
                    currencies.Add(offer.Currency);
                }
            }

            if (!foundOffer)
            {
                warnings.Add($"No readable sell offers found on store object {store.GetType().Name}.");
            }
        }

        if (warningSource is not null)
        {
            warnings.AddRange(warningSource());
        }

        return new EcoLiveEconomySnapshot(
            Currencies: currencies.Select(currency => new EcoLiveCurrency(currency)).ToArray(),
            SellOffers: offers,
            Warnings: warnings);
    }

    private IEnumerable<object> SafeStores(List<string> warnings)
    {
        IEnumerable<object> stores;
        try
        {
            stores = storeSource();
        }
        catch (Exception ex)
        {
            warnings.Add($"Could not enumerate live Eco store objects: {ex.Message}");
            return [];
        }

        return stores.Where(store => store is not null).ToArray();
    }

    private static EcoLiveStoreOffer? TryReadOffer(object offer, string? storeName, string? seller, string? storeId, string? sellerId, string? storeCurrency, List<string> warnings)
    {
        if (ReadBool(offer, "Buying", "IsBuy", "Buy") == true) return null;

        var itemClass = ReadItemClass(offer);
        var quantity = ReadNumber(offer, "Quantity", "Stock", "AvailableQuantity", "Available", "Count", "Amount");
        var stackObject = ReadObject(offer, "Stack", "ItemStack");
        if (quantity is null && stackObject is not null)
        {
            quantity = ReadNumber(stackObject, "Quantity", "Stock", "AvailableQuantity", "Available", "Count", "Amount");
        }
        var valueObject = ReadObject(offer, "Value");
        var priceObject = ReadObject(offer, "UnitPrice", "Price", "PricePerUnit", "Cost")
            ?? (valueObject is null ? null : ReadObject(valueObject, "UnitPrice", "Price", "PricePerUnit", "Cost"));
        var price = ReadNumber(offer, "UnitPrice", "Price", "PricePerUnit", "Cost");
        var currency = ReadCurrency(offer)
            ?? (priceObject is null ? null : ReadCurrency(priceObject))
            ?? (valueObject is null ? null : ReadCurrency(valueObject))
            ?? storeCurrency;

        if (string.IsNullOrWhiteSpace(itemClass))
        {
            warnings.Add($"Dropped store offer from {storeName ?? "unknown store"}: item class is missing.");
            return null;
        }
        if (quantity is null)
        {
            warnings.Add($"Dropped store offer for {itemClass}: quantity is missing.");
            return null;
        }
        if (price is null)
        {
            warnings.Add($"Dropped store offer for {itemClass}: price is missing.");
            return null;
        }
        if (string.IsNullOrWhiteSpace(currency))
        {
            warnings.Add($"Dropped store offer for {itemClass}: currency is missing.");
            return null;
        }

        return new EcoLiveStoreOffer(
            ItemClass: NormalizeClassName(itemClass),
            Quantity: quantity.Value,
            UnitPrice: price.Value,
            Currency: currency,
            StoreName: storeName ?? ReadString(offer, "StoreName", "Store"),
            Seller: seller ?? ReadString(offer, "Seller", "Owner", "OwnerName"),
            StoreId: storeId,
            SellerId: sellerId,
            TaxRate: ReadNumber(offer, "TaxRate", "Tax"),
            Fee: ReadNumber(offer, "Fee", "FlatFee"));
    }

    private static IEnumerable<object> FindOfferObjects(object store)
    {
        var visited = new HashSet<object>(ReferenceEqualityComparer.Instance);
        foreach (var candidate in WalkReadableMembers(store, depth: 0, visited))
        {
            if (LooksLikeOffer(candidate)) yield return candidate;
        }
    }

    private static IEnumerable<object> WalkReadableMembers(object value, int depth, HashSet<object> visited)
    {
        if (depth > 4 || IsSimple(value.GetType()) || !visited.Add(value)) yield break;

        foreach (var memberValue in ReadMemberValues(value))
        {
            if (memberValue is null) continue;
            if (memberValue is string) continue;
            if (memberValue is IEnumerable enumerable)
            {
                foreach (var entry in enumerable)
                {
                    if (entry is not null) yield return entry;
                    if (entry is not null)
                    {
                        foreach (var nested in WalkReadableMembers(entry, depth + 1, visited)) yield return nested;
                    }
                }
                continue;
            }

            yield return memberValue;
            foreach (var nested in WalkReadableMembers(memberValue, depth + 1, visited)) yield return nested;
        }
    }

    private static IEnumerable<object?> ReadMemberValues(object value)
    {
        var type = value.GetType();
        foreach (var property in type.GetProperties(BindingFlags.Public | BindingFlags.Instance))
        {
            if (property.GetIndexParameters().Length > 0 || property.GetMethod is null) continue;
            if (!LooksEconomyRelated(property.Name) && !LooksOfferContainer(property.PropertyType)) continue;
            object? propertyValue;
            try { propertyValue = property.GetValue(value); }
            catch { continue; }
            yield return propertyValue;
        }

        foreach (var field in type.GetFields(BindingFlags.Public | BindingFlags.Instance))
        {
            if (!LooksEconomyRelated(field.Name) && !LooksOfferContainer(field.FieldType)) continue;
            object? fieldValue;
            try { fieldValue = field.GetValue(value); }
            catch { continue; }
            yield return fieldValue;
        }
    }

    private static bool LooksLikeOffer(object value)
    {
        var type = value.GetType();
        if (type.Name.Contains("Buy", StringComparison.OrdinalIgnoreCase)) return false;
        var hasItem = ReadItemClass(value) is not null;
        var stackObject = ReadObject(value, "Stack", "ItemStack");
        var hasQuantity = ReadNumber(value, "Quantity", "Stock", "AvailableQuantity", "Available", "Count", "Amount") is not null
            || (stackObject is not null && ReadNumber(stackObject, "Quantity", "Stock", "AvailableQuantity", "Available", "Count", "Amount") is not null);
        var hasPrice = ReadNumber(value, "UnitPrice", "Price", "PricePerUnit", "Cost") is not null;
        var looksLikeKeyValueOffer = HasReadableMember(type, "Key", "Value") && hasItem && hasQuantity && hasPrice;
        return looksLikeKeyValueOffer
            || (type.Name.Contains("Offer", StringComparison.OrdinalIgnoreCase)
                || type.Name.Contains("Listing", StringComparison.OrdinalIgnoreCase)
                || type.Name.Contains("Trade", StringComparison.OrdinalIgnoreCase)
                || HasReadableMember(type, "Price", "UnitPrice", "PricePerUnit"))
            && hasItem
            && hasQuantity;
    }

    private static bool LooksEconomyRelated(string name) =>
        name.Contains("Store", StringComparison.OrdinalIgnoreCase)
        || name.Contains("Sell", StringComparison.OrdinalIgnoreCase)
        || name.Contains("Offer", StringComparison.OrdinalIgnoreCase)
        || name.Contains("Listing", StringComparison.OrdinalIgnoreCase)
        || name.Contains("Trade", StringComparison.OrdinalIgnoreCase)
        || name.Contains("Price", StringComparison.OrdinalIgnoreCase)
        || name.Contains("Currency", StringComparison.OrdinalIgnoreCase);

    private static bool LooksOfferContainer(Type type) =>
        type != typeof(string)
        && typeof(IEnumerable).IsAssignableFrom(type)
        && (type.Name.Contains("Dictionary", StringComparison.OrdinalIgnoreCase)
            || type.Name.Contains("Map", StringComparison.OrdinalIgnoreCase)
            || type.Name.Contains("Offer", StringComparison.OrdinalIgnoreCase)
            || type.Name.Contains("Listing", StringComparison.OrdinalIgnoreCase)
            || type.Name.Contains("Trade", StringComparison.OrdinalIgnoreCase));

    private static bool HasReadableMember(Type type, params string[] names) => names.Any(name =>
        type.GetProperty(name, BindingFlags.Public | BindingFlags.Instance) is { GetMethod: not null }
        || type.GetField(name, BindingFlags.Public | BindingFlags.Instance) is not null);

    private static string? ReadItemClass(object value)
    {
        var key = ReadObject(value, "Key");
        if (key is Type keyType) return keyType.Name;
        if (key is not null && key is not string && !IsSimple(key.GetType()))
        {
            var nestedKey = ReadString(key, "ClassName", "Name", "TypeName");
            if (!string.IsNullOrWhiteSpace(nestedKey)) return nestedKey;
        }
        if (key is not null)
        {
            var keyText = key.ToString();
            if (!string.IsNullOrWhiteSpace(keyText)) return keyText;
        }

        var direct = ReadString(value, "ItemClass", "ItemType", "ItemName", "Item");
        if (!string.IsNullOrWhiteSpace(direct)) return direct;
        var stack = ReadObject(value, "Stack", "ItemStack");
        var item = ReadObject(value, "Item", "ItemType")
            ?? (stack is null ? null : ReadObject(stack, "Item", "ItemType"));
        return item is null ? null : ReadString(item, "ClassName", "Name", "TypeName") ?? item as string ?? item.GetType().Name;
    }

    private static string? ReadCurrency(object value)
    {
        var direct = ReadString(value, "Currency", "CurrencyName", "CurrencyClass", "CurrencyItemClass");
        if (!string.IsNullOrWhiteSpace(direct)) return direct;
        var currency = ReadObject(value, "Currency", "CurrencyHandle", "CurrencyItem");
        return currency is null ? null : ReadString(currency, "Name", "ClassName", "CurrencyName") ?? currency.ToString();
    }

    private static string? ReadString(object value, params string[] names)
    {
        foreach (var name in names)
        {
            var member = ReadObject(value, name);
            if (member is null) continue;
            if (member is Type type) return type.Name;
            if (member is not string && !IsSimple(member.GetType()))
            {
                var nested = ReadString(member, "Name", "ClassName", "DisplayName");
                if (!string.IsNullOrWhiteSpace(nested)) return nested;
            }
            var text = member.ToString();
            if (!string.IsNullOrWhiteSpace(text)) return text;
        }
        return null;
    }

    private static double? ReadNumber(object value, params string[] names)
    {
        return ReadNumber(value, names, depth: 0);
    }

    private static bool? ReadBool(object value, params string[] names)
    {
        foreach (var name in names)
        {
            var member = ReadObject(value, name);
            switch (member)
            {
                case bool boolean:
                    return boolean;
                case string text when bool.TryParse(text, out var parsed):
                    return parsed;
            }
        }

        return null;
    }

    private static double? ReadNumber(object value, string[] names, int depth)
    {
        foreach (var name in names)
        {
            var member = ReadObject(value, name);
            switch (member)
            {
                case null: continue;
                case double number: return number;
                case float number: return number;
                case decimal number: return (double)number;
                case int number: return number;
                case long number: return number;
                default:
                    if (double.TryParse(member.ToString(), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var parsed)) return parsed;
                    if (depth < 2 && member is not null && !IsSimple(member.GetType()))
                    {
                        var nested = ReadNumber(member, ["Amount", "Value", "Quantity", "UnitPrice", "Price", "PricePerUnit", "Cost"], depth + 1);
                        if (nested is not null) return nested;
                    }
                    break;
            }
        }

        var valueMember = ReadObject(value, "Value");
        if (depth < 2 && valueMember is not null && valueMember is not string)
        {
            var nested = ReadNumber(valueMember, names, depth + 1);
            if (nested is not null) return nested;
        }

        return null;
    }

    private static object? ReadObject(object value, string name)
    {
        var type = value.GetType();
        try
        {
            var property = type.GetProperty(name, BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase);
            if (property?.GetIndexParameters().Length == 0) return property.GetValue(value);
            var field = type.GetField(name, BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase);
            return field?.GetValue(value);
        }
        catch
        {
            return null;
        }
    }

    private static object? ReadObject(object value, params string[] names)
    {
        foreach (var name in names)
        {
            if (ReadObject(value, name) is { } result) return result;
        }
        return null;
    }

    private static string NormalizeClassName(string value)
    {
        var trimmed = value.Trim();
        if (trimmed.EndsWith("Item", StringComparison.Ordinal)) return trimmed;
        if (trimmed.EndsWith("Object", StringComparison.Ordinal)) return $"{trimmed[..^"Object".Length]}Item";
        return trimmed;
    }

    private static bool IsSimple(Type type) => type.IsPrimitive || type.IsEnum || type == typeof(string) || type == typeof(decimal) || type == typeof(DateTime) || type == typeof(DateTimeOffset);
}
