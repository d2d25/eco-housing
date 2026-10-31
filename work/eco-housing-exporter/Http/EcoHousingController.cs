using EcoHousingExporter.Contracts;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace EcoHousingExporter.Http;

[ApiController]
[AllowAnonymous]
[Route("api/v1/eco-housing")]
public sealed class EcoHousingController : ControllerBase
{
    [HttpGet("status")]
    [HttpOptions("status")]
    public ContentResult Status() => FromRouter(EcoHousingApiContract.StatusPath);

    [HttpGet("data")]
    [HttpOptions("data")]
    public ContentResult Data() => FromRouter(EcoHousingApiContract.DataPath);

    [HttpGet("economy")]
    [HttpOptions("economy")]
    public ContentResult Economy() => FromRouter(EcoHousingApiContract.EconomyPath);

    private ContentResult FromRouter(string path)
    {
        var response = new EcoHousingHttpRouter(EcoHousingExporterRuntime.Provider).Handle(path, Request.Method);
        foreach (var header in response.Headers)
        {
            Response.Headers[header.Key] = header.Value;
        }

        return new ContentResult
        {
            StatusCode = response.StatusCode,
            ContentType = response.ContentType,
            Content = response.Body,
        };
    }
}
