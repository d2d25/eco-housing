namespace EcoHousingExporter.Contracts;

public sealed record EcoHousingDataDto(
    Dictionary<string, object?> Meta,
    EcoHousingConfigDto? HousingConfig,
    IReadOnlyList<HousingValueDto> Housing,
    IReadOnlyList<EcoItemDto> Items,
    IReadOnlyList<RecipeDto> Recipes,
    IReadOnlyList<SkillDto> Skills,
    IReadOnlyList<RoomCategoryDto> RoomCategories,
    IReadOnlyList<RoomTierDto> RoomTiers,
    IReadOnlyList<WorldObjectRequirementDto> WorldObjects,
    IReadOnlyList<OccupancyDto> Occupancy,
    IReadOnlyList<HousingEquivalenceGroupDto> HousingEquivalenceGroups,
    IReadOnlyList<ConstructionMaterialTierDto> ConstructionMaterials,
    IReadOnlyList<string> Warnings);

public sealed record EcoHousingConfigDto(
    double? RoomCategoryDiminishingReturnRate,
    IReadOnlyList<double>? HousePointsMultiplierPerResidentsCount);

public sealed record EcoItemDto(
    string ClassName,
    string FriendlyName,
    Dictionary<string, string>? LocalizedName,
    string? Description,
    string? WorldObjectClass,
    IReadOnlyList<string> Categories,
    IReadOnlyList<string> Tags,
    bool HiddenCategory,
    bool NotInBrowser,
    bool NoIcon,
    string? IconUrl,
    IReadOnlyList<string> AttachmentDirections,
    string? VariantGroupKey,
    string? VariantOfItemClass,
    IReadOnlyList<string> VariantItemClasses,
    string? EquivalenceGroupKey,
    IReadOnlyList<string> EquivalentItemClasses,
    string? Source);

public sealed record HousingValueDto(
    string ItemClass,
    string FriendlyName,
    Dictionary<string, string>? LocalizedName,
    string? Description,
    string? WorldObjectClass,
    string Category,
    double Value,
    string? TypeForRoomLimit,
    double? DiminishingReturnPercent,
    double? DiminishingMultiplierAcrossFullProperty,
    bool HasDynamicFurnishingValue,
    IReadOnlyList<string> Categories,
    IReadOnlyList<string> Tags,
    bool HiddenCategory,
    bool NotInBrowser,
    bool NoIcon,
    string? IconUrl,
    IReadOnlyList<string> AttachmentDirections,
    string? VariantGroupKey,
    string? VariantOfItemClass,
    IReadOnlyList<string> VariantItemClasses,
    string? EquivalenceGroupKey,
    IReadOnlyList<string> EquivalentItemClasses,
    string? Source);

public sealed record RecipeElementDto(
    string? ItemClass,
    string? Tag,
    double? Quantity,
    string? Raw);

public sealed record RecipeDto(
    string ClassName,
    string Name,
    Dictionary<string, string>? LocalizedName,
    string? RequiredSkillClass,
    int? RequiredSkillLevel,
    string? CraftingTableClass,
    string? VariantBaseRecipeClass,
    IReadOnlyList<RecipeElementDto> Products,
    IReadOnlyList<RecipeElementDto> Ingredients,
    string? Source);

public sealed record SkillDto(
    string ClassName,
    string FriendlyName,
    Dictionary<string, string>? LocalizedName,
    int? Tier,
    bool IsSpecialty,
    bool IsProfession,
    string? ProfessionGroup,
    string? ParentSkillClass,
    string? IconUrl,
    string? Source);

public sealed record RoomCategoryDto(
    string Name,
    Dictionary<string, string>? LocalizedName,
    string? ColorHex,
    string? ColorSource,
    bool CanBeRoomCategory,
    bool CanAutoChooseCategory,
    bool SupportForAnyRoomType,
    bool NegatesValue,
    bool ShouldCapFromRoomMaterials,
    double? MaxSupportPercentOfPrimary,
    Dictionary<string, double>? MaxSupportPercentOfPrimaryPerCategory,
    double? CapToPercentOfRestOfProperty,
    IReadOnlyList<string> SupportingRoomCategoryNames);

public sealed record RoomTierDto(
    int Tier,
    double SoftCap,
    double HardCap,
    double DiminishingReturnPercent);

public sealed record ConstructionMaterialTierDto(
    int Tier,
    IReadOnlyList<string> ItemClasses,
    string? Source);

public sealed record PowerRequirementDto(
    string Type,
    double? Watts);

public sealed record OperationalRequirementsDto(
    PowerRequirementDto? PowerConsumption,
    PowerRequirementDto? PowerProduction,
    FuelRequirementDto? Fuel,
    WaterRequirementDto? Water,
    ChimneyRequirementDto? Chimney,
    PowerRequirementDto? Generator);

public sealed record FuelRequirementDto(
    IReadOnlyList<string> Tags,
    double? Watts);

public sealed record WaterRequirementDto(
    bool Input,
    bool SewageOutput);

public sealed record ChimneyRequirementDto(
    bool SmogOutput);

public sealed record WorldObjectRequirementDto(
    string ClassName,
    string? DisplayName,
    string? RepresentedItemClass,
    IReadOnlyList<string> Categories,
    IReadOnlyList<string> Tags,
    bool RequireRoomContainment,
    double? RequiredRoomVolume,
    int? RequiredRoomMaterialTier,
    bool RequiresOccupancy,
    bool RequiresRoomRequirements,
    IReadOnlyList<string> AttachmentDirections,
    OperationalRequirementsDto? OperationalRequirements);

public sealed record OccupancyDto(
    string WorldObjectClass,
    int BlockCount,
    int FloorArea,
    int Width,
    int Depth,
    int Height);

public sealed record HousingEquivalenceOptionDto(
    string ItemClass,
    IReadOnlyList<string> VariantItemClasses,
    IReadOnlyList<string> RequiredSkillClasses);

public sealed record HousingEquivalenceGroupDto(
    string Key,
    IReadOnlyList<string> ItemClasses,
    IReadOnlyList<HousingEquivalenceOptionDto> Options);
