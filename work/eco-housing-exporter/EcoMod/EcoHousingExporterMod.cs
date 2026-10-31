#if ECO_MODKIT
using EcoHousingExporter.Export;
using EcoHousingExporter.Http;

namespace EcoHousingExporter.EcoMod;

// This file is intentionally behind ECO_MODKIT until the exact Eco server HTTP hook is wired.
// The final mod should instantiate EcoHousingHttpRouter with an Eco-backed provider and register:
//   GET /api/v1/eco-housing/status
//   GET /api/v1/eco-housing/data
//   GET /api/v1/eco-housing/economy
//
// The provider should use live Eco registries/world state instead of parsing source files:
//   - item/recipe/skill registries for /data
//   - housing config and HomeFurnishingValue for housing rules
//   - placed Store objects and their trade offers for /economy
//   - server metadata and loaded mods for /status
public sealed class EcoHousingExporterMod
{
    private readonly EcoHousingHttpRouter router;

    public EcoHousingExporterMod()
    {
        IEcoHousingExportProvider provider = new ReflectionEcoHousingExportProvider();
        this.router = new EcoHousingHttpRouter(provider);
    }

    public void RegisterEndpoints(IEcoHousingEndpointHost host) => EcoHousingEndpointBridge.Register(host, router);

    public EcoHousingHttpResponse Handle(string path, string method = "GET") => router.Handle(path, method);
}
#endif
