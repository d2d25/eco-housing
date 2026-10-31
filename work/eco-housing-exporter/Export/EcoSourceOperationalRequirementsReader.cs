using System.Text.RegularExpressions;
using EcoHousingExporter.Contracts;

namespace EcoHousingExporter.Export;

public sealed class EcoSourceOperationalRequirementsReader
{
    private static readonly Regex WorldObjectClassRegex = new(@"public\s+(?:partial\s+)?class\s+(?<class>\w+Object)\b(?<body>.*?)(?=\n\s*(?:\[|public\s+(?:partial\s+)?class\s+\w+Object\b)|\z)", RegexOptions.Compiled | RegexOptions.Singleline);
    private static readonly Regex RequireComponentRegex = new(@"RequireComponent\s*\(\s*typeof\s*\(\s*(?<component>\w+Component)\s*\)\s*\)", RegexOptions.Compiled);
    private static readonly Regex PowerConsumptionRegex = new(@"PowerConsumptionComponent>\s*\(\s*\)\s*\.Initialize\s*\(\s*(?<watts>[-+]?\d+(?:\.\d+)?f?)", RegexOptions.Compiled);
    private static readonly Regex PowerGeneratorAttributeRegex = new(@"PowerGenerator\s*\(\s*typeof\s*\(\s*(?<type>\w+Power)\s*\)\s*\)", RegexOptions.Compiled);
    private static readonly Regex PowerGeneratorInitializeRegex = new(@"PowerGeneratorComponent>\s*\(\s*\)\s*\.Initialize\s*\(\s*(?<watts>[-+]?\d+(?:\.\d+)?f?)", RegexOptions.Compiled);
    private static readonly Regex FuelConsumptionRegex = new(@"FuelConsumptionComponent>\s*\(\s*\)\s*\.Initialize\s*\(\s*(?<watts>[-+]?\d+(?:\.\d+)?f?)", RegexOptions.Compiled);
    private static readonly Regex FuelTagsRegex = new(@"fuelTagList\s*=\s*new\[\]\s*\{(?<tags>[^}]*)\}|FuelSupplyComponent>\s*\(\s*\)\s*\.Initialize\s*\([^,]+,\s*new\[\]\s*\{(?<tags>[^}]*)\}", RegexOptions.Compiled | RegexOptions.Singleline);
    private static readonly Regex StringLiteralRegex = new(@"""(?<value>(?:\\""|[^""])*)""", RegexOptions.Compiled);
    private static readonly Regex LiquidSetupRegex = new(@"Liquid(?:Converter|Consumer|Producer)Component>\s*\(\s*\)\s*\.Setup\s*\((?<args>[^;]+?)\);", RegexOptions.Compiled | RegexOptions.Singleline);
    private static readonly Regex OccupancyBlockRegex = new(@"WorldObject\.AddOccupancy\s*<\s*(?<worldObject>\w+Object)\s*>\s*\(\s*new\s+List\s*<\s*BlockOccupancy\s*>\s*\(\s*\)\s*\{(?<body>.*?)\}\s*\)\s*;", RegexOptions.Compiled | RegexOptions.Singleline);

    public IReadOnlyDictionary<string, OperationalRequirementsDto> ReadRequirements(IEnumerable<string> sourceRoots, List<string>? warnings = null)
    {
        var requirements = new Dictionary<string, OperationalRequirementsDto>(StringComparer.Ordinal);
        foreach (var file in EnumerateSourceFiles(sourceRoots, warnings))
        {
            string source;
            try
            {
                source = File.ReadAllText(file);
            }
            catch (Exception ex)
            {
                warnings?.Add($"Could not read Eco operational source file {file}: {ex.Message}");
                continue;
            }

            var parsed = Path.GetFileName(file).Equals("WorldObjectOccupancyAutoGen.cs", StringComparison.OrdinalIgnoreCase)
                ? ParseOccupancyPorts(source)
                : ParseWorldObjectSource(source);
            foreach (var (worldObject, value) in parsed)
            {
                requirements[worldObject] = Merge(requirements.GetValueOrDefault(worldObject), value)!;
            }
        }

        return requirements;
    }

    public IReadOnlyDictionary<string, OperationalRequirementsDto> ParseWorldObjectSource(string source)
    {
        var requirements = new Dictionary<string, OperationalRequirementsDto>(StringComparer.Ordinal);
        foreach (Match match in WorldObjectClassRegex.Matches(source))
        {
            var className = match.Groups["class"].Value;
            var text = match.Value;
            var components = RequireComponentRegex.Matches(text)
                .Cast<Match>()
                .Select(component => component.Groups["component"].Value)
                .ToHashSet(StringComparer.Ordinal);

            var powerConsumption = PowerConsumptionRegex.Match(text) is { Success: true } consumption
                ? new PowerRequirementDto(GuessConsumptionPowerType(text), ParseNumber(consumption.Groups["watts"].Value))
                : components.Contains("PowerConsumptionComponent")
                    ? new PowerRequirementDto("UnknownPower", null)
                    : null;
            var generatorType = PowerGeneratorAttributeRegex.Match(text) is { Success: true } generatorAttribute
                ? generatorAttribute.Groups["type"].Value
                : null;
            var powerProduction = PowerGeneratorInitializeRegex.Match(text) is { Success: true } generator
                ? new PowerRequirementDto(generatorType ?? "UnknownPower", ParseNumber(generator.Groups["watts"].Value))
                : generatorType is not null
                    ? new PowerRequirementDto(generatorType, null)
                    : null;
            var fuelTags = ParseFuelTags(text);
            var fuelConsumption = FuelConsumptionRegex.Match(text) is { Success: true } fuelMatch
                ? ParseNumber(fuelMatch.Groups["watts"].Value)
                : null;
            var hasFuel = components.Contains("FuelSupplyComponent") || components.Contains("FuelConsumptionComponent") || fuelTags.Count > 0;
            var liquidText = string.Join("\n", LiquidSetupRegex.Matches(text).Cast<Match>().Select(liquid => liquid.Groups["args"].Value));
            var water = liquidText.Contains("WaterItem", StringComparison.Ordinal);
            var sewage = liquidText.Contains("SewageItem", StringComparison.Ordinal);
            var smog = liquidText.Contains("SmogItem", StringComparison.Ordinal);
            var chimney = components.Contains("ChimneyComponent") || text.Contains("ChimneyOut", StringComparison.Ordinal) || smog;

            var value = Build(
                powerConsumption,
                powerProduction,
                hasFuel ? new FuelRequirementDto(fuelTags, fuelConsumption) : null,
                water || sewage ? new WaterRequirementDto(water, sewage) : null,
                chimney ? new ChimneyRequirementDto(smog) : null);
            if (value is not null) requirements[className] = value;
        }

        return requirements;
    }

    public IReadOnlyDictionary<string, OperationalRequirementsDto> ParseOccupancyPorts(string source)
    {
        var requirements = new Dictionary<string, OperationalRequirementsDto>(StringComparer.Ordinal);
        foreach (Match match in OccupancyBlockRegex.Matches(source))
        {
            var body = match.Groups["body"].Value;
            var water = body.Contains("WaterInputPort", StringComparison.Ordinal);
            var sewage = body.Contains("SewageOutputPort", StringComparison.Ordinal);
            var chimney = body.Contains("ChimneyOut", StringComparison.Ordinal);
            if (!water && !sewage && !chimney) continue;
            requirements[match.Groups["worldObject"].Value] = Build(
                powerConsumption: null,
                powerProduction: null,
                fuel: null,
                water: water || sewage ? new WaterRequirementDto(water, sewage) : null,
                chimney: chimney ? new ChimneyRequirementDto(SmogOutput: false) : null)!;
        }
        return requirements;
    }

    private static IEnumerable<string> EnumerateSourceFiles(IEnumerable<string> sourceRoots, List<string>? warnings)
    {
        foreach (var root in sourceRoots.Select(root => root.Trim()).Where(root => root.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase))
        {
            if (!Directory.Exists(root)) continue;
            IEnumerable<string> files;
            try
            {
                files = Directory.EnumerateFiles(root, "*.cs", SearchOption.AllDirectories);
            }
            catch (Exception ex)
            {
                warnings?.Add($"Could not enumerate operational source root {root}: {ex.Message}");
                continue;
            }

            foreach (var file in files) yield return file;
        }
    }

    private static IReadOnlyList<string> ParseFuelTags(string text)
    {
        return FuelTagsRegex.Matches(text)
            .Cast<Match>()
            .Select(match => match.Groups["tags"].Value)
            .SelectMany(raw => StringLiteralRegex.Matches(raw).Cast<Match>().Select(match => match.Groups["value"].Value.Replace("\\\"", "\"")))
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
            .ToArray();
    }

    private static string GuessConsumptionPowerType(string text)
    {
        if (text.Contains("HeatPower", StringComparison.Ordinal)) return "HeatPower";
        if (text.Contains("MechanicalPower", StringComparison.Ordinal)) return "MechanicalPower";
        if (text.Contains("ElectricPower", StringComparison.Ordinal)) return "ElectricPower";
        return "UnknownPower";
    }

    private static OperationalRequirementsDto? Build(PowerRequirementDto? powerConsumption, PowerRequirementDto? powerProduction, FuelRequirementDto? fuel, WaterRequirementDto? water, ChimneyRequirementDto? chimney)
    {
        return powerConsumption is null && powerProduction is null && fuel is null && water is null && chimney is null
            ? null
            : new OperationalRequirementsDto(
                PowerConsumption: powerConsumption,
                PowerProduction: powerProduction,
                Fuel: fuel,
                Water: water,
                Chimney: chimney,
                Generator: powerProduction);
    }

    private static OperationalRequirementsDto? Merge(OperationalRequirementsDto? current, OperationalRequirementsDto? next)
    {
        if (current is null) return next;
        if (next is null) return current;
        var fuelTags = (current.Fuel?.Tags ?? []).Concat(next.Fuel?.Tags ?? []).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal).ToArray();
        return new OperationalRequirementsDto(
            PowerConsumption: next.PowerConsumption ?? current.PowerConsumption,
            PowerProduction: next.PowerProduction ?? current.PowerProduction,
            Fuel: current.Fuel is not null || next.Fuel is not null
                ? new FuelRequirementDto(fuelTags, next.Fuel?.Watts ?? current.Fuel?.Watts)
                : null,
            Water: current.Water is not null || next.Water is not null
                ? new WaterRequirementDto(
                    Input: current.Water?.Input == true || next.Water?.Input == true,
                    SewageOutput: current.Water?.SewageOutput == true || next.Water?.SewageOutput == true)
                : null,
            Chimney: current.Chimney is not null || next.Chimney is not null
                ? new ChimneyRequirementDto(SmogOutput: current.Chimney?.SmogOutput == true || next.Chimney?.SmogOutput == true)
                : null,
            Generator: next.Generator ?? current.Generator);
    }

    private static double? ParseNumber(string value)
    {
        var cleaned = value.Trim().TrimEnd('f', 'F');
        return double.TryParse(cleaned, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var parsed) ? parsed : null;
    }
}
