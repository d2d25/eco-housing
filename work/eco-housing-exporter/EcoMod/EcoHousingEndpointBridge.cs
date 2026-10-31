using EcoHousingExporter.Contracts;
using EcoHousingExporter.Export;
using EcoHousingExporter.Http;

namespace EcoHousingExporter.EcoMod;

public interface IEcoHousingEndpointHost
{
    void RegisterEndpoint(string path, Func<string, EcoHousingHttpResponse> handler);
}

public static class EcoHousingEndpointBridge
{
    public static void Register(IEcoHousingEndpointHost host, IEcoHousingExportProvider provider)
    {
        Register(host, new EcoHousingHttpRouter(provider));
    }

    public static void Register(IEcoHousingEndpointHost host, EcoHousingHttpRouter router)
    {
        foreach (var path in EcoHousingApiContract.Endpoints)
        {
            host.RegisterEndpoint(path, method => router.Handle(path, method));
        }
    }
}
