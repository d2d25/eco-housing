using System.Collections;
using System.Reflection;

namespace EcoHousingExporter.Export;

public sealed class EcoWorldStoreObjectSource
{
    public IEnumerable<object> EnumerateStores()
    {
        var warnings = new List<string>();
        foreach (var store in EnumerateStores(warnings)) yield return store;
    }

    public IReadOnlyList<string> LastWarnings { get; private set; } = [];

    private IEnumerable<object> EnumerateStores(List<string> warnings)
    {
        LastWarnings = warnings;

        var worldObjectManagerType = FindType("Eco.Gameplay.Objects.WorldObjectManager");
        if (worldObjectManagerType is null)
        {
            warnings.Add("Could not find Eco.Gameplay.Objects.WorldObjectManager in loaded assemblies.");
            yield break;
        }

        var manager = TryGetPlugin(worldObjectManagerType, warnings);
        if (manager is null)
        {
            warnings.Add("Could not resolve the live WorldObjectManager plugin.");
            yield break;
        }

        var allObjects = ReadObject(manager, "All") as IEnumerable;
        if (allObjects is null)
        {
            warnings.Add("WorldObjectManager.All was not readable.");
            yield break;
        }

        var count = 0;
        foreach (var worldObject in allObjects)
        {
            if (worldObject is null) continue;
            foreach (var component in ReadComponents(worldObject))
            {
                if (component.GetType().FullName?.Equals("Eco.Gameplay.Components.Store.StoreComponent", StringComparison.Ordinal) == true)
                {
                    count++;
                    yield return component;
                }
            }
        }

        if (count == 0) warnings.Add("No placed Eco StoreComponent instances were found in the live world.");
    }

    private static object? TryGetPlugin(Type pluginType, List<string> warnings)
    {
        var pluginManager = FindType("Eco.Core.PluginManager");
        var getPlugin = pluginManager?.GetMethods(BindingFlags.Public | BindingFlags.Static)
            .FirstOrDefault(method => method.Name == "GetPlugin" && method.IsGenericMethodDefinition && method.GetParameters().Length == 0);
        if (getPlugin is not null)
        {
            try
            {
                return getPlugin.MakeGenericMethod(pluginType).Invoke(null, null);
            }
            catch (Exception ex)
            {
                warnings.Add($"PluginManager.GetPlugin<{pluginType.Name}> failed: {Unwrap(ex).Message}");
            }
        }

        return TryGetSingletonObj(pluginType, warnings);
    }

    private static object? TryGetSingletonObj(Type targetType, List<string> warnings)
    {
        var singletonType = AppDomain.CurrentDomain.GetAssemblies()
            .SelectMany(SafeTypes)
            .FirstOrDefault(type => type.IsGenericTypeDefinition
                && (type.FullName?.StartsWith("Eco.Shared.Utils.Singleton", StringComparison.Ordinal) == true
                    || type.FullName?.StartsWith("Eco.Shared.IoC.Singleton", StringComparison.Ordinal) == true));
        if (singletonType is null) return null;

        try
        {
            var closed = singletonType.MakeGenericType(targetType);
            return ReadObject(closed, "Obj");
        }
        catch (Exception ex)
        {
            warnings.Add($"Singleton<{targetType.Name}>.Obj failed: {Unwrap(ex).Message}");
            return null;
        }
    }

    private static IEnumerable<object> ReadComponents(object worldObject)
    {
        var components = ReadObject(worldObject, "Components") as IEnumerable;
        if (components is null) yield break;
        foreach (var component in components)
        {
            if (component is not null) yield return component;
        }
    }

    private static Type? FindType(string fullName) => AppDomain.CurrentDomain.GetAssemblies()
        .Select(assembly => assembly.GetType(fullName, throwOnError: false))
        .FirstOrDefault(type => type is not null);

    private static object? ReadObject(object value, string name)
    {
        var type = value as Type ?? value.GetType();
        const BindingFlags flags = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static | BindingFlags.Instance | BindingFlags.IgnoreCase;
        try
        {
            var property = type.GetProperty(name, flags);
            if (property?.GetIndexParameters().Length == 0)
            {
                var target = property.GetMethod?.IsStatic == true ? null : value;
                return property.GetValue(target);
            }

            var field = type.GetField(name, flags);
            if (field is not null)
            {
                var target = field.IsStatic ? null : value;
                return field.GetValue(target);
            }
        }
        catch
        {
            return null;
        }

        return null;
    }

    private static IEnumerable<Type> SafeTypes(Assembly assembly)
    {
        try
        {
            return assembly.GetTypes();
        }
        catch (ReflectionTypeLoadException ex)
        {
            return ex.Types.Where(type => type is not null).Cast<Type>();
        }
        catch
        {
            return [];
        }
    }

    private static Exception Unwrap(Exception ex) => ex is TargetInvocationException { InnerException: { } inner } ? inner : ex;
}
