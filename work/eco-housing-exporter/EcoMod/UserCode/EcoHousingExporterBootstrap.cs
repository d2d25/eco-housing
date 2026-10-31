namespace Eco.Mods.EcoHousingExporter
{
    using System;
    using System.Collections.Generic;
    using System.IO;
    using System.Linq;
    using System.Net;
    using System.Reflection;
    using System.Text;
    using System.Threading;
    using System.Threading.Tasks;
    using Eco.Core.Plugins.Interfaces;
    using Eco.Core.Utils;
    using Eco.Shared.Localization;
    using global::EcoHousingExporter.Export;
    using global::EcoHousingExporter.Http;

    public sealed class EcoHousingExporterPlugin : IModKitPlugin, IInitializablePlugin, IDisposable
    {
        const string DefaultPrefix = "http://localhost:3012/api/v1/eco-housing/";

        HttpListener? listener;
        CancellationTokenSource? cancellation;
        Task? listenTask;
        string status = "Not started.";

        public string GetCategory() => Localizer.DoStr("System");
        public override string ToString() => Localizer.DoStr("Eco Housing Exporter");
        public string GetStatus() => this.status;

        public void Initialize(TimedTask timer)
        {
            if (this.listener != null)
            {
                return;
            }

            try
            {
                var sourceRoots = GetSourceRoots();
                var provider = new ReflectionEcoHousingExportProvider(
                    assemblySource: () => AppDomain.CurrentDomain.GetAssemblies(),
                    sourceRoots: sourceRoots);
                EcoHousingExporterRuntime.UseProvider(provider);
                var router = new EcoHousingHttpRouter(provider);
                var prefixes = GetPrefixes();
                this.cancellation = new CancellationTokenSource();
                this.listener = new HttpListener();

                foreach (var prefix in prefixes)
                {
                    this.listener.Prefixes.Add(prefix);
                }

                this.listener.Start();
                this.listenTask = Task.Run(() => this.ListenLoop(router, this.cancellation.Token));
                this.status = "Listening on " + string.Join(", ", prefixes);
                Console.WriteLine("[EcoHousingExporter] " + this.status);
            }
            catch (Exception ex)
            {
                this.status = "Failed to start: " + ex.GetType().Name + ": " + ex.Message;
                Console.WriteLine("[EcoHousingExporter] " + this.status);
            }
        }

        public void Dispose()
        {
            try
            {
                this.cancellation?.Cancel();
                this.listener?.Stop();
                this.listener?.Close();
            }
            catch
            {
                // Server shutdown should not be blocked by exporter cleanup.
            }
        }

        async Task ListenLoop(EcoHousingHttpRouter router, CancellationToken token)
        {
            while (!token.IsCancellationRequested && this.listener?.IsListening == true)
            {
                HttpListenerContext? context = null;
                try
                {
                    context = await this.listener.GetContextAsync();
                    await WriteResponse(router, context);
                }
                catch (ObjectDisposedException)
                {
                    return;
                }
                catch (HttpListenerException)
                {
                    return;
                }
                catch (Exception ex)
                {
                    this.status = "Request failed: " + ex.GetType().Name + ": " + ex.Message;
                    Console.WriteLine("[EcoHousingExporter] " + this.status);
                    if (context != null)
                    {
                        TryWriteError(context, ex);
                    }
                }
            }
        }

        static async Task WriteResponse(EcoHousingHttpRouter router, HttpListenerContext context)
        {
            var request = context.Request;
            var response = router.Handle(request.Url?.AbsolutePath ?? "/", request.HttpMethod);
            context.Response.StatusCode = response.StatusCode;
            context.Response.ContentType = response.ContentType;
            foreach (var header in response.Headers)
            {
                context.Response.Headers[header.Key] = header.Value;
            }

            if (!string.IsNullOrEmpty(response.Body))
            {
                var bytes = Encoding.UTF8.GetBytes(response.Body);
                context.Response.ContentLength64 = bytes.Length;
                await context.Response.OutputStream.WriteAsync(bytes, 0, bytes.Length);
            }

            context.Response.Close();
        }

        static void TryWriteError(HttpListenerContext context, Exception ex)
        {
            try
            {
                var body = "{\"error\":\"EcoHousingExporter request failed\",\"detail\":\"" + EscapeJson(ex.Message) + "\"}";
                var bytes = Encoding.UTF8.GetBytes(body);
                context.Response.StatusCode = 500;
                context.Response.ContentType = "application/json; charset=utf-8";
                context.Response.Headers["Access-Control-Allow-Origin"] = "*";
                context.Response.ContentLength64 = bytes.Length;
                context.Response.OutputStream.Write(bytes, 0, bytes.Length);
                context.Response.Close();
            }
            catch
            {
                // Ignore secondary failures while reporting the first error.
            }
        }

        static IReadOnlyList<string> GetPrefixes()
        {
            var configured = Environment.GetEnvironmentVariable("ECO_HOUSING_EXPORTER_PREFIXES");
            if (string.IsNullOrWhiteSpace(configured))
            {
                return new[] { DefaultPrefix };
            }

            return configured
                .Split(new[] { ';' }, StringSplitOptions.RemoveEmptyEntries)
                .Select(NormalizePrefix)
                .Where(prefix => !string.IsNullOrWhiteSpace(prefix))
                .ToArray();
        }

        static string NormalizePrefix(string prefix)
        {
            prefix = prefix.Trim();
            return prefix.EndsWith("/", StringComparison.Ordinal) ? prefix : prefix + "/";
        }

        static IReadOnlyList<string> GetSourceRoots()
        {
            var configured = Environment.GetEnvironmentVariable("ECO_HOUSING_SOURCE_ROOTS");
            if (!string.IsNullOrWhiteSpace(configured))
            {
                return configured
                    .Split(new[] { Path.PathSeparator }, StringSplitOptions.RemoveEmptyEntries)
                    .Where(Directory.Exists)
                    .ToArray();
            }

            var candidates = new[]
            {
                Path.Combine(Environment.CurrentDirectory, "Mods"),
                Path.Combine(AppContext.BaseDirectory, "Mods"),
                Path.Combine(AppContext.BaseDirectory, "Eco_Data", "Server", "Mods"),
            };
            return candidates.Where(Directory.Exists).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        }

        static string EscapeJson(string value)
        {
            return value.Replace("\\", "\\\\").Replace("\"", "\\\"");
        }
    }
}
