using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using EcoHousingAdvisor.Domain;

namespace EcoHousingAdvisor.Presentation
{
    public sealed class AdvisorTextRenderer
    {
        public string RenderFurnitureGroups(IReadOnlyList<HousingFurnitureGroup> groups)
        {
            if (groups.Count == 0)
            {
                return "Eco Housing Advisor: no housing furniture found.";
            }

            var lines = new List<string>
            {
                string.Format(
                    CultureInfo.InvariantCulture,
                    "Eco Housing Advisor: {0} furniture entries in {1} groups.",
                    groups.Sum(group => group.Items.Count),
                    groups.Count),
            };

            foreach (var categoryGroup in groups.GroupBy(group => group.Category).OrderBy(group => group.Key, StringComparer.OrdinalIgnoreCase))
            {
                lines.Add(categoryGroup.Key);
                foreach (var group in categoryGroup)
                {
                    var names = string.Join(", ", group.Items.Select(item => item.DisplayName));
                    lines.Add(string.Format(
                        CultureInfo.InvariantCulture,
                        "- {0}: base {1}, type limit {2}, duplicate multiplier {3}",
                        names,
                        group.BaseValue.ToString("0.##", CultureInfo.InvariantCulture),
                        group.TypeForRoomLimit,
                        FormatMultiplier(group.DiminishingReturnMultiplier)));
                }
            }

            return string.Join(Environment.NewLine, lines);
        }

        private static string FormatMultiplier(double? multiplier)
        {
            return multiplier is null ? "unknown" : multiplier.Value.ToString("0.##", CultureInfo.InvariantCulture);
        }
    }
}
