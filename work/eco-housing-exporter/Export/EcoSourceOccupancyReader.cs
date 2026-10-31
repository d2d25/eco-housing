using System.Text.RegularExpressions;
using EcoHousingExporter.Contracts;

namespace EcoHousingExporter.Export;

public sealed class EcoSourceOccupancyReader
{
    private static readonly Regex OccupancyBlockRegex = new(@"WorldObject\.AddOccupancy\s*<\s*(?<worldObject>\w+Object)\s*>\s*\(\s*new\s+List\s*<\s*BlockOccupancy\s*>\s*\(\s*\)\s*\{(?<body>.*?)\}\s*\)\s*;", RegexOptions.Compiled | RegexOptions.Singleline);
    private static readonly Regex VectorRegex = new(@"new\s+Vector3i\s*\(\s*(?<x>-?\d+)\s*,\s*(?<y>-?\d+)\s*,\s*(?<z>-?\d+)\s*\)", RegexOptions.Compiled);

    public IReadOnlyList<OccupancyDto> ReadOccupancy(IEnumerable<string> sourceRoots, List<string>? warnings = null)
    {
        var rows = new Dictionary<string, OccupancyDto>(StringComparer.Ordinal);
        foreach (var file in EnumerateOccupancyFiles(sourceRoots, warnings))
        {
            string source;
            try
            {
                source = File.ReadAllText(file);
            }
            catch (Exception ex)
            {
                warnings?.Add($"Could not read Eco occupancy source file {file}: {ex.Message}");
                continue;
            }

            foreach (var row in ParseSource(source))
            {
                rows[row.WorldObjectClass] = row;
            }
        }

        return rows.Values
            .OrderBy(row => row.WorldObjectClass, StringComparer.Ordinal)
            .ToArray();
    }

    public IReadOnlyList<OccupancyDto> ParseSource(string source)
    {
        return OccupancyBlockRegex.Matches(source)
            .Cast<Match>()
            .Select(ParseOccupancyBlock)
            .OfType<OccupancyDto>()
            .OrderBy(row => row.WorldObjectClass, StringComparer.Ordinal)
            .ToArray();
    }

    private static OccupancyDto? ParseOccupancyBlock(Match match)
    {
        var worldObject = match.Groups["worldObject"].Value;
        var points = VectorRegex.Matches(match.Groups["body"].Value)
            .Cast<Match>()
            .Select(vector => (
                X: int.Parse(vector.Groups["x"].Value),
                Y: int.Parse(vector.Groups["y"].Value),
                Z: int.Parse(vector.Groups["z"].Value)))
            .Distinct()
            .ToArray();
        if (points.Length == 0) return new OccupancyDto(worldObject, 0, 0, 0, 0, 0);

        var width = points.Max(point => point.X) - points.Min(point => point.X) + 1;
        var depth = points.Max(point => point.Z) - points.Min(point => point.Z) + 1;
        var height = points.Max(point => point.Y) - points.Min(point => point.Y) + 1;
        var floorArea = points.Select(point => (point.X, point.Z)).Distinct().Count();
        return new OccupancyDto(
            WorldObjectClass: worldObject,
            BlockCount: points.Length,
            FloorArea: floorArea,
            Width: width,
            Depth: depth,
            Height: height);
    }

    private static IEnumerable<string> EnumerateOccupancyFiles(IEnumerable<string> sourceRoots, List<string>? warnings)
    {
        foreach (var root in sourceRoots.Select(root => root.Trim()).Where(root => root.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase))
        {
            if (!Directory.Exists(root)) continue;
            IEnumerable<string> files;
            try
            {
                files = Directory.EnumerateFiles(root, "WorldObjectOccupancyAutoGen.cs", SearchOption.AllDirectories);
            }
            catch (Exception ex)
            {
                warnings?.Add($"Could not enumerate occupancy source root {root}: {ex.Message}");
                continue;
            }

            foreach (var file in files) yield return file;
        }
    }
}
