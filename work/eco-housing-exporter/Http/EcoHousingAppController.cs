using System.Reflection;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace EcoHousingExporter.Http;

[AllowAnonymous]
[Route("eco-housing")]
public sealed class EcoHousingAppController : ControllerBase
{
    [HttpGet("")]
    [HttpGet("{**path}")]
    public IActionResult Get(string? path = null)
    {
        if (string.IsNullOrWhiteSpace(path) && Request.Path.Value is { } requestPath && !requestPath.EndsWith("/", StringComparison.Ordinal))
        {
            return Redirect("/eco-housing/");
        }

        var webRoot = ResolveWebRoot();
        var relativePath = string.IsNullOrWhiteSpace(path) ? "index.html" : path.Replace('/', Path.DirectorySeparatorChar);
        var fullPath = Path.GetFullPath(Path.Combine(webRoot, relativePath));

        if (!fullPath.StartsWith(Path.GetFullPath(webRoot), StringComparison.OrdinalIgnoreCase))
        {
            return BadRequest();
        }

        if (!System.IO.File.Exists(fullPath))
        {
            fullPath = Path.Combine(webRoot, "index.html");
        }

        if (!System.IO.File.Exists(fullPath))
        {
            return NotFound("Eco Housing app files are not installed. Repackage with outputs/ included.");
        }

        return PhysicalFile(fullPath, ContentTypeFor(fullPath));
    }

    private static string ResolveWebRoot()
    {
        var assemblyDirectory = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        if (!string.IsNullOrWhiteSpace(assemblyDirectory))
        {
            var assemblyRelative = Path.Combine(assemblyDirectory, "EcoHousingExporter.Web");
            if (Directory.Exists(assemblyRelative))
            {
                return assemblyRelative;
            }
        }

        return Path.Combine(Directory.GetCurrentDirectory(), "Mods", "EcoHousingExporter.Web");
    }

    private static string ContentTypeFor(string path)
    {
        return Path.GetExtension(path).ToLowerInvariant() switch
        {
            ".css" => "text/css; charset=utf-8",
            ".js" => "application/javascript; charset=utf-8",
            ".json" => "application/json; charset=utf-8",
            ".svg" => "image/svg+xml",
            ".png" => "image/png",
            ".jpg" or ".jpeg" => "image/jpeg",
            ".webp" => "image/webp",
            ".ico" => "image/x-icon",
            _ => "text/html; charset=utf-8",
        };
    }
}
