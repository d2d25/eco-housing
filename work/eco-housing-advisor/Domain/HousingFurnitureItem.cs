namespace EcoHousingAdvisor.Domain
{
    public sealed class HousingFurnitureItem
    {
        public HousingFurnitureItem(
            string itemTypeName,
            string displayName,
            string category,
            double baseValue,
            string typeForRoomLimit,
            double? diminishingReturnMultiplier)
        {
            this.ItemTypeName = itemTypeName;
            this.DisplayName = displayName;
            this.Category = category;
            this.BaseValue = baseValue;
            this.TypeForRoomLimit = typeForRoomLimit;
            this.DiminishingReturnMultiplier = diminishingReturnMultiplier;
        }

        public string ItemTypeName { get; }

        public string DisplayName { get; }

        public string Category { get; }

        public double BaseValue { get; }

        public string TypeForRoomLimit { get; }

        public double? DiminishingReturnMultiplier { get; }
    }
}
