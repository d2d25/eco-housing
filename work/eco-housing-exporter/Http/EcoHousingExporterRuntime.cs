using EcoHousingExporter.Export;
using System.Runtime.CompilerServices;

namespace EcoHousingExporter.Http;

public static class EcoHousingExporterRuntime
{
    private static readonly object Sync = new();
    private static IEcoHousingExportProvider? provider;

    public static IEcoHousingExportProvider Provider
    {
        get
        {
            lock (Sync)
            {
                if (provider is null)
                {
                    provider = new ReflectionEcoHousingExportProvider();
                    StartWarmup(provider);
                }

                return provider;
            }
        }
    }

    public static void UseProvider(IEcoHousingExportProvider exportProvider)
    {
        ArgumentNullException.ThrowIfNull(exportProvider);
        lock (Sync)
        {
            provider = exportProvider;
            StartWarmup(provider);
        }
    }

    public static void ResetProvider()
    {
        lock (Sync)
        {
            provider = null;
        }
    }

    public static void StartWarmup()
    {
        lock (Sync)
        {
            StartWarmup(provider ??= new ReflectionEcoHousingExportProvider());
        }
    }

    private static void StartWarmup(IEcoHousingExportProvider exportProvider)
    {
        if (Environment.GetEnvironmentVariable("ECO_HOUSING_DISABLE_STARTUP_WARMUP") == "1") return;
        if (exportProvider is IEcoHousingDataWarmup warmup) warmup.StartDataWarmup();
    }
}

internal static class EcoHousingExporterStartup
{
#pragma warning disable CA2255
    [ModuleInitializer]
#pragma warning restore CA2255
    internal static void Initialize()
    {
        if (Environment.GetEnvironmentVariable("ECO_HOUSING_DISABLE_STARTUP_WARMUP") == "1") return;

        _ = Task.Run(async () =>
        {
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(10)).ConfigureAwait(false);
                EcoHousingExporterRuntime.StartWarmup();
            }
            catch
            {
                // Exporter startup must never prevent EcoServer from booting.
            }
        });
    }
}
