using EcoHousingAdvisor.Domain;
using EcoHousingAdvisor.Presentation;

namespace EcoHousingAdvisor.Tests;

public static class HousingAdvisorDomainTests
{
    public static void Main()
    {
        GroupsByCategoryBaseValueTypeLimitAndDuplicateMultiplier();
        IgnoresZeroValueFurniture();
        RendersSimpleGroupedOutput();
        Console.WriteLine("EcoHousingAdvisor fake domain tests passed.");
    }

    private static void GroupsByCategoryBaseValueTypeLimitAndDuplicateMultiplier()
    {
        var items = new[]
        {
            Item("Hewn Chair", "Seating", 2, "Chair", 0.5),
            Item("Hardwood Chair", "Seating", 2, "Chair", 0.5),
            Item("Tiny Rug", "Decoration", 1, "Rug", 0.25),
            Item("Fancy Chair", "Seating", 3, "Chair", 0.5),
        };

        var groups = new HousingFurnitureGrouper().GroupFurniture(items);

        AssertEqual(3, groups.Count, "group count");
        var seatingChair = groups.Single(group => group.Category == "Seating" && group.BaseValue == 2);
        AssertEqual("Chair", seatingChair.TypeForRoomLimit, "type limit");
        AssertEqual(0.5, seatingChair.DiminishingReturnMultiplier, "duplicate multiplier");
        AssertEqual(2, seatingChair.Items.Count, "grouped item count");
    }

    private static void IgnoresZeroValueFurniture()
    {
        var groups = new HousingFurnitureGrouper().GroupFurniture(
        [
            Item("No Value", "Decoration", 0, "None", null),
            Item("Useful Lamp", "Lighting", 1.5, "Light", 0.4),
        ]);

        AssertEqual(1, groups.Count, "positive value group count");
        AssertEqual("Lighting", groups[0].Category, "remaining category");
    }

    private static void RendersSimpleGroupedOutput()
    {
        var groups = new HousingFurnitureGrouper().GroupFurniture(
        [
            Item("Hewn Chair", "Seating", 2, "Chair", 0.5),
        ]);

        var output = new AdvisorTextRenderer().RenderFurnitureGroups(groups);

        AssertContains("Eco Housing Advisor: 1 furniture entries in 1 groups.", output);
        AssertContains("Seating", output);
        AssertContains("base 2", output);
        AssertContains("type limit Chair", output);
        AssertContains("duplicate multiplier 0.5", output);
    }

    private static HousingFurnitureItem Item(string name, string category, double baseValue, string typeLimit, double? duplicateMultiplier)
    {
        return new HousingFurnitureItem(
            $"{name.Replace(" ", string.Empty)}Item",
            name,
            category,
            baseValue,
            typeLimit,
            duplicateMultiplier);
    }

    private static void AssertEqual<T>(T expected, T actual, string label)
    {
        if (!EqualityComparer<T>.Default.Equals(expected, actual))
        {
            throw new InvalidOperationException($"{label}: expected {expected}, got {actual}.");
        }
    }

    private static void AssertContains(string expected, string actual)
    {
        if (!actual.Contains(expected, StringComparison.Ordinal))
        {
            throw new InvalidOperationException($"Expected output to contain '{expected}'. Actual output: {actual}");
        }
    }
}
