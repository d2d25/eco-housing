using EcoHousingExporter.Contracts;

namespace EcoHousingExporter.Export;

public interface IEcoLiveDataReader
{
    EcoLiveDataSnapshot ReadSnapshot();
}

public sealed record EcoLiveDataSnapshot(
    IReadOnlyList<EcoItemDto> Items,
    IReadOnlyList<HousingValueDto> Housing,
    IReadOnlyList<RecipeDto> Recipes,
    IReadOnlyList<SkillDto> Skills,
    IReadOnlyList<RoomCategoryDto> RoomCategories,
    IReadOnlyList<RoomTierDto> RoomTiers,
    IReadOnlyList<WorldObjectRequirementDto> WorldObjects,
    IReadOnlyList<OccupancyDto> Occupancy,
    IReadOnlyList<HousingEquivalenceGroupDto> HousingEquivalenceGroups,
    IReadOnlyList<ConstructionMaterialTierDto> ConstructionMaterials,
    EcoHousingConfigDto? HousingConfig,
    IReadOnlyDictionary<string, object?> Metadata,
    IReadOnlyList<string> Warnings);

public sealed class EmptyEcoLiveDataReader : IEcoLiveDataReader
{
    public EcoLiveDataSnapshot ReadSnapshot() => new(
        Items: [],
        Housing: [],
        Recipes: [],
        Skills: [],
        RoomCategories: VanillaHousingRules.RoomCategories,
        RoomTiers: VanillaHousingRules.RoomTiers,
        WorldObjects: [],
        Occupancy: [],
        HousingEquivalenceGroups: [],
        ConstructionMaterials: VanillaConstructionMaterials.All,
        HousingConfig: null,
        Metadata: new Dictionary<string, object?>
        {
            ["source"] = "EcoHousingExporter empty live data reader",
        },
        Warnings:
        [
            "Live Eco data reader is not connected yet.",
            "Expected Eco integration targets: item registry, recipe registry, skills, housing rules, room config, world object requirements, and occupancy data.",
            "Using vanilla fallback room categories and room tiers until a live Eco housing rules collector is connected.",
        ]);
}

public sealed class EcoDataSnapshotBuilder
{
    private readonly IEcoLiveDataReader reader;
    private readonly Func<DateTimeOffset> clock;

    public EcoDataSnapshotBuilder(IEcoLiveDataReader reader, Func<DateTimeOffset>? clock = null)
    {
        this.reader = reader;
        this.clock = clock ?? (() => DateTimeOffset.UtcNow);
    }

    public EcoHousingDataDto Build()
    {
        var snapshot = reader.ReadSnapshot();
        var items = snapshot.Items
            .Where(item => !string.IsNullOrWhiteSpace(item.ClassName))
            .DistinctBy(item => item.ClassName, StringComparer.Ordinal)
            .OrderBy(item => item.FriendlyName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(item => item.ClassName, StringComparer.Ordinal)
            .ToArray();

        var housing = snapshot.Housing
            .Where(item => !string.IsNullOrWhiteSpace(item.ItemClass))
            .DistinctBy(item => item.ItemClass, StringComparer.Ordinal)
            .OrderBy(item => item.FriendlyName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(item => item.ItemClass, StringComparer.Ordinal)
            .ToArray();

        var recipes = snapshot.Recipes
            .Where(recipe => !string.IsNullOrWhiteSpace(recipe.ClassName))
            .DistinctBy(recipe => recipe.ClassName, StringComparer.Ordinal)
            .OrderBy(recipe => recipe.Name, StringComparer.OrdinalIgnoreCase)
            .ThenBy(recipe => recipe.ClassName, StringComparer.Ordinal)
            .ToArray();

        var skills = snapshot.Skills
            .Where(skill => !string.IsNullOrWhiteSpace(skill.ClassName))
            .DistinctBy(skill => skill.ClassName, StringComparer.Ordinal)
            .OrderBy(skill => skill.ProfessionGroup ?? "", StringComparer.OrdinalIgnoreCase)
            .ThenBy(skill => skill.Tier ?? 999)
            .ThenBy(skill => skill.FriendlyName, StringComparer.OrdinalIgnoreCase)
            .ToArray();

        var roomCategories = snapshot.RoomCategories
            .Where(category => !string.IsNullOrWhiteSpace(category.Name))
            .DistinctBy(category => category.Name, StringComparer.Ordinal)
            .OrderBy(category => category.Name, StringComparer.OrdinalIgnoreCase)
            .ToArray();

        var roomTiers = snapshot.RoomTiers
            .DistinctBy(tier => tier.Tier)
            .OrderBy(tier => tier.Tier)
            .ToArray();

        var worldObjects = snapshot.WorldObjects
            .Where(worldObject => !string.IsNullOrWhiteSpace(worldObject.ClassName))
            .DistinctBy(worldObject => worldObject.ClassName, StringComparer.Ordinal)
            .OrderBy(worldObject => worldObject.ClassName, StringComparer.Ordinal)
            .ToArray();

        var occupancy = snapshot.Occupancy
            .Where(entry => !string.IsNullOrWhiteSpace(entry.WorldObjectClass))
            .DistinctBy(entry => entry.WorldObjectClass, StringComparer.Ordinal)
            .OrderBy(entry => entry.WorldObjectClass, StringComparer.Ordinal)
            .ToArray();

        var equivalenceGroups = snapshot.HousingEquivalenceGroups
            .Where(group => !string.IsNullOrWhiteSpace(group.Key))
            .DistinctBy(group => group.Key, StringComparer.Ordinal)
            .OrderBy(group => group.Key, StringComparer.Ordinal)
            .ToArray();

        var constructionMaterials = snapshot.ConstructionMaterials
            .Where(entry => entry.ItemClasses.Count > 0)
            .DistinctBy(entry => entry.Tier)
            .OrderBy(entry => entry.Tier)
            .ToArray();

        var meta = new Dictionary<string, object?>(snapshot.Metadata)
        {
            ["generatedAt"] = clock().ToString("O"),
            ["counts"] = new Dictionary<string, int>
            {
                ["housing"] = housing.Length,
                ["items"] = items.Length,
                ["recipes"] = recipes.Length,
                ["skills"] = skills.Length,
                ["roomCategories"] = roomCategories.Length,
                ["roomTiers"] = roomTiers.Length,
                ["worldObjects"] = worldObjects.Length,
                ["occupancy"] = occupancy.Length,
                ["housingEquivalenceGroups"] = equivalenceGroups.Length,
                ["constructionMaterials"] = constructionMaterials.Length,
            },
        };
        ApplyVariantGroups(ref items, ref housing, recipes, meta);
        var equivalenceGroupsFromData = BuildEquivalenceGroups(ref items, ref housing, recipes, worldObjects, occupancy, meta);
        if (equivalenceGroups.Length == 0 && equivalenceGroupsFromData.Length > 0)
        {
            equivalenceGroups = equivalenceGroupsFromData;
        }

        return new EcoHousingDataDto(
            Meta: meta,
            HousingConfig: snapshot.HousingConfig,
            Housing: housing,
            Items: items,
            Recipes: recipes,
            Skills: skills,
            RoomCategories: roomCategories,
            RoomTiers: roomTiers,
            WorldObjects: worldObjects,
            Occupancy: occupancy,
            HousingEquivalenceGroups: equivalenceGroups,
            ConstructionMaterials: constructionMaterials,
            Warnings: snapshot.Warnings);
    }

    private static void ApplyVariantGroups(ref EcoItemDto[] items, ref HousingValueDto[] housing, IReadOnlyList<RecipeDto> recipes, Dictionary<string, object?> meta)
    {
        var recipesByClass = recipes.ToDictionary(recipe => recipe.ClassName, StringComparer.Ordinal);
        var groups = new Dictionary<string, (string BaseItemClass, SortedSet<string> ItemClasses)>(StringComparer.Ordinal);
        foreach (var recipe in recipes)
        {
            if (string.IsNullOrWhiteSpace(recipe.VariantBaseRecipeClass)) continue;
            if (!recipesByClass.TryGetValue(recipe.VariantBaseRecipeClass!, out var baseRecipe)) continue;
            var baseItemClass = FirstProductItemClass(baseRecipe);
            var variantItemClass = FirstProductItemClass(recipe);
            if (string.IsNullOrWhiteSpace(baseItemClass) || string.IsNullOrWhiteSpace(variantItemClass) || baseItemClass == variantItemClass) continue;
            if (!groups.TryGetValue(recipe.VariantBaseRecipeClass!, out var group))
            {
                group = (baseItemClass, new SortedSet<string>(StringComparer.Ordinal) { baseItemClass });
            }
            group.ItemClasses.Add(variantItemClass);
            groups[recipe.VariantBaseRecipeClass!] = group;
        }

        var variantsByItemClass = new Dictionary<string, (string GroupKey, string BaseItemClass, string[] ItemClasses)>(StringComparer.Ordinal);
        foreach (var group in groups)
        {
            var sorted = group.Value.ItemClasses
                .OrderBy(itemClass => itemClass == group.Value.BaseItemClass ? 0 : 1)
                .ThenBy(itemClass => itemClass, StringComparer.Ordinal)
                .ToArray();
            foreach (var itemClass in sorted)
            {
                variantsByItemClass[itemClass] = (group.Key, group.Value.BaseItemClass, sorted);
            }
        }

        if (variantsByItemClass.Count > 0)
        {
            items = items.Select(item => variantsByItemClass.TryGetValue(item.ClassName, out var variant)
                ? item with
                {
                    VariantGroupKey = variant.GroupKey,
                    VariantOfItemClass = item.ClassName == variant.BaseItemClass ? null : variant.BaseItemClass,
                    VariantItemClasses = variant.ItemClasses,
                }
                : item).ToArray();
            housing = housing.Select(item => variantsByItemClass.TryGetValue(item.ItemClass, out var variant)
                ? item with
                {
                    VariantGroupKey = variant.GroupKey,
                    VariantOfItemClass = item.ItemClass == variant.BaseItemClass ? null : variant.BaseItemClass,
                    VariantItemClasses = variant.ItemClasses,
                }
                : item).ToArray();
        }

        meta["variants"] = new Dictionary<string, int>
        {
            ["groups"] = groups.Count,
            ["items"] = groups.Values.Sum(group => group.ItemClasses.Count),
        };
    }

    private static HousingEquivalenceGroupDto[] BuildEquivalenceGroups(ref EcoItemDto[] items, ref HousingValueDto[] housing, IReadOnlyList<RecipeDto> recipes, IReadOnlyList<WorldObjectRequirementDto> worldObjects, IReadOnlyList<OccupancyDto> occupancy, Dictionary<string, object?> meta)
    {
        var worldObjectByClass = worldObjects.ToDictionary(entry => entry.ClassName, StringComparer.Ordinal);
        var occupancyByWorldObject = occupancy.ToDictionary(entry => entry.WorldObjectClass, StringComparer.Ordinal);
        var recipesByProduct = new Dictionary<string, List<RecipeDto>>(StringComparer.Ordinal);
        foreach (var recipe in recipes)
        {
            foreach (var product in recipe.Products)
            {
                if (string.IsNullOrWhiteSpace(product.ItemClass)) continue;
                var entries = recipesByProduct.GetValueOrDefault(product.ItemClass!) ?? [];
                entries.Add(recipe);
                recipesByProduct[product.ItemClass!] = entries;
            }
        }

        var grouped = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        foreach (var item in housing)
        {
            if (!string.IsNullOrWhiteSpace(item.VariantOfItemClass)) continue;
            var worldObject = !string.IsNullOrWhiteSpace(item.WorldObjectClass) && worldObjectByClass.TryGetValue(item.WorldObjectClass!, out var foundWorldObject) ? foundWorldObject : null;
            var occupancyRow = !string.IsNullOrWhiteSpace(item.WorldObjectClass) && occupancyByWorldObject.TryGetValue(item.WorldObjectClass!, out var foundOccupancy) ? foundOccupancy : null;
            var key = EquivalenceKey(item, worldObject, occupancyRow);
            var entries = grouped.GetValueOrDefault(key) ?? [];
            entries.Add(item.ItemClass);
            grouped[key] = entries;
        }

        var groups = new List<HousingEquivalenceGroupDto>();
        var housingNames = housing.ToDictionary(item => item.ItemClass, item => item.FriendlyName, StringComparer.Ordinal);
        var housingByItemClass = housing.ToDictionary(item => item.ItemClass, StringComparer.Ordinal);
        var equivalenceByItemClass = new Dictionary<string, (string Key, string[] ItemClasses)>(StringComparer.Ordinal);
        foreach (var (key, itemClasses) in grouped)
        {
            if (itemClasses.Count <= 1) continue;
            var sorted = itemClasses
                .Distinct(StringComparer.Ordinal)
                .OrderBy(itemClass => housingNames.GetValueOrDefault(itemClass) ?? itemClass, StringComparer.OrdinalIgnoreCase)
                .ToArray();
            foreach (var itemClass in sorted)
            {
                equivalenceByItemClass[itemClass] = (key, sorted);
            }
            groups.Add(new HousingEquivalenceGroupDto(
                Key: key,
                ItemClasses: sorted,
                Options: sorted.Select(itemClass =>
                {
                    var housingItem = housingByItemClass.GetValueOrDefault(itemClass);
                    var requiredSkills = recipesByProduct.GetValueOrDefault(itemClass)?
                        .Select(recipe => recipe.RequiredSkillClass)
                        .Where(skill => !string.IsNullOrWhiteSpace(skill))
                        .Distinct(StringComparer.Ordinal)
                        .Order(StringComparer.Ordinal)
                        .Select(skill => skill!)
                        .ToArray() ?? Array.Empty<string>();
                    return new HousingEquivalenceOptionDto(
                        ItemClass: itemClass,
                        VariantItemClasses: housingItem?.VariantItemClasses.Count > 0 ? housingItem.VariantItemClasses : new[] { itemClass },
                        RequiredSkillClasses: requiredSkills);
                }).ToArray()));
        }

        if (equivalenceByItemClass.Count > 0)
        {
            items = items.Select(item => equivalenceByItemClass.TryGetValue(item.ClassName, out var equivalent)
                ? item with { EquivalenceGroupKey = equivalent.Key, EquivalentItemClasses = equivalent.ItemClasses }
                : item).ToArray();
            housing = housing.Select(item => equivalenceByItemClass.TryGetValue(item.ItemClass, out var equivalent)
                ? item with { EquivalenceGroupKey = equivalent.Key, EquivalentItemClasses = equivalent.ItemClasses }
                : item).ToArray();
        }

        meta["equivalences"] = new Dictionary<string, int>
        {
            ["groups"] = groups.Count,
            ["items"] = groups.Sum(group => group.ItemClasses.Count),
        };
        return groups.OrderBy(group => group.ItemClasses.FirstOrDefault() ?? "", StringComparer.Ordinal).ToArray();
    }

    private static string? FirstProductItemClass(RecipeDto recipe) => recipe.Products.FirstOrDefault(product => !string.IsNullOrWhiteSpace(product.ItemClass))?.ItemClass;

    private static string EquivalenceKey(HousingValueDto housing, WorldObjectRequirementDto? worldObject, OccupancyDto? occupancy)
    {
        var tags = housing.Tags
            .Concat(worldObject?.Tags ?? [])
            .Distinct(StringComparer.Ordinal)
            .Where(tag => tag == "Petals" || tag.StartsWith("SurfaceTags.", StringComparison.Ordinal))
            .Order(StringComparer.Ordinal)
            .ToArray();
        var attachmentDirections = housing.AttachmentDirections
            .Concat(worldObject?.AttachmentDirections ?? [])
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
            .ToArray();
        var occupancyKey = occupancy is null ? "null" : $"{occupancy.FloorArea}:{occupancy.Width}:{occupancy.Depth}:{occupancy.Height}";
        return string.Join("|",
            housing.Category,
            housing.Value,
            housing.TypeForRoomLimit ?? "",
            housing.DiminishingReturnPercent?.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "",
            housing.DiminishingMultiplierAcrossFullProperty?.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "",
            housing.HasDynamicFurnishingValue ? "dynamic" : "static",
            string.Join(",", tags),
            string.Join(",", attachmentDirections),
            worldObject?.RequiredRoomVolume?.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "",
            worldObject?.RequiredRoomMaterialTier?.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "",
            worldObject?.RequireRoomContainment == true ? "contained" : "",
            occupancyKey);
    }
}

public static class VanillaConstructionMaterials
{
    public static readonly IReadOnlyList<ConstructionMaterialTierDto> All =
    [
        new(Tier: 0, ItemClasses: ["DirtItem", "StoneItem", "LogItem"], Source: "vanillaFallback"),
        new(Tier: 1, ItemClasses: ["HewnLogItem", "MortaredStoneItem"], Source: "vanillaFallback"),
        new(Tier: 2, ItemClasses: ["HewnLogItem", "MortaredStoneItem", "BrickItem", "LumberItem"], Source: "vanillaFallback"),
        new(Tier: 3, ItemClasses: ["LumberItem", "BrickItem", "GlassItem", "CorrugatedSteelItem"], Source: "vanillaFallback"),
        new(Tier: 4, ItemClasses: ["ReinforcedConcreteItem", "CorrugatedSteelItem", "FramedGlassItem"], Source: "vanillaFallback"),
        new(Tier: 5, ItemClasses: ["CompositeLumberItem", "ReinforcedConcreteItem", "FramedGlassItem"], Source: "vanillaFallback"),
    ];
}

public static class VanillaHousingRules
{
    public static readonly IReadOnlyList<RoomTierDto> RoomTiers =
    [
        new(Tier: 0, SoftCap: 2, HardCap: 4, DiminishingReturnPercent: 0.65),
        new(Tier: 1, SoftCap: 5, HardCap: 10, DiminishingReturnPercent: 0.65),
        new(Tier: 2, SoftCap: 10, HardCap: 20, DiminishingReturnPercent: 0.65),
        new(Tier: 3, SoftCap: 15, HardCap: 30, DiminishingReturnPercent: 0.65),
        new(Tier: 4, SoftCap: 20, HardCap: 40, DiminishingReturnPercent: 0.65),
        new(Tier: 5, SoftCap: 25, HardCap: 50, DiminishingReturnPercent: 0.65),
    ];

    public static readonly IReadOnlyList<RoomCategoryDto> RoomCategories =
    [
        new(
            Name: "Living Room",
            LocalizedName: null,
            ColorHex: "#DB48C5",
            ColorSource: "vanillaFallback",
            CanBeRoomCategory: true,
            CanAutoChooseCategory: true,
            SupportForAnyRoomType: false,
            NegatesValue: false,
            ShouldCapFromRoomMaterials: true,
            MaxSupportPercentOfPrimary: 0.25,
            MaxSupportPercentOfPrimaryPerCategory: null,
            CapToPercentOfRestOfProperty: null,
            SupportingRoomCategoryNames: ["Seating", "Cultural"]),
        new(
            Name: "Bedroom",
            LocalizedName: null,
            ColorHex: "#00B4A5",
            ColorSource: "vanillaFallback",
            CanBeRoomCategory: true,
            CanAutoChooseCategory: true,
            SupportForAnyRoomType: false,
            NegatesValue: false,
            ShouldCapFromRoomMaterials: true,
            MaxSupportPercentOfPrimary: null,
            MaxSupportPercentOfPrimaryPerCategory: null,
            CapToPercentOfRestOfProperty: null,
            SupportingRoomCategoryNames: ["Living Room", "Seating"]),
        new(
            Name: "Kitchen",
            LocalizedName: null,
            ColorHex: "#4C7BD9",
            ColorSource: "vanillaFallback",
            CanBeRoomCategory: true,
            CanAutoChooseCategory: true,
            SupportForAnyRoomType: false,
            NegatesValue: false,
            ShouldCapFromRoomMaterials: true,
            MaxSupportPercentOfPrimary: null,
            MaxSupportPercentOfPrimaryPerCategory: null,
            CapToPercentOfRestOfProperty: null,
            SupportingRoomCategoryNames: ["Seating"]),
        new(
            Name: "Bathroom",
            LocalizedName: null,
            ColorHex: "#A6E1EA",
            ColorSource: "vanillaFallback",
            CanBeRoomCategory: true,
            CanAutoChooseCategory: true,
            SupportForAnyRoomType: false,
            NegatesValue: false,
            ShouldCapFromRoomMaterials: true,
            MaxSupportPercentOfPrimary: null,
            MaxSupportPercentOfPrimaryPerCategory: null,
            CapToPercentOfRestOfProperty: 0.33,
            SupportingRoomCategoryNames: ["Seating"]),
        new(
            Name: "Outdoor",
            LocalizedName: null,
            ColorHex: "#68E897",
            ColorSource: "vanillaFallback",
            CanBeRoomCategory: true,
            CanAutoChooseCategory: false,
            SupportForAnyRoomType: false,
            NegatesValue: false,
            ShouldCapFromRoomMaterials: false,
            MaxSupportPercentOfPrimary: null,
            MaxSupportPercentOfPrimaryPerCategory: null,
            CapToPercentOfRestOfProperty: 1,
            SupportingRoomCategoryNames: ["Seating", "Cultural"]),
        new(
            Name: "Cultural",
            LocalizedName: null,
            ColorHex: null,
            ColorSource: "vanillaFallback",
            CanBeRoomCategory: true,
            CanAutoChooseCategory: true,
            SupportForAnyRoomType: false,
            NegatesValue: false,
            ShouldCapFromRoomMaterials: true,
            MaxSupportPercentOfPrimary: 0.2,
            MaxSupportPercentOfPrimaryPerCategory: new Dictionary<string, double> { ["Outdoor"] = 1 },
            CapToPercentOfRestOfProperty: null,
            SupportingRoomCategoryNames: ["Seating"]),
        new(
            Name: "Industrial",
            LocalizedName: null,
            ColorHex: "#A300B4",
            ColorSource: "vanillaFallback",
            CanBeRoomCategory: true,
            CanAutoChooseCategory: true,
            SupportForAnyRoomType: false,
            NegatesValue: true,
            ShouldCapFromRoomMaterials: true,
            MaxSupportPercentOfPrimary: null,
            MaxSupportPercentOfPrimaryPerCategory: null,
            CapToPercentOfRestOfProperty: null,
            SupportingRoomCategoryNames: []),
        new(
            Name: "Seating",
            LocalizedName: null,
            ColorHex: "#E5956E",
            ColorSource: "vanillaFallback",
            CanBeRoomCategory: false,
            CanAutoChooseCategory: true,
            SupportForAnyRoomType: false,
            NegatesValue: false,
            ShouldCapFromRoomMaterials: true,
            MaxSupportPercentOfPrimary: 0.3,
            MaxSupportPercentOfPrimaryPerCategory: null,
            CapToPercentOfRestOfProperty: null,
            SupportingRoomCategoryNames: []),
        new(
            Name: "Decoration",
            LocalizedName: null,
            ColorHex: "#6BD6B4",
            ColorSource: "vanillaFallback",
            CanBeRoomCategory: false,
            CanAutoChooseCategory: true,
            SupportForAnyRoomType: true,
            NegatesValue: false,
            ShouldCapFromRoomMaterials: true,
            MaxSupportPercentOfPrimary: 0.5,
            MaxSupportPercentOfPrimaryPerCategory: null,
            CapToPercentOfRestOfProperty: null,
            SupportingRoomCategoryNames: []),
        new(
            Name: "Lighting",
            LocalizedName: null,
            ColorHex: "#FFD6B4",
            ColorSource: "vanillaFallback",
            CanBeRoomCategory: false,
            CanAutoChooseCategory: true,
            SupportForAnyRoomType: true,
            NegatesValue: false,
            ShouldCapFromRoomMaterials: true,
            MaxSupportPercentOfPrimary: 0.5,
            MaxSupportPercentOfPrimaryPerCategory: null,
            CapToPercentOfRestOfProperty: null,
            SupportingRoomCategoryNames: []),
    ];
}
