using EcoHousingExporter.Contracts;
using EcoHousingExporter.Export;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace EcoHousingExporter.Http;

public static class EcoHousingAspNetCoreExtensions
{
    public static IEndpointRouteBuilder MapEcoHousingExporter(this IEndpointRouteBuilder endpoints, IEcoHousingExportProvider provider)
    {
        return endpoints.MapEcoHousingExporter(new EcoHousingHttpRouter(provider));
    }

    public static IEndpointRouteBuilder MapEcoHousingExporter(this IEndpointRouteBuilder endpoints, EcoHousingHttpRouter router)
    {
        foreach (var path in EcoHousingApiContract.Endpoints)
        {
            endpoints.Map(path, async context =>
            {
                var response = router.Handle(path, context.Request.Method);
                context.Response.StatusCode = response.StatusCode;
                context.Response.ContentType = response.ContentType;
                foreach (var header in response.Headers)
                {
                    context.Response.Headers[header.Key] = header.Value;
                }

                if (!string.IsNullOrEmpty(response.Body))
                {
                    await context.Response.WriteAsync(response.Body);
                }
            }).WithDisplayName($"Eco Housing Exporter {path}");
        }

        return endpoints;
    }
}
