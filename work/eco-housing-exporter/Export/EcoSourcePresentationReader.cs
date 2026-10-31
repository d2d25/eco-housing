using System.Text.RegularExpressions;
using System.Xml.Linq;

namespace EcoHousingExporter.Export;

public sealed record SourcePresentationInfo(
    string? DisplayName,
    IReadOnlyDictionary<string, string> LocalizedDisplayNames,
    string? Description,
    bool? NoIcon,
    string? IconUrl,
    string? IconGroup);

public sealed class EcoSourcePresentationReader
{
    private static readonly Regex ClassWithAttributesRegex = new(
        @"(?<attributes>(?:\s*\[[^\]\r\n]+\]\s*(?://[^\r\n]*)?\r?\n)*)\s*(?:public|private|internal|sealed|abstract|partial|\s)*\s*class\s+(?<class>[A-Za-z_][A-Za-z0-9_]*)",
        RegexOptions.Compiled | RegexOptions.Multiline);

    private static readonly Regex AttributeStringRegex = new(
        @"\[(?<name>LocDisplayName|LocDescription|IconUrl|IconPath|IconGroup)\s*\(\s*""(?<value>(?:\\""|[^""])*)""\s*\)\]",
        RegexOptions.Compiled);

    public IReadOnlyDictionary<string, SourcePresentationInfo> ReadPresentation(IReadOnlyList<string> sourceRoots, List<string>? warnings = null)
    {
        var result = new Dictionary<string, SourcePresentationInfo>(StringComparer.Ordinal);
        var translations = ReadTranslations(sourceRoots, warnings);
        foreach (var file in EnumerateSourceFiles(sourceRoots, warnings))
        {
            string source;
            try { source = File.ReadAllText(file); }
            catch (Exception ex)
            {
                warnings?.Add($"Could not read Eco presentation source file {file}: {ex.Message}");
                continue;
            }

            foreach (Match match in ClassWithAttributesRegex.Matches(source))
            {
                var className = match.Groups["class"].Value;
                var attributes = match.Groups["attributes"].Value;
                var info = ParseAttributes(attributes, translations);
                if (info is null) continue;

                result[className] = Merge(result.GetValueOrDefault(className), info);
            }
        }

        return result;
    }

    private static SourcePresentationInfo? ParseAttributes(string attributes, IReadOnlyDictionary<string, Dictionary<string, string>> translations)
    {
        string? displayName = null;
        string? description = null;
        string? iconUrl = null;
        string? iconGroup = null;
        bool? noIcon = attributes.Contains("[NoIcon", StringComparison.Ordinal) ? true : null;

        foreach (Match match in AttributeStringRegex.Matches(attributes))
        {
            var value = Unescape(match.Groups["value"].Value);
            switch (match.Groups["name"].Value)
            {
                case "LocDisplayName":
                    displayName = value;
                    break;
                case "LocDescription":
                    description = value;
                    break;
                case "IconUrl":
                case "IconPath":
                    iconUrl = value;
                    break;
                case "IconGroup":
                    iconGroup = value;
                    break;
            }
        }

        var localizedDisplayNames = LocalizedNamesFor(displayName, translations);

        return displayName is null && description is null && noIcon is null && iconUrl is null && iconGroup is null
            ? null
            : new SourcePresentationInfo(
                DisplayName: NullIfBlank(displayName),
                LocalizedDisplayNames: localizedDisplayNames,
                Description: NullIfBlank(description),
                NoIcon: noIcon,
                IconUrl: NullIfBlank(iconUrl),
                IconGroup: NullIfBlank(iconGroup));
    }

    private static SourcePresentationInfo Merge(SourcePresentationInfo? current, SourcePresentationInfo next) => new(
        DisplayName: next.DisplayName ?? current?.DisplayName,
        LocalizedDisplayNames: MergeLocalized(current?.LocalizedDisplayNames, next.LocalizedDisplayNames),
        Description: next.Description ?? current?.Description,
        NoIcon: next.NoIcon ?? current?.NoIcon,
        IconUrl: next.IconUrl ?? current?.IconUrl,
        IconGroup: next.IconGroup ?? current?.IconGroup);

    private static IReadOnlyDictionary<string, string> LocalizedNamesFor(string? englishName, IReadOnlyDictionary<string, Dictionary<string, string>> translations)
    {
        if (string.IsNullOrWhiteSpace(englishName)) return new Dictionary<string, string>();
        var normalized = NormalizeText(englishName);
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["en"] = englishName.Trim(),
        };
        if (translations.TryGetValue(normalized, out var localized))
        {
            foreach (var (language, value) in localized)
            {
                if (!string.IsNullOrWhiteSpace(value)) result[language] = value;
            }
        }
        return result;
    }

    private static IReadOnlyDictionary<string, string> MergeLocalized(IReadOnlyDictionary<string, string>? current, IReadOnlyDictionary<string, string> next)
    {
        var result = current is null
            ? new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
            : new Dictionary<string, string>(current, StringComparer.OrdinalIgnoreCase);
        foreach (var (language, value) in next) result[language] = value;
        return result;
    }

    private static Dictionary<string, Dictionary<string, string>> ReadTranslations(IReadOnlyList<string> sourceRoots, List<string>? warnings)
    {
        var result = new Dictionary<string, Dictionary<string, string>>(StringComparer.Ordinal);
        foreach (var file in EnumerateTranslationFiles(sourceRoots, warnings))
        {
            var language = Path.GetFileNameWithoutExtension(file);
            if (string.IsNullOrWhiteSpace(language) || language.Equals("en", StringComparison.OrdinalIgnoreCase)) continue;
            try
            {
                var document = XDocument.Load(file, LoadOptions.PreserveWhitespace);
                XNamespace ns = document.Root?.Name.Namespace ?? XNamespace.None;
                foreach (var unit in document.Descendants(ns + "trans-unit"))
                {
                    var source = NormalizeText(unit.Element(ns + "source")?.Value);
                    var target = NormalizeText(unit.Element(ns + "target")?.Value);
                    if (string.IsNullOrWhiteSpace(source) || string.IsNullOrWhiteSpace(target)) continue;
                    var localizedByLanguage = result.GetValueOrDefault(source) ?? new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                    localizedByLanguage[language] = target;
                    result[source] = localizedByLanguage;
                }
            }
            catch (Exception ex)
            {
                warnings?.Add($"Could not read Eco XLF localization file {file}: {ex.Message}");
            }
        }
        return result;
    }

    private static IEnumerable<string> EnumerateTranslationFiles(IReadOnlyList<string> sourceRoots, List<string>? warnings)
    {
        foreach (var root in sourceRoots.Where(Directory.Exists))
        {
            IEnumerable<string> files;
            try { files = Directory.EnumerateFiles(root, "*.xlf", SearchOption.AllDirectories); }
            catch (Exception ex)
            {
                warnings?.Add($"Could not enumerate localization source root {root}: {ex.Message}");
                continue;
            }

            foreach (var file in files) yield return file;
        }
    }

    private static string? NullIfBlank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static string Unescape(string value) => value.Replace("\\\"", "\"", StringComparison.Ordinal);

    private static string NormalizeText(string? value) => string.IsNullOrWhiteSpace(value)
        ? ""
        : Regex.Replace(value.Replace("\r\n", "\n", StringComparison.Ordinal).Trim(), @"\s+", " ");

    private static IEnumerable<string> EnumerateSourceFiles(IReadOnlyList<string> sourceRoots, List<string>? warnings)
    {
        foreach (var root in sourceRoots.Where(Directory.Exists))
        {
            IEnumerable<string> files;
            try { files = Directory.EnumerateFiles(root, "*.cs", SearchOption.AllDirectories); }
            catch (Exception ex)
            {
                warnings?.Add($"Could not enumerate presentation source root {root}: {ex.Message}");
                continue;
            }

            foreach (var file in files) yield return file;
        }
    }
}
