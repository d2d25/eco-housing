using System.Collections.Generic;
using System.Linq;

namespace EcoHousingAdvisor.Domain
{
    public sealed class HousingFurnitureGrouper
    {
        public IReadOnlyList<HousingFurnitureGroup> GroupFurniture(IEnumerable<HousingFurnitureItem> furniture)
        {
            return furniture
                .Where(item => item.BaseValue > 0)
                .GroupBy(item => new
                {
                    Category = Normalize(item.Category, "Unknown"),
                    TypeForRoomLimit = Normalize(item.TypeForRoomLimit, "None"),
                    item.BaseValue,
                    item.DiminishingReturnMultiplier,
                })
                .Select(group => new HousingFurnitureGroup(
                    group.Key.Category,
                    group.Key.TypeForRoomLimit,
                    group.Key.BaseValue,
                    group.Key.DiminishingReturnMultiplier,
                    group.OrderBy(item => item.DisplayName, System.StringComparer.OrdinalIgnoreCase).ToArray()))
                .OrderBy(group => group.Category, System.StringComparer.OrdinalIgnoreCase)
                .ThenByDescending(group => group.BaseValue)
                .ThenBy(group => group.TypeForRoomLimit, System.StringComparer.OrdinalIgnoreCase)
                .ToArray();
        }

        private static string Normalize(string value, string fallback)
        {
            return string.IsNullOrWhiteSpace(value) ? fallback : value.Trim();
        }
    }
}
