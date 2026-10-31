using System.Text.RegularExpressions;
using EcoHousingExporter.Contracts;

namespace EcoHousingExporter.Export;

public sealed class EcoSourceRecipeReader
{
    private static readonly string[] KnownRecipeSourceFolders =
    [
        Path.Combine("AutoGen", "Recipe"),
        Path.Combine("AutoGen", "WorldObject"),
        Path.Combine("AutoGen", "Block"),
        Path.Combine("AutoGen", "Item"),
    ];

    private static readonly Regex RecipeClassRegex = new(@"\bpublic\s+partial\s+class\s+(?<class>\w+Recipe)\s*:\s*(?<base>RecipeFamily|Recipe)\b", RegexOptions.Compiled);
    private static readonly Regex RequiresSkillRegex = new(@"RequiresSkill\s*\(\s*typeof\s*\(\s*(?<skill>\w+Skill)\s*\)\s*,\s*(?<level>\d+)", RegexOptions.Compiled);
    private static readonly Regex IngredientItemRegex = new(@"new\s+IngredientElement\s*\(\s*typeof\s*\(\s*(?<item>\w+Item)\s*\)\s*,\s*(?<qty>[-+]?\d+(?:\.\d+)?)", RegexOptions.Compiled);
    private static readonly Regex IngredientTagRegex = new(@"new\s+IngredientElement\s*\(\s*""(?<tag>[^""]+)""\s*,\s*(?<qty>[-+]?\d+(?:\.\d+)?)", RegexOptions.Compiled);
    private static readonly Regex ProductRegex = new(@"new\s+CraftingElement\s*<\s*(?<item>\w+Item)\s*>\s*\(\s*(?<qty>[-+]?\d+(?:\.\d+)?)?", RegexOptions.Compiled);
    private static readonly Regex AddRecipeRegex = new(@"CraftingComponent\.AddRecipe\s*\(\s*tableType\s*:\s*typeof\s*\(\s*(?<table>\w+Object)\s*\)", RegexOptions.Compiled);
    private static readonly Regex AddTagProductRegex = new(@"CraftingComponent\.AddTagProduct\s*\(\s*typeof\s*\(\s*(?<table>\w+Object)\s*\)\s*,\s*typeof\s*\(\s*(?<base>\w+Recipe)\s*\)", RegexOptions.Compiled);

    public IReadOnlyList<RecipeDto> ReadRecipes(IEnumerable<string> sourceRoots, IReadOnlySet<string> itemClassNames, List<string>? warnings = null, bool knownRecipeFoldersOnly = false)
    {
        var recipes = new Dictionary<string, RecipeDto>(StringComparer.Ordinal);
        foreach (var file in EnumerateSourceFiles(sourceRoots, warnings, knownRecipeFoldersOnly))
        {
            string source;
            try
            {
                source = File.ReadAllText(file);
            }
            catch (Exception ex)
            {
                warnings?.Add($"Could not read Eco source file {file}: {ex.Message}");
                continue;
            }
            if (!MayContainRecipe(source)) continue;

            foreach (var recipe in ParseSourceFile(source, itemClassNames, Path.GetFileName(file)))
            {
                recipes[recipe.ClassName] = recipe;
            }
        }

        return recipes.Values
            .OrderBy(recipe => recipe.Name, StringComparer.OrdinalIgnoreCase)
            .ThenBy(recipe => recipe.ClassName, StringComparer.Ordinal)
            .ToArray();
    }

    public IReadOnlyList<RecipeDto> ReadVariantRecipes(IEnumerable<string> sourceRoots, IReadOnlySet<string> itemClassNames, List<string>? warnings = null)
    {
        var recipes = new Dictionary<string, RecipeDto>(StringComparer.Ordinal);
        foreach (var file in EnumerateSourceFiles(sourceRoots, warnings, knownRecipeFoldersOnly: true))
        {
            string source;
            try
            {
                source = File.ReadAllText(file);
            }
            catch (Exception ex)
            {
                warnings?.Add($"Could not read Eco source file {file}: {ex.Message}");
                continue;
            }
            if (!source.Contains("CraftingComponent.AddTagProduct", StringComparison.Ordinal)) continue;

            foreach (var recipe in ParseSourceFile(source, itemClassNames, Path.GetFileName(file)).Where(recipe => !string.IsNullOrWhiteSpace(recipe.VariantBaseRecipeClass)))
            {
                recipes[recipe.ClassName] = recipe;
            }
        }

        return recipes.Values
            .OrderBy(recipe => recipe.Name, StringComparer.OrdinalIgnoreCase)
            .ThenBy(recipe => recipe.ClassName, StringComparer.Ordinal)
            .ToArray();
    }

    public IReadOnlyList<RecipeDto> ParseSourceFile(string source, IReadOnlySet<string> itemClassNames, string sourceName = "source")
    {
        var matches = RecipeClassRegex.Matches(source).Cast<Match>().ToArray();
        var recipes = new List<RecipeDto>();
        for (var index = 0; index < matches.Length; index++)
        {
            var match = matches[index];
            var nextStart = index + 1 < matches.Length ? matches[index + 1].Index : source.Length;
            var block = source[match.Index..nextStart];
            var className = match.Groups["class"].Value;
            var requiredSkill = TryReadRequiresSkill(ReadClassPrefix(source, match.Index));
            var products = ReadProducts(block).ToArray();
            if (products.Length == 0 && GuessRecipeProduct(className, itemClassNames) is { } guessed)
            {
                products = [new RecipeElementDto(guessed, null, 1, "guessed-from-recipe-name")];
            }

            recipes.Add(new RecipeDto(
                ClassName: className,
                Name: TypeNameToFriendlyName(className, "Recipe"),
                LocalizedName: null,
                RequiredSkillClass: requiredSkill.SkillClass,
                RequiredSkillLevel: requiredSkill.Level,
                CraftingTableClass: ReadCraftingTable(block),
                VariantBaseRecipeClass: ReadVariantBaseRecipe(block),
                Products: products,
                Ingredients: ReadIngredients(block).ToArray(),
                Source: sourceName));
        }

        return recipes;
    }

    private static IEnumerable<string> EnumerateSourceFiles(IEnumerable<string> sourceRoots, List<string>? warnings, bool knownRecipeFoldersOnly)
    {
        foreach (var root in sourceRoots.Select(root => root.Trim()).Where(root => root.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase))
        {
            if (!Directory.Exists(root))
            {
                warnings?.Add($"Eco source root does not exist: {root}");
                continue;
            }

            IEnumerable<string> files;
            try
            {
                files = knownRecipeFoldersOnly
                    ? EnumerateKnownRecipeSourceFiles(root)
                    : Directory.EnumerateFiles(root, "*.cs", SearchOption.AllDirectories);
            }
            catch (Exception ex)
            {
                warnings?.Add($"Could not enumerate Eco source root {root}: {ex.Message}");
                continue;
            }

            foreach (var file in files) yield return file;
        }
    }

    private static IEnumerable<string> EnumerateKnownRecipeSourceFiles(string root)
    {
        foreach (var folder in KnownRecipeSourceFolders)
        {
            var path = Path.Combine(root, folder);
            if (!Directory.Exists(path)) continue;
            foreach (var file in Directory.EnumerateFiles(path, "*.cs", SearchOption.AllDirectories))
            {
                yield return file;
            }
        }
    }

    private static bool MayContainRecipe(string source)
    {
        return source.Contains("Recipe", StringComparison.Ordinal)
            && (source.Contains("public partial class", StringComparison.Ordinal)
                || source.Contains("CraftingComponent.AddTagProduct", StringComparison.Ordinal)
                || source.Contains("CraftingComponent.AddRecipe", StringComparison.Ordinal));
    }

    private static IEnumerable<RecipeElementDto> ReadIngredients(string block)
    {
        foreach (Match match in IngredientItemRegex.Matches(block))
        {
            yield return new RecipeElementDto(match.Groups["item"].Value, null, ReadQuantity(match.Groups["qty"].Value), null);
        }

        foreach (Match match in IngredientTagRegex.Matches(block))
        {
            yield return new RecipeElementDto(null, match.Groups["tag"].Value, ReadQuantity(match.Groups["qty"].Value), null);
        }
    }

    private static IEnumerable<RecipeElementDto> ReadProducts(string block)
    {
        foreach (Match match in ProductRegex.Matches(block))
        {
            var quantity = match.Groups["qty"].Success && !string.IsNullOrWhiteSpace(match.Groups["qty"].Value)
                ? ReadQuantity(match.Groups["qty"].Value)
                : 1;
            yield return new RecipeElementDto(match.Groups["item"].Value, null, quantity, null);
        }
    }

    private static string? ReadCraftingTable(string block)
    {
        return AddRecipeRegex.Match(block) is { Success: true } addRecipe
            ? addRecipe.Groups["table"].Value
            : AddTagProductRegex.Match(block) is { Success: true } addTagProduct
                ? addTagProduct.Groups["table"].Value
                : null;
    }

    private static string? ReadVariantBaseRecipe(string block)
    {
        var match = AddTagProductRegex.Match(block);
        return match.Success ? match.Groups["base"].Value : null;
    }

    private static (string? SkillClass, int? Level) TryReadRequiresSkill(string attributes)
    {
        var match = RequiresSkillRegex.Match(attributes);
        return match.Success
            ? (match.Groups["skill"].Value, int.TryParse(match.Groups["level"].Value, out var level) ? level : null)
            : (null, null);
    }

    private static string ReadClassPrefix(string source, int classIndex)
    {
        var start = Math.Max(0, classIndex - 2000);
        var previousClass = source.LastIndexOf("public partial class", classIndex > 0 ? classIndex - 1 : 0, classIndex - start, StringComparison.Ordinal);
        if (previousClass >= 0) start = previousClass + "public partial class".Length;
        return source[start..classIndex];
    }

    private static double? ReadQuantity(string value) => double.TryParse(value, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var parsed) ? parsed : null;

    private static string? GuessRecipeProduct(string recipeClass, IReadOnlySet<string> itemClassNames)
    {
        var baseName = recipeClass.EndsWith("Recipe", StringComparison.Ordinal)
            ? recipeClass[..^"Recipe".Length]
            : recipeClass;
        var direct = $"{baseName}Item";
        return itemClassNames.Contains(direct) ? direct : null;
    }

    private static string TypeNameToFriendlyName(string typeName, string suffix)
    {
        var name = typeName.EndsWith(suffix, StringComparison.Ordinal) ? typeName[..^suffix.Length] : typeName;
        return Regex.Replace(name, "([a-z0-9])([A-Z])", "$1 $2");
    }
}
