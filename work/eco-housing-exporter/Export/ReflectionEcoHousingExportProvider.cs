using System.Reflection;
using System.Text;
using System.Text.Json;
using EcoHousingExporter.Contracts;

namespace EcoHousingExporter.Export;

public sealed class ReflectionEcoHousingExportProvider : IEcoHousingExportProvider, IEcoHousingDataWarmup
{
    private enum SourceEnrichmentMode
    {
        Fast,
        VariantRecipes,
        TargetedRecipes,
        Full,
    }

    private readonly Func<IEnumerable<Assembly>> assemblySource;
    private readonly Func<DateTimeOffset> clock;
    private readonly IEcoLiveEconomyReader economyReader;
    private readonly IEcoLiveDataReader? dataReader;
    private readonly IReadOnlyList<string> sourceRoots;
    private readonly bool enableFullSourceEnrichment;
    private readonly object dataCacheLock = new();
    private EcoHousingDataDto? cachedData;
    private bool dataWarmupStarted;
    private bool backgroundEnrichmentStarted;
    private string dataCacheState = "empty";
    private DateTimeOffset? dataCacheStartedAt;
    private DateTimeOffset? dataCacheReadyAt;
    private string? dataCacheLastError;

    public ReflectionEcoHousingExportProvider()
        : this(() => AppDomain.CurrentDomain.GetAssemblies(), () => DateTimeOffset.UtcNow)
    {
    }

    public ReflectionEcoHousingExportProvider(Func<IEnumerable<Assembly>> assemblySource, Func<DateTimeOffset>? clock = null, IEcoLiveEconomyReader? economyReader = null, IEcoLiveDataReader? dataReader = null, IReadOnlyList<string>? sourceRoots = null)
    {
        this.assemblySource = assemblySource;
        this.clock = clock ?? (() => DateTimeOffset.UtcNow);
        this.economyReader = economyReader ?? CreateDefaultEconomyReader();
        this.dataReader = dataReader;
        var configuredSourceRoots = sourceRoots ?? ReadSourceRootsFromEnvironment();
        this.enableFullSourceEnrichment = sourceRoots is not null || configuredSourceRoots.Count > 0;
        var effectiveSourceRoots = configuredSourceRoots.Count > 0 ? configuredSourceRoots : DetectDefaultCoreSourceRoots();
        this.sourceRoots = effectiveSourceRoots
            .Where(root => !string.IsNullOrWhiteSpace(root))
            .Select(Path.GetFullPath)
            .Where(Directory.Exists)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    public EcoHousingStatusDto GetStatus()
    {
        var assemblies = EcoAssemblies().ToArray();
        var warnings = new List<string>();
        if (assemblies.Length == 0) warnings.Add("No Eco assemblies were detected in the current AppDomain.");
        warnings.Add("Reflection provider is experimental; economy extraction uses live world stores when Eco exposes WorldObjectManager.");

        return new EcoHousingStatusDto(
            ServerName: DetectServerName(),
            EcoVersion: DetectEcoVersion(assemblies),
            ExporterVersion: EcoHousingApiContract.ExporterVersion,
            GeneratedAt: Now(),
            Endpoints: EcoHousingApiContract.Endpoints,
            Warnings: warnings,
            DataCache: GetDataCacheStatus());
    }

    public EcoHousingDataDto GetData()
    {
        lock (dataCacheLock)
        {
            if (cachedData is not null) return WithCacheMetadata(cachedData);
            dataCacheStartedAt ??= DateTimeOffset.UtcNow;
            dataCacheState = dataWarmupStarted ? "warming" : "building";
        }

        var data = BuildData(enableFullSourceEnrichment ? SourceEnrichmentMode.Full : SourceEnrichmentMode.Fast);
        lock (dataCacheLock)
        {
            cachedData ??= data;
            dataCacheReadyAt = DateTimeOffset.UtcNow;
            dataCacheState = "ready";
            dataCacheLastError = null;
            data = cachedData;
        }

        StartBackgroundRecipeEnrichment();
        return WithCacheMetadata(data);
    }

    public void StartDataWarmup()
    {
        lock (dataCacheLock)
        {
            if (cachedData is not null || dataWarmupStarted) return;
            dataWarmupStarted = true;
            dataCacheState = "warming";
            dataCacheStartedAt = DateTimeOffset.UtcNow;
            dataCacheLastError = null;
        }

        _ = Task.Run(() =>
        {
            try
            {
                var data = BuildData(enableFullSourceEnrichment ? SourceEnrichmentMode.Full : SourceEnrichmentMode.Fast);
                lock (dataCacheLock)
                {
                    cachedData ??= data;
                    dataCacheReadyAt = DateTimeOffset.UtcNow;
                    dataCacheState = "ready";
                    dataCacheLastError = null;
                }

                StartBackgroundRecipeEnrichment();
            }
            catch (Exception ex)
            {
                lock (dataCacheLock)
                {
                    dataWarmupStarted = false;
                    dataCacheState = "failed";
                    dataCacheLastError = ex.Message;
                }
            }
        });
    }

    private void StartBackgroundRecipeEnrichment()
    {
        if (Environment.GetEnvironmentVariable("ECO_HOUSING_DISABLE_BACKGROUND_ENRICHMENT") == "1") return;
        if (enableFullSourceEnrichment || dataReader is not null || sourceRoots.Count == 0) return;
        lock (dataCacheLock)
        {
            if (backgroundEnrichmentStarted) return;
            backgroundEnrichmentStarted = true;
            if (cachedData is not null) dataCacheState = "enriching";
        }

        _ = Task.Run(() =>
        {
            try
            {
                var enriched = BuildData(SourceEnrichmentMode.VariantRecipes);
                lock (dataCacheLock)
                {
                    cachedData = enriched;
                    dataCacheReadyAt = DateTimeOffset.UtcNow;
                    dataCacheState = "ready";
                    dataCacheLastError = null;
                }
            }
            catch (Exception ex)
            {
                lock (dataCacheLock)
                {
                    dataCacheState = cachedData is null ? "failed" : "ready";
                    dataCacheLastError = ex.Message;
                }
            }
        });
    }

    private EcoHousingDataCacheStatusDto GetDataCacheStatus()
    {
        lock (dataCacheLock)
        {
            return new EcoHousingDataCacheStatusDto(
                State: dataCacheState,
                StartedAt: dataCacheStartedAt?.ToString("O"),
                ReadyAt: dataCacheReadyAt?.ToString("O"),
                LastError: dataCacheLastError);
        }
    }

    private EcoHousingDataDto WithCacheMetadata(EcoHousingDataDto data)
    {
        var meta = new Dictionary<string, object?>(data.Meta, StringComparer.Ordinal)
        {
            ["dataCache"] = GetDataCacheStatus(),
        };
        return data with { Meta = meta };
    }

    private EcoHousingDataDto BuildData(SourceEnrichmentMode sourceMode = SourceEnrichmentMode.Fast)
    {
        if (dataReader is not null) return new EcoDataSnapshotBuilder(dataReader, clock).Build();

        var warnings = new List<string>();
        var assemblies = EcoAssemblies().ToArray();
        if (assemblies.Length == 0) warnings.Add("No Eco assemblies were detected in the current AppDomain.");

        var housingValues = new List<HousingValueDto>();
        var items = new List<EcoItemDto>();
        var recipes = new List<RecipeDto>();
        var skills = new List<SkillDto>();
        var worldObjects = new List<WorldObjectRequirementDto>();

        var types = SafeTypes(assemblies, warnings).ToArray();
        foreach (var type in types)
        {
            if (LooksLikeItem(type))
            {
                var item = BuildItemDto(type);
                items.Add(item);

                var housingValue = TryBuildHousingValueDto(type, item, warnings);
                if (housingValue is not null) housingValues.Add(housingValue);
            }

            if (LooksLikeSkill(type))
            {
                skills.Add(BuildSkillDto(type));
            }
        }

        var itemByWorldObject = items
            .Where(item => !string.IsNullOrWhiteSpace(item.WorldObjectClass))
            .GroupBy(item => item.WorldObjectClass!, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.First().ClassName, StringComparer.Ordinal);
        foreach (var type in types.Where(LooksLikeWorldObject))
        {
            worldObjects.Add(BuildWorldObjectRequirementDto(type, itemByWorldObject));
        }

        var itemClassNames = items.Select(item => item.ClassName).ToHashSet(StringComparer.Ordinal);
        foreach (var type in types.Where(LooksLikeRecipe))
        {
            recipes.Add(BuildRecipeDto(type, itemClassNames));
        }
        var sourceOccupancy = new EcoSourceOccupancyReader().ReadOccupancy(sourceRoots, warnings);
        var sourceRecipeReader = new EcoSourceRecipeReader();
        var sourceRecipes = sourceMode switch
        {
            SourceEnrichmentMode.Full => sourceRecipeReader.ReadRecipes(sourceRoots, itemClassNames, warnings, knownRecipeFoldersOnly: false),
            SourceEnrichmentMode.TargetedRecipes => sourceRecipeReader.ReadRecipes(sourceRoots, itemClassNames, warnings, knownRecipeFoldersOnly: true),
            SourceEnrichmentMode.VariantRecipes => sourceRoots.Count > 0 ? sourceRecipeReader.ReadVariantRecipes(sourceRoots, itemClassNames, warnings) : [],
            _ => [],
        };
        var sourceOperationalRequirements = sourceMode == SourceEnrichmentMode.Full ? new EcoSourceOperationalRequirementsReader().ReadRequirements(sourceRoots, warnings) : new Dictionary<string, OperationalRequirementsDto>(StringComparer.Ordinal);
        var sourcePresentation = sourceMode == SourceEnrichmentMode.Full ? new EcoSourcePresentationReader().ReadPresentation(sourceRoots, warnings) : new Dictionary<string, SourcePresentationInfo>(StringComparer.Ordinal);
        if (sourcePresentation.Count > 0)
        {
            items = EnrichItemsWithPresentation(items, sourcePresentation).ToList();
            skills = EnrichSkillsWithPresentation(skills, sourcePresentation).ToList();
            recipes = EnrichRecipesWithPresentation(recipes, sourcePresentation).ToList();
            worldObjects = EnrichWorldObjectsWithPresentation(worldObjects, sourcePresentation).ToList();
            housingValues = EnrichHousingWithPresentation(housingValues, items).ToList();
        }
        if (sourceOperationalRequirements.Count > 0)
        {
            worldObjects = worldObjects
                .Select(worldObject => sourceOperationalRequirements.TryGetValue(worldObject.ClassName, out var operational)
                    ? worldObject with { OperationalRequirements = MergeOperationalRequirements(worldObject.OperationalRequirements, operational) }
                    : worldObject)
                .ToList();
        }
        if (sourceRecipes.Count > 0)
        {
            var recipesByClass = recipes
                .Concat(sourceRecipes)
                .GroupBy(recipe => recipe.ClassName, StringComparer.Ordinal)
                .ToDictionary(group => group.Key, group => group.OrderByDescending(RecipeCompletenessScore).First(), StringComparer.Ordinal);
            recipes = recipesByClass.Values
                .OrderBy(recipe => recipe.Name, StringComparer.OrdinalIgnoreCase)
                .ThenBy(recipe => recipe.ClassName, StringComparer.Ordinal)
                .ToList();
        }

        var meta = new Dictionary<string, object?>
        {
            ["source"] = "EcoHousingExporter reflection",
            ["ecoVersion"] = DetectEcoVersion(assemblies),
            ["assemblies"] = assemblies.Select(assembly => assembly.GetName().Name).Where(name => !string.IsNullOrWhiteSpace(name)).Order().ToArray(),
            ["extractionCompleteness"] = new Dictionary<string, string>
            {
                ["items"] = "partial-reflection",
                ["housing"] = "partial-reflection",
                ["recipes"] = "metadata-only",
                ["skills"] = "partial-reflection",
                ["roomCategories"] = "vanilla-fallback",
                ["roomTiers"] = "vanilla-fallback",
                ["worldObjects"] = "partial-reflection",
                ["occupancy"] = "missing-eco-collector",
                ["requirements"] = "partial-room-reflection",
                ["presentation"] = "partial-reflection",
                ["economy"] = "live-world-store-reflection",
            },
        };
        if (sourceRoots.Count > 0)
        {
            ((Dictionary<string, string>)meta["extractionCompleteness"]!)["recipes"] = sourceRecipes.Count > 0 ? "source-code" : "metadata-only-source-roots-empty";
            ((Dictionary<string, string>)meta["extractionCompleteness"]!)["occupancy"] = sourceOccupancy.Count > 0 ? "source-code" : "missing-eco-collector-source-roots-empty";
            ((Dictionary<string, string>)meta["extractionCompleteness"]!)["requirements"] = sourceOperationalRequirements.Count > 0 ? "source-code" : "partial-room-reflection";
            ((Dictionary<string, string>)meta["extractionCompleteness"]!)["presentation"] = sourcePresentation.Count > 0 ? "source-code" : "partial-reflection-source-roots-empty";
            meta["sourceRoots"] = sourceRoots.ToArray();
        }

        warnings.Add(BuildReflectionCompletenessWarning(sourceRecipes.Count, sourceOccupancy.Count, sourceOperationalRequirements.Count, sourcePresentation.Count));
        warnings.Add("Using vanilla fallback room categories and room tiers until a live Eco housing rules collector is connected.");

        return new EcoDataSnapshotBuilder(new StaticEcoLiveDataReader(new EcoLiveDataSnapshot(
            Items: items,
            Housing: housingValues,
            Recipes: recipes,
            Skills: skills,
            RoomCategories: VanillaHousingRules.RoomCategories,
            RoomTiers: VanillaHousingRules.RoomTiers,
            WorldObjects: worldObjects,
            Occupancy: sourceOccupancy,
            HousingEquivalenceGroups: [],
            ConstructionMaterials: VanillaConstructionMaterials.All,
            HousingConfig: null,
            Metadata: meta,
            Warnings: warnings)), clock).Build();
    }

    public EcoHousingEconomyDto GetEconomy()
    {
        var economy = new EcoEconomySnapshotBuilder(economyReader, clock).Build();
        return economy;
    }

    private static IEcoLiveEconomyReader CreateDefaultEconomyReader()
    {
        var storeSource = new EcoWorldStoreObjectSource();
        return new ReflectionEcoLiveEconomyReader(storeSource.EnumerateStores, () => storeSource.LastWarnings);
    }

    private IEnumerable<Assembly> EcoAssemblies() => assemblySource()
        .Where(assembly =>
        {
            var name = assembly.GetName().Name ?? "";
            return name.Equals("Eco", StringComparison.OrdinalIgnoreCase)
                || name.StartsWith("Eco", StringComparison.OrdinalIgnoreCase)
                || name.StartsWith("Eco.", StringComparison.OrdinalIgnoreCase)
                || name.Contains("Eco.Mods", StringComparison.OrdinalIgnoreCase)
                || assembly.GetTypesSafe().Any(type => type.Namespace?.StartsWith("Eco.", StringComparison.OrdinalIgnoreCase) == true);
        })
        .Distinct();

    private static IEnumerable<Type> SafeTypes(IEnumerable<Assembly> assemblies, List<string> warnings)
    {
        foreach (var assembly in assemblies)
        {
            foreach (var type in assembly.GetTypesSafe(warnings)) yield return type;
        }
    }

    private static bool LooksLikeItem(Type type)
    {
        if (!type.Name.EndsWith("Item", StringComparison.Ordinal)) return false;
        if (type.IsAbstract || type.IsInterface || type.ContainsGenericParameters) return false;
        return type.GetCustomAttributesData().Any(attribute => attribute.AttributeType.Name is "TagAttribute" or "LocDisplayNameAttribute")
            || InheritsTypeNamed(type, "Item");
    }

    private static bool LooksLikeSkill(Type type)
    {
        if (!type.Name.EndsWith("Skill", StringComparison.Ordinal)) return false;
        if (type.IsAbstract || type.IsInterface || type.ContainsGenericParameters) return false;
        return InheritsTypeNamed(type, "Skill")
            || HasAttribute(type, "LocDisplayNameAttribute")
            || type.Namespace?.Contains("TechTree", StringComparison.OrdinalIgnoreCase) == true;
    }

    private static SkillDto BuildSkillDto(Type type)
    {
        var friendlyName = AttributeString(type, "LocDisplayNameAttribute") ?? TypeNameToFriendlyName(type.Name, "Skill");
        var parentSkill = TryFindParentSkillClass(type);

        return new SkillDto(
            ClassName: type.Name,
            FriendlyName: friendlyName,
            LocalizedName: null,
            Tier: TryReadStaticOrInstanceInt(type, "Tier") ?? TryReadStaticOrInstanceInt(type, "SkillTier"),
            IsSpecialty: parentSkill is not null,
            IsProfession: parentSkill is null,
            ProfessionGroup: parentSkill is null ? friendlyName : TypeNameToFriendlyName(parentSkill, "Skill"),
            ParentSkillClass: parentSkill,
            IconUrl: null,
            Source: type.Assembly.GetName().Name);
    }

    private static bool LooksLikeRecipe(Type type)
    {
        if (!type.Name.EndsWith("Recipe", StringComparison.Ordinal)) return false;
        if (type.IsAbstract || type.IsInterface || type.ContainsGenericParameters) return false;
        return InheritsTypeNamed(type, "RecipeFamily")
            || HasAttribute(type, "RequiresSkillAttribute")
            || type.Namespace?.Contains("TechTree", StringComparison.OrdinalIgnoreCase) == true;
    }

    private static RecipeDto BuildRecipeDto(Type type, IReadOnlySet<string> itemClassNames)
    {
        var requiredSkill = TryReadRequiresSkill(type);
        var product = GuessRecipeProduct(type, itemClassNames);

        return new RecipeDto(
            ClassName: type.Name,
            Name: TypeNameToFriendlyName(type.Name, "Recipe"),
            LocalizedName: null,
            RequiredSkillClass: requiredSkill.SkillClass,
            RequiredSkillLevel: requiredSkill.Level,
            CraftingTableClass: null,
            VariantBaseRecipeClass: null,
            Products: product is null ? [] : [new RecipeElementDto(product, null, 1, "guessed-from-recipe-name")],
            Ingredients: [],
            Source: type.Assembly.GetName().Name);
    }

    private static bool LooksLikeWorldObject(Type type)
    {
        if (!type.Name.EndsWith("Object", StringComparison.Ordinal)) return false;
        if (type.IsAbstract || type.IsInterface || type.ContainsGenericParameters) return false;
        return InheritsTypeNamed(type, "WorldObject")
            || HasAttribute(type, "RequireComponentAttribute")
            || HasAttribute(type, "RequireRoomVolumeAttribute")
            || HasAttribute(type, "RequireRoomContainmentAttribute");
    }

    private static WorldObjectRequirementDto BuildWorldObjectRequirementDto(Type type, IReadOnlyDictionary<string, string> itemByWorldObject)
    {
        var componentNames = AttributeTypeNames(type, "RequireComponentAttribute");
        var tags = type.GetCustomAttributesData()
            .Where(attribute => attribute.AttributeType.Name == "TagAttribute")
            .Select(attribute => attribute.ConstructorArguments.FirstOrDefault().Value as string)
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value!)
            .Distinct()
            .Order()
            .ToArray();

        return new WorldObjectRequirementDto(
            ClassName: type.Name,
            DisplayName: AttributeString(type, "LocDisplayNameAttribute") ?? TypeNameToFriendlyName(type.Name, "Object"),
            RepresentedItemClass: itemByWorldObject.TryGetValue(type.Name, out var itemClass) ? itemClass : null,
            Categories: [],
            Tags: tags,
            RequireRoomContainment: HasAttribute(type, "RequireRoomContainmentAttribute"),
            RequiredRoomVolume: AttributeNumber(type, "RequireRoomVolumeAttribute"),
            RequiredRoomMaterialTier: AttributeNumber(type, "RequireRoomMaterialTierAttribute") is { } tier ? (int)Math.Ceiling(tier) : null,
            RequiresOccupancy: componentNames.Any(name => name.Contains("OccupancyRequirementComponent", StringComparison.Ordinal)),
            RequiresRoomRequirements: componentNames.Any(name => name.Contains("RoomRequirementsComponent", StringComparison.Ordinal)),
            AttachmentDirections: [],
            OperationalRequirements: BuildOperationalRequirementHints(componentNames));
    }

    private static OperationalRequirementsDto? BuildOperationalRequirementHints(IReadOnlyList<string> componentNames)
    {
        PowerRequirementDto? powerConsumption = componentNames.Any(name => name.Contains("PowerConsumptionComponent", StringComparison.Ordinal))
            ? new PowerRequirementDto("UnknownPower", null)
            : null;
        FuelRequirementDto? fuel = componentNames.Any(name => name.Contains("FuelSupplyComponent", StringComparison.Ordinal) || name.Contains("FuelConsumptionComponent", StringComparison.Ordinal))
            ? new FuelRequirementDto([], null)
            : null;
        WaterRequirementDto? water = componentNames.Any(name => name.Contains("Water", StringComparison.Ordinal) || name.Contains("Liquid", StringComparison.Ordinal))
            ? new WaterRequirementDto(Input: true, SewageOutput: false)
            : null;
        ChimneyRequirementDto? chimney = componentNames.Any(name => name.Contains("Chimney", StringComparison.Ordinal))
            ? new ChimneyRequirementDto(SmogOutput: true)
            : null;

        return powerConsumption is null && fuel is null && water is null && chimney is null
            ? null
            : new OperationalRequirementsDto(
                PowerConsumption: powerConsumption,
                PowerProduction: null,
                Fuel: fuel,
                Water: water,
                Chimney: chimney,
                Generator: null);
    }

    private static EcoItemDto BuildItemDto(Type type)
    {
        var friendlyName = AttributeString(type, "LocDisplayNameAttribute") ?? TypeNameToFriendlyName(type.Name, "Item");
        var tags = type.GetCustomAttributesData()
            .Where(attribute => attribute.AttributeType.Name == "TagAttribute")
            .Select(attribute => attribute.ConstructorArguments.FirstOrDefault().Value as string)
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value!)
            .Distinct()
            .Order()
            .ToArray();

        return new EcoItemDto(
            ClassName: type.Name,
            FriendlyName: friendlyName,
            LocalizedName: null,
            Description: null,
            WorldObjectClass: TryRepresentedWorldObjectClass(type),
            Categories: [],
            Tags: tags,
            HiddenCategory: HasAttribute(type, "HiddenAttribute"),
            NotInBrowser: HasAttribute(type, "NotInBrowserAttribute"),
            NoIcon: HasAttribute(type, "NoIconAttribute"),
            IconUrl: null,
            AttachmentDirections: [],
            VariantGroupKey: null,
            VariantOfItemClass: null,
            VariantItemClasses: [],
            EquivalenceGroupKey: null,
            EquivalentItemClasses: [],
            Source: type.Assembly.GetName().Name);
    }

    private static HousingValueDto? TryBuildHousingValueDto(Type type, EcoItemDto item, List<string> warnings)
    {
        var homeValueMember = type.GetMember("homeValue", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static).FirstOrDefault()
            ?? type.GetMember("HomeValue", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static | BindingFlags.Instance).FirstOrDefault();
        if (homeValueMember is null && !item.Tags.Contains("Housing")) return null;

        var value = TryReadHomeValueNumber(homeValueMember, "BaseValue", warnings)
            ?? TryReadHomeValueNumber(homeValueMember, "Value", warnings)
            ?? TryReadHomeValueNumber(homeValueMember, "ObjectValue", warnings)
            ?? 0;
        var category = TryReadHomeValueString(homeValueMember, "Category", warnings) ?? GuessHousingCategory(type) ?? "Unknown";
        var typeLimit = TryReadHomeValueString(homeValueMember, "TypeForRoomLimit", warnings);
        var diminishing = TryReadHomeValueNumber(homeValueMember, "DiminishingReturnPercent", warnings);
        var propertyMultiplier = TryReadHomeValueNumber(homeValueMember, "DiminishingMultiplierAcrossFullProperty", warnings)
            ?? TryReadHomeValueNumber(homeValueMember, "DiminishingReturnMultiplier", warnings);

        return new HousingValueDto(
            ItemClass: item.ClassName,
            FriendlyName: item.FriendlyName,
            LocalizedName: item.LocalizedName,
            Description: item.Description,
            WorldObjectClass: item.WorldObjectClass,
            Category: category,
            Value: value,
            TypeForRoomLimit: typeLimit,
            DiminishingReturnPercent: diminishing,
            DiminishingMultiplierAcrossFullProperty: propertyMultiplier,
            HasDynamicFurnishingValue: false,
            Categories: item.Categories,
            Tags: item.Tags,
            HiddenCategory: item.HiddenCategory,
            NotInBrowser: item.NotInBrowser,
            NoIcon: item.NoIcon,
            IconUrl: item.IconUrl,
            AttachmentDirections: item.AttachmentDirections,
            VariantGroupKey: item.VariantGroupKey,
            VariantOfItemClass: item.VariantOfItemClass,
            VariantItemClasses: item.VariantItemClasses,
            EquivalenceGroupKey: item.EquivalenceGroupKey,
            EquivalentItemClasses: item.EquivalentItemClasses,
            Source: item.Source);
    }

    private static double? TryReadHomeValueNumber(MemberInfo? member, string propertyName, List<string> warnings)
    {
        var target = TryGetMemberValue(member, warnings);
        var value = TryReadInstanceMember(target, propertyName);
        return value switch
        {
            null => null,
            double number => number,
            float number => number,
            decimal number => (double)number,
            int number => number,
            _ => double.TryParse(value.ToString(), out var parsed) ? parsed : null,
        };
    }

    private static string? TryReadHomeValueString(MemberInfo? member, string propertyName, List<string> warnings)
    {
        var target = TryGetMemberValue(member, warnings);
        var value = TryReadInstanceMember(target, propertyName);
        return NormalizeEcoName(value);
    }

    private static object? TryReadInstanceMember(object? target, string memberName)
    {
        if (target is null) return null;
        const BindingFlags flags = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance;
        var type = target.GetType();
        return type.GetProperty(memberName, flags)?.GetValue(target)
            ?? type.GetField(memberName, flags)?.GetValue(target);
    }

    private static string? NormalizeEcoName(object? value)
    {
        if (value is null) return null;
        if (value is string text) return text;

        foreach (var memberName in new[] { "Name", "DisplayName", "Text", "Key" })
        {
            var nested = TryReadInstanceMember(value, memberName);
            if (nested is string nestedText && !string.IsNullOrWhiteSpace(nestedText)) return nestedText;
            if (nested is not null && nested.GetType() != value.GetType())
            {
                var normalized = NormalizeEcoName(nested);
                if (!string.IsNullOrWhiteSpace(normalized)) return normalized;
            }
        }

        var raw = value.ToString();
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var lastDot = raw.LastIndexOf('.');
        return lastDot >= 0 && lastDot + 1 < raw.Length ? raw[(lastDot + 1)..] : raw;
    }

    private static object? TryGetMemberValue(MemberInfo? member, List<string> warnings)
    {
        try
        {
            return member switch
            {
                FieldInfo field => field.GetValue(null),
                PropertyInfo property when property.GetMethod?.IsStatic == true => property.GetValue(null),
                _ => null,
            };
        }
        catch (Exception ex)
        {
            warnings.Add($"Could not read housing value from {member?.DeclaringType?.Name}.{member?.Name}: {ex.Message}");
            return null;
        }
    }

    private static string? TryRepresentedWorldObjectClass(Type itemType)
    {
        var baseType = itemType;
        while (baseType is not null)
        {
            if (baseType.IsGenericType && baseType.Name.StartsWith("WorldObjectItem", StringComparison.Ordinal))
            {
                return baseType.GetGenericArguments().FirstOrDefault()?.Name;
            }
            baseType = baseType.BaseType;
        }
        return null;
    }

    private static string? GuessHousingCategory(Type type)
    {
        var ecopedia = type.GetCustomAttributesData().FirstOrDefault(attribute => attribute.AttributeType.Name == "EcopediaAttribute");
        return ecopedia?.ConstructorArguments
            .Select(argument => argument.Value as string)
            .FirstOrDefault(value => value is "Bathroom" or "Bedroom" or "Kitchen" or "Living Room" or "Outdoor" or "Seating" or "Decoration" or "Lighting" or "Cultural" or "Industrial");
    }

    private static string? AttributeString(Type type, string attributeName) => type.GetCustomAttributesData()
        .FirstOrDefault(attribute => attribute.AttributeType.Name == attributeName)
        ?.ConstructorArguments.FirstOrDefault().Value?.ToString();

    private static bool HasAttribute(Type type, string attributeName) => type.GetCustomAttributesData()
        .Any(attribute => attribute.AttributeType.Name == attributeName);

    private static double? AttributeNumber(Type type, string attributeName)
    {
        var value = type.GetCustomAttributesData()
            .FirstOrDefault(attribute => attribute.AttributeType.Name == attributeName)
            ?.ConstructorArguments.FirstOrDefault().Value;
        return value switch
        {
            null => null,
            double number => number,
            float number => number,
            decimal number => (double)number,
            int number => number,
            long number => number,
            _ => double.TryParse(value.ToString(), out var parsed) ? parsed : null,
        };
    }

    private static IReadOnlyList<string> AttributeTypeNames(Type type, string attributeName) => type.GetCustomAttributesData()
        .Where(attribute => attribute.AttributeType.Name == attributeName)
        .SelectMany(attribute => attribute.ConstructorArguments)
        .Select(argument => argument.Value)
        .OfType<Type>()
        .Select(componentType => componentType.Name)
        .ToArray();

    private static (string? SkillClass, int? Level) TryReadRequiresSkill(Type type)
    {
        var attribute = type.GetCustomAttributesData()
            .FirstOrDefault(attribute => attribute.AttributeType.Name == "RequiresSkillAttribute");
        if (attribute is null) return (null, null);

        var skillClass = attribute.ConstructorArguments
            .Select(argument => argument.Value)
            .OfType<Type>()
            .Select(skillType => skillType.Name)
            .FirstOrDefault();
        var level = attribute.ConstructorArguments
            .Select(argument => argument.Value)
            .OfType<int>()
            .FirstOrDefault();
        return (skillClass, level);
    }

    private static string? GuessRecipeProduct(Type recipeType, IReadOnlySet<string> itemClassNames)
    {
        var baseName = recipeType.Name.EndsWith("Recipe", StringComparison.Ordinal)
            ? recipeType.Name[..^"Recipe".Length]
            : recipeType.Name;
        var direct = $"{baseName}Item";
        return itemClassNames.Contains(direct) ? direct : null;
    }

    private static int? TryReadStaticOrInstanceInt(Type type, string propertyName)
    {
        var property = type.GetProperty(propertyName, BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static | BindingFlags.Instance);
        if (property is null) return null;

        try
        {
            object? target = property.GetMethod?.IsStatic == true ? null : TryCreateParameterless(type);
            var value = property.GetValue(target);
            return value switch
            {
                int number => number,
                double number => (int)number,
                float number => (int)number,
                _ => int.TryParse(value?.ToString(), out var parsed) ? parsed : null,
            };
        }
        catch
        {
            return null;
        }
    }

    private static object? TryCreateParameterless(Type type)
    {
        try
        {
            var constructor = type.GetConstructor(Type.EmptyTypes);
            return constructor is null ? null : Activator.CreateInstance(type);
        }
        catch
        {
            return null;
        }
    }

    private static string? TryFindParentSkillClass(Type type)
    {
        var current = type.BaseType;
        while (current is not null)
        {
            if (current.Name.EndsWith("Skill", StringComparison.Ordinal) && current.Name != "Skill") return current.Name;
            current = current.BaseType;
        }
        return null;
    }

    private static bool InheritsTypeNamed(Type type, string baseName)
    {
        var current = type.BaseType;
        while (current is not null)
        {
            if (current.Name.Equals(baseName, StringComparison.Ordinal) || current.Name.StartsWith($"{baseName}`", StringComparison.Ordinal)) return true;
            current = current.BaseType;
        }
        return false;
    }

    private static string? DetectEcoVersion(IEnumerable<Assembly> assemblies) => assemblies
        .Select(assembly => assembly.GetName().Version?.ToString())
        .FirstOrDefault(version => !string.IsNullOrWhiteSpace(version));

    private static string? DetectServerName()
    {
        var candidates = new[]
        {
            Path.Combine(Environment.CurrentDirectory, "Configs", "Network.eco"),
            Path.Combine(AppContext.BaseDirectory, "Configs", "Network.eco"),
        };

        foreach (var path in candidates.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            try
            {
                if (!File.Exists(path)) continue;
                using var document = JsonDocument.Parse(File.ReadAllText(path));
                if (document.RootElement.TryGetProperty("Name", out var name) && name.ValueKind == JsonValueKind.String)
                {
                    var value = name.GetString();
                    if (!string.IsNullOrWhiteSpace(value)) return value.Trim();
                }
            }
            catch
            {
                // Status should stay available even if Eco changes the config format.
            }
        }

        return null;
    }

    private static int RecipeCompletenessScore(RecipeDto recipe)
    {
        var score = 0;
        if (recipe.Products.Count > 0) score += 1;
        if (recipe.Ingredients.Count > 0) score += 4;
        if (!string.IsNullOrWhiteSpace(recipe.CraftingTableClass)) score += 2;
        if (!string.IsNullOrWhiteSpace(recipe.VariantBaseRecipeClass)) score += 1;
        if (!string.IsNullOrWhiteSpace(recipe.RequiredSkillClass)) score += 1;
        return score;
    }

    private static IReadOnlyList<string> ReadSourceRootsFromEnvironment()
    {
        var raw = Environment.GetEnvironmentVariable("ECO_HOUSING_SOURCE_ROOTS");
        if (string.IsNullOrWhiteSpace(raw)) return [];
        return raw.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
    }

    private static IReadOnlyList<string> DetectDefaultCoreSourceRoots()
    {
        var roots = new List<string>();
        AddEcoServerSourceRootCandidates(roots, Environment.CurrentDirectory);
        AddEcoServerSourceRootCandidates(roots, AppContext.BaseDirectory);

        return roots
            .Where(root => !string.IsNullOrWhiteSpace(root))
            .Select(Path.GetFullPath)
            .Where(Directory.Exists)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    private static void AddEcoServerSourceRootCandidates(List<string> roots, string? basePath)
    {
        if (string.IsNullOrWhiteSpace(basePath)) return;
        AddIfExists(roots, Path.Combine(basePath, "Mods", "__core__"));

        var parent = Directory.GetParent(basePath);
        if (parent is null) return;
        AddIfExists(roots, Path.Combine(parent.FullName, "Mods", "__core__"));
    }

    private static void AddIfExists(List<string> roots, string path)
    {
        if (Directory.Exists(path)) roots.Add(path);
    }

    private static string BuildReflectionCompletenessWarning(int sourceRecipeCount, int sourceOccupancyCount, int sourceOperationalRequirementCount, int sourcePresentationCount)
    {
        var enriched = new List<string>();
        if (sourceRecipeCount > 0) enriched.Add("recipes");
        if (sourceOccupancyCount > 0) enriched.Add("occupancy");
        if (sourceOperationalRequirementCount > 0) enriched.Add("operational requirements");
        if (sourcePresentationCount > 0) enriched.Add("presentation metadata");
        if (enriched.Count > 0)
        {
            var verb = enriched.Count == 1 ? "was" : "were";
            return $"Reflection /data extraction is partial: {string.Join(" and ", enriched)} {verb} enriched from Eco source files, but variants, room rules, and economy still need Eco-specific collectors.";
        }

        return "Reflection /data extraction is partial: occupancy geometry is auto-detected from Eco's core source when possible; recipe ingredients, crafting tables, operational requirements, presentation metadata, variants, and economy still need Eco-specific collectors. Set ECO_HOUSING_SOURCE_ROOTS to enable slower source-code enrichment for recipes, requirements, names, descriptions, and icon hints.";
    }

    private static IEnumerable<EcoItemDto> EnrichItemsWithPresentation(IEnumerable<EcoItemDto> items, IReadOnlyDictionary<string, SourcePresentationInfo> presentation)
    {
        foreach (var item in items)
        {
            if (!presentation.TryGetValue(item.ClassName, out var info))
            {
                yield return item;
                continue;
            }

            var friendlyName = info.DisplayName ?? item.FriendlyName;
            yield return item with
            {
                FriendlyName = friendlyName,
                LocalizedName = MergeLocalizedName(item.LocalizedName, info.LocalizedDisplayNames),
                Description = info.Description ?? item.Description,
                NoIcon = info.NoIcon ?? item.NoIcon,
                IconUrl = info.IconUrl ?? item.IconUrl,
            };
        }
    }

    private static IEnumerable<HousingValueDto> EnrichHousingWithPresentation(IEnumerable<HousingValueDto> housingValues, IReadOnlyList<EcoItemDto> items)
    {
        var itemByClass = items.ToDictionary(item => item.ClassName, StringComparer.Ordinal);
        foreach (var housing in housingValues)
        {
            if (!itemByClass.TryGetValue(housing.ItemClass, out var item))
            {
                yield return housing;
                continue;
            }

            yield return housing with
            {
                FriendlyName = item.FriendlyName,
                LocalizedName = item.LocalizedName,
                Description = item.Description,
                NoIcon = item.NoIcon,
                IconUrl = item.IconUrl,
            };
        }
    }

    private static IEnumerable<SkillDto> EnrichSkillsWithPresentation(IEnumerable<SkillDto> skills, IReadOnlyDictionary<string, SourcePresentationInfo> presentation)
    {
        foreach (var skill in skills)
        {
            if (!presentation.TryGetValue(skill.ClassName, out var info))
            {
                yield return skill;
                continue;
            }

            yield return skill with
            {
                FriendlyName = info.DisplayName ?? skill.FriendlyName,
                LocalizedName = MergeLocalizedName(skill.LocalizedName, info.LocalizedDisplayNames),
                IconUrl = info.IconUrl ?? skill.IconUrl,
            };
        }
    }

    private static IEnumerable<RecipeDto> EnrichRecipesWithPresentation(IEnumerable<RecipeDto> recipes, IReadOnlyDictionary<string, SourcePresentationInfo> presentation)
    {
        foreach (var recipe in recipes)
        {
            if (!presentation.TryGetValue(recipe.ClassName, out var info))
            {
                yield return recipe;
                continue;
            }

            yield return recipe with
            {
                Name = info.DisplayName ?? recipe.Name,
                LocalizedName = MergeLocalizedName(recipe.LocalizedName, info.LocalizedDisplayNames),
            };
        }
    }

    private static IEnumerable<WorldObjectRequirementDto> EnrichWorldObjectsWithPresentation(IEnumerable<WorldObjectRequirementDto> worldObjects, IReadOnlyDictionary<string, SourcePresentationInfo> presentation)
    {
        foreach (var worldObject in worldObjects)
        {
            if (!presentation.TryGetValue(worldObject.ClassName, out var info))
            {
                yield return worldObject;
                continue;
            }

            yield return worldObject with { DisplayName = info.DisplayName ?? worldObject.DisplayName };
        }
    }

    private static Dictionary<string, string>? MergeLocalizedName(Dictionary<string, string>? current, IReadOnlyDictionary<string, string> localizedNames)
    {
        if (localizedNames.Count == 0) return current;
        var result = current is null
            ? new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
            : new Dictionary<string, string>(current, StringComparer.OrdinalIgnoreCase);
        foreach (var (language, value) in localizedNames)
        {
            if (!string.IsNullOrWhiteSpace(language) && !string.IsNullOrWhiteSpace(value)) result[language] = value;
        }
        return result;
    }

    private static OperationalRequirementsDto? MergeOperationalRequirements(OperationalRequirementsDto? current, OperationalRequirementsDto? next)
    {
        if (current is null) return next;
        if (next is null) return current;
        var fuelTags = (current.Fuel?.Tags ?? []).Concat(next.Fuel?.Tags ?? []).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal).ToArray();
        return new OperationalRequirementsDto(
            PowerConsumption: PreferKnownPower(next.PowerConsumption, current.PowerConsumption),
            PowerProduction: PreferKnownPower(next.PowerProduction, current.PowerProduction),
            Fuel: current.Fuel is not null || next.Fuel is not null ? new FuelRequirementDto(fuelTags, next.Fuel?.Watts ?? current.Fuel?.Watts) : null,
            Water: current.Water is not null || next.Water is not null
                ? new WaterRequirementDto(
                    Input: current.Water?.Input == true || next.Water?.Input == true,
                    SewageOutput: current.Water?.SewageOutput == true || next.Water?.SewageOutput == true)
                : null,
            Chimney: current.Chimney is not null || next.Chimney is not null
                ? new ChimneyRequirementDto(SmogOutput: current.Chimney?.SmogOutput == true || next.Chimney?.SmogOutput == true)
                : null,
            Generator: PreferKnownPower(next.Generator, current.Generator));
    }

    private static PowerRequirementDto? PreferKnownPower(PowerRequirementDto? preferred, PowerRequirementDto? fallback)
    {
        if (preferred is null) return fallback;
        if (fallback is null) return preferred;
        return preferred.Type != "UnknownPower" || preferred.Watts is not null ? preferred : fallback;
    }

    private static string TypeNameToFriendlyName(string typeName, string suffix)
    {
        var name = typeName.EndsWith(suffix, StringComparison.Ordinal) ? typeName[..^suffix.Length] : typeName;
        var builder = new StringBuilder();
        for (var index = 0; index < name.Length; index++)
        {
            var character = name[index];
            if (index > 0 && char.IsUpper(character)) builder.Append(' ');
            builder.Append(character);
        }
        return builder.ToString();
    }

    private string Now() => clock().ToString("O");
}

internal sealed class StaticEcoLiveDataReader : IEcoLiveDataReader
{
    private readonly EcoLiveDataSnapshot snapshot;

    public StaticEcoLiveDataReader(EcoLiveDataSnapshot snapshot)
    {
        this.snapshot = snapshot;
    }

    public EcoLiveDataSnapshot ReadSnapshot() => snapshot;
}

internal static class ReflectionAssemblyExtensions
{
    public static IReadOnlyList<Type> GetTypesSafe(this Assembly assembly, List<string>? warnings = null)
    {
        try
        {
            return assembly.GetTypes();
        }
        catch (ReflectionTypeLoadException ex)
        {
            warnings?.Add($"Could not load all types from {assembly.GetName().Name}: {ex.Message}");
            return ex.Types.Where(type => type is not null).Cast<Type>().ToArray();
        }
        catch (Exception ex)
        {
            warnings?.Add($"Could not inspect assembly {assembly.GetName().Name}: {ex.Message}");
            return [];
        }
    }
}
