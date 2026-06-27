using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using EcoHousingAdvisor.Domain;

namespace EcoHousingAdvisor.EcoRuntime
{
    public sealed class EcoFurnitureReader : IEcoFurnitureReader
    {
        private readonly Func<IEnumerable<Type>> typeSource;

        public EcoFurnitureReader()
            : this(ReadEcoRuntimeTypes)
        {
        }

        public EcoFurnitureReader(Func<IEnumerable<Type>> typeSource)
        {
            this.typeSource = typeSource;
        }

        public IReadOnlyList<HousingFurnitureItem> ReadFurniture()
        {
            var allTypes = this.typeSource()
                .Where(type => type != null && type.IsClass && !type.IsAbstract)
                .Distinct()
                .ToArray();

            var itemTypes = allTypes
                .Where(IsWorldObjectItemType)
                .Distinct()
                .ToArray();

            var discovered = new List<HousingFurnitureItem>();
            foreach (var itemType in itemTypes)
            {
                var homeValue = TryReadHomeValue(itemType);
                if (homeValue == null)
                {
                    continue;
                }

                var baseValue = TryReadDouble(homeValue, "BaseValue")
                    ?? TryReadDouble(homeValue, "Value")
                    ?? TryReadDouble(homeValue, "ObjectValue");
                if (baseValue == null)
                {
                    continue;
                }

                discovered.Add(new HousingFurnitureItem(
                    itemType.Name,
                    ReadDisplayName(itemType),
                    ReadCategory(homeValue),
                    baseValue.Value,
                    TryReadString(homeValue, "TypeForRoomLimit"),
                    TryReadDouble(homeValue, "DiminishingReturnMultiplier")
                        ?? TryReadDouble(homeValue, "DiminishingMultiplierAcrossFullProperty")
                        ?? TryReadDouble(homeValue, "DiminishingReturnPercent")));
            }

            return discovered
                .OrderBy(item => item.Category, StringComparer.OrdinalIgnoreCase)
                .ThenBy(item => item.DisplayName, StringComparer.OrdinalIgnoreCase)
                .ToArray();
        }

        private static IEnumerable<Type> ReadEcoRuntimeTypes()
        {
            var serviceHolderTypes = AppDomain.CurrentDomain.GetAssemblies()
                .SelectMany(SafeGetTypes)
                .Where(type => type.Name == "ServiceHolder");

            foreach (var serviceHolderType in serviceHolderTypes)
            {
                var obj = ReadStaticMember(serviceHolderType, "Obj");
                var allTypes = ReadMember(obj, "AllTypes") as IEnumerable<Type>;
                if (allTypes != null)
                {
                    return allTypes;
                }
            }

            return AppDomain.CurrentDomain.GetAssemblies().SelectMany(SafeGetTypes);
        }

        private static IEnumerable<Type> SafeGetTypes(Assembly assembly)
        {
            try
            {
                return assembly.GetTypes();
            }
            catch (ReflectionTypeLoadException ex)
            {
                return ex.Types.Where(type => type != null).Cast<Type>();
            }
        }

        private static bool IsWorldObjectItemType(Type type)
        {
            for (var current = type; current != null; current = current.BaseType)
            {
                if (current.IsGenericType && current.Name.StartsWith("WorldObjectItem", StringComparison.Ordinal))
                {
                    return true;
                }
            }

            return false;
        }

        private static object TryReadHomeValue(Type itemType)
        {
            return ReadStaticMember(itemType, "homeValue")
                ?? ReadStaticMember(itemType, "HomeValue")
                ?? ReadInstanceMember(itemType, "HomeValue")
                ?? ReadInstanceMember(itemType, "homeValue");
        }

        private static object ReadStaticMember(Type type, string memberName)
        {
            const BindingFlags Flags = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static;
            var property = type.GetProperty(memberName, Flags);
            if (property != null) return property.GetValue(null);

            var field = type.GetField(memberName, Flags);
            return field == null ? null : field.GetValue(null);
        }

        private static object ReadInstanceMember(Type type, string memberName)
        {
            var constructor = type.GetConstructor(Type.EmptyTypes);
            if (constructor == null)
            {
                return null;
            }

            var instance = constructor.Invoke(null);
            return ReadMember(instance, memberName);
        }

        private static object ReadMember(object instance, string memberName)
        {
            if (instance == null)
            {
                return null;
            }

            const BindingFlags Flags = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.Static;
            var type = instance as Type ?? instance.GetType();
            var target = instance is Type ? null : instance;
            var property = type.GetProperty(memberName, Flags);
            if (property != null) return property.GetValue(target);

            var field = type.GetField(memberName, Flags);
            return field == null ? null : field.GetValue(target);
        }

        private static double? TryReadDouble(object instance, string memberName)
        {
            var value = ReadMember(instance, memberName);
            if (value == null)
            {
                return null;
            }

            try
            {
                return Convert.ToDouble(value);
            }
            catch (InvalidCastException)
            {
                return null;
            }
            catch (FormatException)
            {
                return null;
            }
        }

        private static string TryReadString(object instance, string memberName)
        {
            var value = ReadMember(instance, memberName);
            if (value == null)
            {
                return null;
            }

            var type = value as Type;
            return type != null ? type.Name : value.ToString();
        }

        private static string ReadCategory(object homeValue)
        {
            var category = ReadMember(homeValue, "Category");
            if (category == null)
            {
                return "Unknown";
            }

            return TryReadString(category, "Name")
                ?? TryReadString(category, "DisplayName")
                ?? category.ToString()
                ?? "Unknown";
        }

        private static string ReadDisplayName(Type itemType)
        {
            return StripSuffix(itemType.Name, "Item");
        }

        private static string StripSuffix(string value, string suffix)
        {
            return value.EndsWith(suffix, StringComparison.Ordinal)
                ? value.Substring(0, value.Length - suffix.Length)
                : value;
        }

    }
}
