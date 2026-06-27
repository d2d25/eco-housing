using System.Collections.Generic;

namespace EcoHousingAdvisor.Domain
{
    public sealed class HousingFurnitureGroup
    {
        public HousingFurnitureGroup(
            string category,
            string typeForRoomLimit,
            double baseValue,
            double? diminishingReturnMultiplier,
            IReadOnlyList<HousingFurnitureItem> items)
        {
            this.Category = category;
            this.TypeForRoomLimit = typeForRoomLimit;
            this.BaseValue = baseValue;
            this.DiminishingReturnMultiplier = diminishingReturnMultiplier;
            this.Items = items;
        }

        public string Category { get; }

        public string TypeForRoomLimit { get; }

        public double BaseValue { get; }

        public double? DiminishingReturnMultiplier { get; }

        public IReadOnlyList<HousingFurnitureItem> Items { get; }
    }
}
