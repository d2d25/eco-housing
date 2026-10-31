using System.Text.Json;
using EcoHousingExporter.Contracts;
using EcoHousingExporter.EcoMod;
using EcoHousingExporter.Export;
using EcoHousingExporter.Http;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Extensions.DependencyInjection;

namespace EcoHousingExporter;

public static class ExporterSmokeTest
{
    public static async Task Main()
    {
        Environment.SetEnvironmentVariable("ECO_HOUSING_DISABLE_STARTUP_WARMUP", "1");
        Environment.SetEnvironmentVariable("ECO_HOUSING_DISABLE_BACKGROUND_ENRICHMENT", "1");

        Console.WriteLine("smoke: router");
        var router = new EcoHousingHttpRouter(new StubEcoHousingExportProvider());
        AssertOkJson(router, EcoHousingApiContract.StatusPath, "exporterVersion");
        AssertOkJson(router, EcoHousingApiContract.DataPath, "housing");
        AssertOkJson(router, EcoHousingApiContract.EconomyPath, "listings");
        AssertCors(router);
        Console.WriteLine("smoke: endpoint bridge");
        AssertRichRouterPayloads();
        AssertEndpointBridge();
        Console.WriteLine("smoke: aspnet endpoint");
        await AssertAspNetCoreEndpointMapping();
        Console.WriteLine("smoke: aspnet controller");
        await AssertAspNetCoreControllerMapping();

        Console.WriteLine("smoke: reflection");
        var reflection = new ReflectionEcoHousingExportProvider(() => [typeof(FakeHousingItem).Assembly], () => new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero));
        var data = reflection.GetData();
        var cachedData = reflection.GetData();
        if (data.Items.Count != cachedData.Items.Count || !cachedData.Meta.ContainsKey("dataCache"))
        {
            throw new InvalidOperationException("Reflection /data payload should be cached and expose cache metadata.");
        }
        if (data.Items.All(item => item.ClassName != nameof(FakeHousingItem)))
        {
            throw new InvalidOperationException("Reflection provider did not discover the fake housing item.");
        }
        var reflectedHousing = data.Housing.SingleOrDefault(housing => housing.ItemClass == nameof(FakeHousingItem));
        if (reflectedHousing is null
            || reflectedHousing.Value != 7
            || reflectedHousing.Category != "Bathroom"
            || reflectedHousing.TypeForRoomLimit != "Toilet"
            || reflectedHousing.DiminishingMultiplierAcrossFullProperty != 0.2)
        {
            throw new InvalidOperationException("Reflection provider did not read the fake HomeFurnishingValue.");
        }
        var reflectedRecipe = data.Recipes.SingleOrDefault(recipe => recipe.ClassName == nameof(FakeHousingRecipe));
        if (reflectedRecipe is null || reflectedRecipe.RequiredSkillClass != nameof(FakeCraftingSkill) || reflectedRecipe.RequiredSkillLevel != 2)
        {
            throw new InvalidOperationException("Reflection provider did not discover the fake recipe skill requirement.");
        }
        if (reflectedRecipe.Products.All(product => product.ItemClass != nameof(FakeHousingItem)))
        {
            throw new InvalidOperationException("Reflection provider did not infer the fake recipe product.");
        }
        Console.WriteLine("smoke: source enrichment");
        AssertSourceRecipeEnrichment();
        Console.WriteLine("smoke: installed variant");
        AssertInstalledEcoVariantRecipeParsing();
        if (data.Skills.All(skill => skill.ClassName != nameof(FakeCraftingSkill)))
        {
            throw new InvalidOperationException("Reflection provider did not discover the fake skill.");
        }
        var reflectedWorldObject = data.WorldObjects.SingleOrDefault(worldObject => worldObject.ClassName == nameof(FakeHousingObject));
        if (reflectedWorldObject is null
            || reflectedWorldObject.RepresentedItemClass != nameof(FakeHousingItem)
            || reflectedWorldObject.RequiredRoomVolume != 12
            || reflectedWorldObject.RequiredRoomMaterialTier != 3
            || !reflectedWorldObject.RequireRoomContainment
            || !reflectedWorldObject.RequiresOccupancy
            || !reflectedWorldObject.RequiresRoomRequirements)
        {
            throw new InvalidOperationException("Reflection provider did not discover fake world object room requirements.");
        }
        if (reflectedWorldObject.OperationalRequirements?.PowerConsumption?.Type != "UnknownPower")
        {
            throw new InvalidOperationException("Reflection provider did not expose fake world object operational requirement hints.");
        }
        if (!data.Meta.TryGetValue("extractionCompleteness", out var completeness) || completeness is not Dictionary<string, string>)
        {
            throw new InvalidOperationException("Reflection provider did not expose extraction completeness metadata.");
        }
        AssertVanillaHousingFallback(data);

        var builtData = new EcoDataSnapshotBuilder(new FakeDataReader(), () => new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero)).Build();
        if (builtData.Items.Count != 1 || builtData.Housing.Count != 1 || builtData.RoomTiers.Count != 1 || builtData.ConstructionMaterials.Count != 1)
        {
            throw new InvalidOperationException("Data builder did not normalize counts or duplicates.");
        }
        if (!builtData.Meta.TryGetValue("counts", out var counts) || counts is not Dictionary<string, int> countMap || countMap["items"] != 1)
        {
            throw new InvalidOperationException("Data builder did not expose meta.counts.");
        }
        Console.WriteLine("smoke: builder variants");
        AssertDataBuilderVariantsAndEquivalences();

        Console.WriteLine("smoke: economy");
        var economy = new EcoEconomySnapshotBuilder(new FakeEconomyReader(), () => new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero)).Build();
        var listing = economy.Listings.SingleOrDefault(entry => entry.ItemClass == "HewnTableItem");
        if (listing is null) throw new InvalidOperationException("Economy builder did not expose the fake store offer.");
        if (listing.Quantity != 5 || listing.Price != 12.5 || listing.Currency != "Credits")
        {
            throw new InvalidOperationException("Economy builder changed quantity, price, or currency.");
        }
        if (listing.StoreId != "store-1" || listing.SellerId != "seller-1" || listing.TaxRate != 0.05)
        {
            throw new InvalidOperationException("Economy builder dropped optional store metadata.");
        }
        if (!economy.Warnings.Any(warning => warning.Contains("quantity must be positive", StringComparison.OrdinalIgnoreCase)))
        {
            throw new InvalidOperationException("Economy builder did not warn about invalid store offers.");
        }
        AssertReflectionEconomyReader();
    }

    private static void AssertOkJson(EcoHousingHttpRouter router, string path, string expectedProperty)
    {
        var response = router.Handle(path);
        if (response.StatusCode != 200) throw new InvalidOperationException($"{path} returned {response.StatusCode}.");
        if (!response.Headers.TryGetValue("Access-Control-Allow-Origin", out var origin) || origin != "*")
        {
            throw new InvalidOperationException($"{path} did not include the expected CORS header.");
        }
        using var json = JsonDocument.Parse(response.Body);
        if (!json.RootElement.TryGetProperty(expectedProperty, out _))
        {
            throw new InvalidOperationException($"{path} did not include '{expectedProperty}'.");
        }
    }

    private static void AssertCors(EcoHousingHttpRouter router)
    {
        var preflight = router.Handle(EcoHousingApiContract.DataPath, "OPTIONS");
        if (preflight.StatusCode != 204) throw new InvalidOperationException("OPTIONS preflight did not return 204.");
        if (!preflight.Headers.TryGetValue("Access-Control-Allow-Methods", out var methods) || !methods.Contains("GET", StringComparison.Ordinal))
        {
            throw new InvalidOperationException("OPTIONS preflight did not expose allowed methods.");
        }

        var blocked = router.Handle(EcoHousingApiContract.DataPath, "POST");
        if (blocked.StatusCode != 405) throw new InvalidOperationException("Unsupported HTTP method did not return 405.");
    }

    private static void AssertRichRouterPayloads()
    {
        var provider = new FakeRichExportProvider();
        var router = new EcoHousingHttpRouter(provider);

        var status = router.Handle($"{EcoHousingApiContract.StatusPath}?cacheBust=1");
        using (var json = JsonDocument.Parse(status.Body))
        {
            if (json.RootElement.GetProperty("serverName").GetString() != "Smoke Server")
            {
                throw new InvalidOperationException("Router /status did not serialize server metadata with web JSON casing.");
            }
            if (!json.RootElement.GetProperty("endpoints").EnumerateArray().Any(entry => entry.GetString() == EcoHousingApiContract.EconomyPath))
            {
                throw new InvalidOperationException("Router /status did not expose the economy endpoint.");
            }
        }

        var data = router.Handle(EcoHousingApiContract.DataPath);
        using (var json = JsonDocument.Parse(data.Body))
        {
            var root = json.RootElement;
            if (root.GetProperty("items").GetArrayLength() != 1
                || root.GetProperty("housing").GetArrayLength() != 1
                || root.GetProperty("roomCategories").GetArrayLength() != 1
                || root.GetProperty("roomTiers").GetArrayLength() != 1
                || root.GetProperty("constructionMaterials").GetArrayLength() != 1)
            {
                throw new InvalidOperationException("Router /data did not expose the normalized server data payload.");
            }
            if (root.GetProperty("meta").GetProperty("counts").GetProperty("items").GetInt32() != 1)
            {
                throw new InvalidOperationException("Router /data did not expose meta.counts for app validation.");
            }
        }

        var economy = router.Handle(EcoHousingApiContract.EconomyPath);
        using (var json = JsonDocument.Parse(economy.Body))
        {
            var root = json.RootElement;
            if (root.GetProperty("currencies").GetArrayLength() != 1 || root.GetProperty("listings").GetArrayLength() != 1)
            {
                throw new InvalidOperationException("Router /economy did not expose the normalized economy payload.");
            }
            var listing = root.GetProperty("listings")[0];
            if (listing.GetProperty("itemClass").GetString() != "HewnTableItem"
                || listing.GetProperty("quantity").GetDouble() != 5
                || listing.GetProperty("price").GetDouble() != 12.5
                || listing.GetProperty("currency").GetString() != "Credits")
            {
                throw new InvalidOperationException("Router /economy changed item, quantity, price, or currency.");
            }
        }
    }

    private static void AssertVanillaHousingFallback(EcoHousingDataDto data)
    {
        if (data.RoomTiers.Count != 6 || data.RoomTiers.First().Tier != 0 || data.RoomTiers.Last().Tier != 5)
        {
            throw new InvalidOperationException("Vanilla room tier fallback is incomplete.");
        }

        var bathroom = data.RoomCategories.SingleOrDefault(category => category.Name == "Bathroom");
        var seating = data.RoomCategories.SingleOrDefault(category => category.Name == "Seating");
        var decoration = data.RoomCategories.SingleOrDefault(category => category.Name == "Decoration");
        var lighting = data.RoomCategories.SingleOrDefault(category => category.Name == "Lighting");
        if (bathroom?.CapToPercentOfRestOfProperty != 0.33)
        {
            throw new InvalidOperationException("Bathroom fallback cap is missing.");
        }
        if (seating?.MaxSupportPercentOfPrimary != 0.3 || decoration?.MaxSupportPercentOfPrimary != 0.5 || lighting?.MaxSupportPercentOfPrimary != 0.5)
        {
            throw new InvalidOperationException("Support fallback caps are missing.");
        }
    }

    private static void AssertEndpointBridge()
    {
        var host = new FakeEndpointHost();
        EcoHousingEndpointBridge.Register(host, new StubEcoHousingExportProvider());

        foreach (var path in EcoHousingApiContract.Endpoints)
        {
            if (!host.Handlers.ContainsKey(path))
            {
                throw new InvalidOperationException($"Endpoint bridge did not register {path}.");
            }

            var response = host.Handlers[path]("GET");
            if (response.StatusCode != 200)
            {
                throw new InvalidOperationException($"Endpoint bridge handler returned {response.StatusCode} for {path}.");
            }
        }

        var preflight = host.Handlers[EcoHousingApiContract.StatusPath]("OPTIONS");
        if (preflight.StatusCode != 204)
        {
            throw new InvalidOperationException("Endpoint bridge did not preserve OPTIONS handling.");
        }
    }

    private static async Task AssertAspNetCoreEndpointMapping()
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions
        {
            ApplicationName = typeof(ExporterSmokeTest).Assembly.FullName,
        });
        builder.WebHost.UseUrls("http://127.0.0.1:0");

        await using var app = builder.Build();
        try
        {
            app.MapEcoHousingExporter(new StubEcoHousingExportProvider());
            await app.StartAsync(timeout.Token);

            var server = app.Services.GetRequiredService<IServer>();
            var addresses = server.Features.Get<IServerAddressesFeature>()?.Addresses;
            var baseAddress = addresses?.FirstOrDefault();
            if (string.IsNullOrWhiteSpace(baseAddress))
            {
                throw new InvalidOperationException("ASP.NET endpoint mapping did not expose a listening address.");
            }

            using var http = new HttpClient { BaseAddress = new Uri(baseAddress), Timeout = TimeSpan.FromSeconds(5) };
            using var status = await http.GetAsync(EcoHousingApiContract.StatusPath, timeout.Token);
            if (!status.IsSuccessStatusCode)
            {
                throw new InvalidOperationException($"ASP.NET mapped /status returned {(int)status.StatusCode}.");
            }
            if (!status.Headers.TryGetValues("Access-Control-Allow-Origin", out var origins) || origins.FirstOrDefault() != "*")
            {
                throw new InvalidOperationException("ASP.NET mapped /status did not include CORS headers.");
            }
            using var json = JsonDocument.Parse(await status.Content.ReadAsStringAsync(timeout.Token));
            if (!json.RootElement.TryGetProperty("exporterVersion", out _))
            {
                throw new InvalidOperationException("ASP.NET mapped /status did not return exporter status JSON.");
            }

            using var optionsRequest = new HttpRequestMessage(HttpMethod.Options, EcoHousingApiContract.DataPath);
            using var options = await http.SendAsync(optionsRequest, timeout.Token);
            if ((int)options.StatusCode != 204)
            {
                throw new InvalidOperationException($"ASP.NET mapped OPTIONS returned {(int)options.StatusCode}.");
            }

            using var blocked = await http.PostAsync(EcoHousingApiContract.DataPath, null, timeout.Token);
            if ((int)blocked.StatusCode != 405)
            {
                throw new InvalidOperationException($"ASP.NET mapped POST returned {(int)blocked.StatusCode}.");
            }
        }
        finally
        {
            await app.StopAsync(CancellationToken.None);
        }
    }

    private static async Task AssertAspNetCoreControllerMapping()
    {
        EcoHousingExporterRuntime.UseProvider(new StubEcoHousingExportProvider());
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions
        {
            ApplicationName = typeof(ExporterSmokeTest).Assembly.FullName,
        });
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Services
            .AddControllers()
            .AddApplicationPart(typeof(EcoHousingController).Assembly);

        await using var app = builder.Build();
        try
        {
            app.MapControllers();
            await app.StartAsync(timeout.Token);

            var server = app.Services.GetRequiredService<IServer>();
            var addresses = server.Features.Get<IServerAddressesFeature>()?.Addresses;
            var baseAddress = addresses?.FirstOrDefault();
            if (string.IsNullOrWhiteSpace(baseAddress))
            {
                throw new InvalidOperationException("ASP.NET controller mapping did not expose a listening address.");
            }

            using var http = new HttpClient { BaseAddress = new Uri(baseAddress), Timeout = TimeSpan.FromSeconds(5) };
            using var status = await http.GetAsync(EcoHousingApiContract.StatusPath, timeout.Token);
            if (!status.IsSuccessStatusCode)
            {
                throw new InvalidOperationException($"ASP.NET controller /status returned {(int)status.StatusCode}.");
            }
            if (!status.Headers.TryGetValues("Access-Control-Allow-Origin", out var origins) || origins.FirstOrDefault() != "*")
            {
                throw new InvalidOperationException("ASP.NET controller /status did not include CORS headers.");
            }
            using var json = JsonDocument.Parse(await status.Content.ReadAsStringAsync(timeout.Token));
            if (!json.RootElement.TryGetProperty("exporterVersion", out _))
            {
                throw new InvalidOperationException("ASP.NET controller /status did not return exporter status JSON.");
            }

            using var optionsRequest = new HttpRequestMessage(HttpMethod.Options, EcoHousingApiContract.EconomyPath);
            using var options = await http.SendAsync(optionsRequest, timeout.Token);
            if ((int)options.StatusCode != 204)
            {
                throw new InvalidOperationException($"ASP.NET controller OPTIONS returned {(int)options.StatusCode}.");
            }
        }
        finally
        {
            await app.StopAsync(CancellationToken.None);
            EcoHousingExporterRuntime.ResetProvider();
        }
    }

    private static void AssertSourceRecipeEnrichment()
    {
        var root = Path.Combine(Path.GetTempPath(), $"eco-housing-source-{Guid.NewGuid():N}");
        Directory.CreateDirectory(root);
        try
        {
            File.WriteAllText(Path.Combine(root, "FakeHousing.cs"), """
                [LocDisplayName("Source Fake Housing")]
                [LocDescription("Source description for fake housing.")]
                public partial class FakeHousingItem : WorldObjectItem<FakeHousingObject>
                {
                }

                [RequireComponent(typeof(PowerConsumptionComponent))]
                public partial class FakeHousingObject : WorldObject
                {
                    protected override void Initialize()
                    {
                        this.GetComponent<PowerConsumptionComponent>().Initialize(250);
                    }
                }

                [RequiresSkill(typeof(FakeCraftingSkill), 2)]
                public partial class FakeHousingRecipe : RecipeFamily
                {
                    public FakeHousingRecipe()
                    {
                        var recipe = new Recipe(
                            ingredients: new List<IngredientElement>
                            {
                                new IngredientElement(typeof(FakeBoardItem), 3, typeof(FakeCraftingSkill)),
                                new IngredientElement("HewnLog", 2, typeof(FakeCraftingSkill)),
                            },
                            items: new List<CraftingElement>
                            {
                                new CraftingElement<FakeHousingItem>(2),
                            });
                        CraftingComponent.AddRecipe(tableType: typeof(FakeCraftingTableObject), recipeFamily: this);
                    }
                }

                [RequiresSkill(typeof(FakeCraftingSkill), 2)]
                public partial class FakeHousingVariantRecipe : Recipe
                {
                    public FakeHousingVariantRecipe()
                    {
                        this.Init(
                            name: "FakeHousingVariant",
                            displayName: Localizer.DoStr("Fake Housing Variant"),
                            ingredients: new List<IngredientElement>
                            {
                                new IngredientElement(typeof(FakeBoardItem), 4, typeof(FakeCraftingSkill)),
                            },
                            items: new List<CraftingElement>
                            {
                                new CraftingElement<FakeHousingVariantItem>()
                            });
                        CraftingComponent.AddTagProduct(typeof(FakeCraftingTableObject), typeof(FakeHousingRecipe), this);
                    }
                }
                """);
            File.WriteAllText(Path.Combine(root, "WorldObjectOccupancyAutoGen.cs"), """
                public static class WorldObjectOccupancyAutoGen
                {
                    public static void Initialize()
                    {
                        WorldObject.AddOccupancy<FakeHousingObject>(new List<BlockOccupancy>(){
                            new BlockOccupancy(new Vector3i(0, 0, -1)),
                            new BlockOccupancy(new Vector3i(0, 1, -1)),
                            new BlockOccupancy(new Vector3i(1, 0, -1)),
                            new BlockOccupancy(new Vector3i(1, 1, -1)),
                            new BlockOccupancy(new Vector3i(0, 0, 0)),
                            new BlockOccupancy(new Vector3i(0, 1, 0)),
                            new BlockOccupancy(new Vector3i(1, 0, 0)),
                            new BlockOccupancy(new Vector3i(1, 1, 0)),
                            new BlockOccupancy(new Vector3i(2, 0, 0), typeof(PipeSlotBlock), new Quaternion(0f, 0f, 0f, 1f), BlockOccupancyType.WaterInputPort),
                            new BlockOccupancy(new Vector3i(2, 0, 1), typeof(PipeSlotBlock), new Quaternion(0f, 0f, 0f, 1f), BlockOccupancyType.SewageOutputPort),
                            new BlockOccupancy(new Vector3i(0, 2, 0), typeof(PipeSlotBlock), new Quaternion(0f, 0f, 0f, 1f), BlockOccupancyType.ChimneyOut),
                        });
                    }
                }
                """);
            File.WriteAllText(Path.Combine(root, "fr.xlf"), """
                <?xml version="1.0" encoding="UTF-8"?>
                <xliff xmlns="urn:oasis:names:tc:xliff:document:1.2" version="1.2">
                  <file source-language="en" target-language="fr" datatype="plaintext" original="TestStrings">
                    <body>
                      <trans-unit id="0">
                        <source xml:space="preserve">Source Fake Housing</source>
                        <target xml:space="preserve">Faux logement source</target>
                      </trans-unit>
                    </body>
                  </file>
                </xliff>
                """);

            var provider = new ReflectionEcoHousingExportProvider(
                () => [typeof(FakeHousingItem).Assembly],
                () => new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero),
                sourceRoots: [root]);
            var data = provider.GetData();
            var recipe = data.Recipes.Single(entry => entry.ClassName == nameof(FakeHousingRecipe));
            var variantRecipe = data.Recipes.Single(entry => entry.ClassName == "FakeHousingVariantRecipe");
            if (variantRecipe.VariantBaseRecipeClass != nameof(FakeHousingRecipe))
            {
                throw new InvalidOperationException("Source recipe enrichment did not extract tag-product variant base recipe.");
            }
            if (recipe.CraftingTableClass != nameof(FakeCraftingTableObject))
            {
                throw new InvalidOperationException("Source recipe enrichment did not extract crafting table.");
            }
            if (recipe.Products.SingleOrDefault(product => product.ItemClass == nameof(FakeHousingItem))?.Quantity != 2)
            {
                throw new InvalidOperationException("Source recipe enrichment did not extract products.");
            }
            if (recipe.Ingredients.SingleOrDefault(ingredient => ingredient.ItemClass == nameof(FakeBoardItem))?.Quantity != 3
                || recipe.Ingredients.SingleOrDefault(ingredient => ingredient.Tag == "HewnLog")?.Quantity != 2)
            {
                throw new InvalidOperationException("Source recipe enrichment did not extract ingredients.");
            }
            var sourceItem = data.Items.Single(entry => entry.ClassName == nameof(FakeHousingItem));
            if (sourceItem.FriendlyName != "Source Fake Housing"
                || sourceItem.LocalizedName?["en"] != "Source Fake Housing"
                || sourceItem.LocalizedName?["fr"] != "Faux logement source"
                || sourceItem.Description != "Source description for fake housing.")
            {
                throw new InvalidOperationException("Source presentation enrichment did not extract item name, translation, and description.");
            }
            var occupancy = data.Occupancy.SingleOrDefault(entry => entry.WorldObjectClass == nameof(FakeHousingObject));
            if (occupancy is null || occupancy.BlockCount != 11 || occupancy.FloorArea != 6 || occupancy.Width != 3 || occupancy.Depth != 3 || occupancy.Height != 3)
            {
                throw new InvalidOperationException("Source occupancy enrichment did not extract normalized dimensions.");
            }
            var worldObject = data.WorldObjects.Single(entry => entry.ClassName == nameof(FakeHousingObject));
            if (worldObject.OperationalRequirements?.PowerConsumption?.Watts != 250
                || worldObject.OperationalRequirements.PowerConsumption.Type != "UnknownPower"
                || worldObject.OperationalRequirements.Water?.Input != true
                || worldObject.OperationalRequirements.Water.SewageOutput != true
                || worldObject.OperationalRequirements.Chimney?.SmogOutput != false)
            {
                throw new InvalidOperationException("Source operational requirement enrichment did not merge power, water, sewage, and chimney requirements.");
            }
            if (!data.Meta.TryGetValue("extractionCompleteness", out var completeness)
                || completeness is not Dictionary<string, string> map
                || map["recipes"] != "source-code"
                || map["occupancy"] != "source-code"
                || map["requirements"] != "source-code"
                || map["presentation"] != "source-code")
            {
                throw new InvalidOperationException("Source recipe enrichment did not update completeness metadata.");
            }
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    private static void AssertInstalledEcoVariantRecipeParsing()
    {
        var path = @"C:\Program Files (x86)\Steam\steamapps\common\Eco Server\Mods\__core__\AutoGen\WorldObject\AdornedAshlarSandstoneTable.cs";
        if (!File.Exists(path)) return;

        var source = File.ReadAllText(path);
        var recipes = new EcoSourceRecipeReader().ParseSourceFile(source, new HashSet<string>(StringComparer.Ordinal)
        {
            "AdornedAshlarSandstoneTableItem",
            "AdornedAshlarStoneTableItem",
        }, Path.GetFileName(path));
        var variant = recipes.SingleOrDefault(recipe => recipe.ClassName == "AdornedAshlarSandstoneTableRecipe");
        if (variant?.VariantBaseRecipeClass != "AdornedAshlarStoneTableRecipe")
        {
            throw new InvalidOperationException("Installed Eco variant recipe source did not parse AddTagProduct base recipe.");
        }
    }

    private static void AssertReflectionEconomyReader()
    {
        var reader = new ReflectionEcoLiveEconomyReader(() =>
        [
            new FakeLiveStore
            {
                StoreName = "Live Carpentry",
                Seller = "Alice",
                StoreId = "store-live",
                SellerId = "seller-live",
                SellOffers =
                [
                    new FakeLiveOffer
                    {
                        ItemClass = "HewnTableObject",
                        Quantity = 4,
                        UnitPrice = 8.5,
                        Currency = new FakeLiveCurrency { Name = "Credits" },
                        TaxRate = 0.1,
                    },
                ],
            },
            new FakeDictionaryStore
            {
                StoreName = "Nested Market",
                Seller = "Bob",
                StoreId = "store-nested",
                SellerId = "seller-nested",
                Listings = new Dictionary<Type, FakeNestedLiveOffer>
                {
                    [typeof(FakeHousingItem)] = new()
                    {
                        AvailableQuantity = 7,
                        Price = new FakeNestedPrice
                        {
                            Amount = 3.25,
                            Currency = new FakeLiveCurrency { Name = "Nested Credits" },
                        },
                        Fee = 0.2,
                    },
                },
            },
            new FakeEcoStyleStoreComponent
            {
                Parent = new FakeEcoStyleWorldObject
                {
                    Name = "Named Store",
                    DisplayName = "Store Display",
                    ObjectID = Guid.Parse("11111111-1111-1111-1111-111111111111"),
                    NameOfCreator = "Charlie",
                },
                CurrencyName = "Server Credits",
                StoreData = new FakeEcoStyleStoreData
                {
                    SellOffers =
                    [
                        new FakeEcoStyleTradeOffer
                        {
                            Stack = new FakeEcoStyleStack
                            {
                                Item = new FakeEcoStyleItem { ClassName = "WorkbenchItem" },
                                Quantity = 3,
                            },
                            Price = 11,
                            Buying = false,
                        },
                    ],
                    BuyOffers =
                    [
                        new FakeEcoStyleTradeOffer
                        {
                            Stack = new FakeEcoStyleStack
                            {
                                Item = new FakeEcoStyleItem { ClassName = "IgnoredBuyItem" },
                                Quantity = 99,
                            },
                            Price = 1,
                            Buying = true,
                        },
                    ],
                },
            },
        ]);

        var economy = new EcoEconomySnapshotBuilder(reader, () => new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero)).Build();
        var listing = economy.Listings.SingleOrDefault(entry => entry.ItemClass == "HewnTableItem");
        if (listing is null)
        {
            throw new InvalidOperationException("Reflection economy reader did not expose the live fake store offer.");
        }
        if (listing.Quantity != 4 || listing.Price != 8.5 || listing.Currency != "Credits")
        {
            throw new InvalidOperationException("Reflection economy reader changed quantity, price, or currency.");
        }
        if (listing.StoreName != "Live Carpentry" || listing.Seller != "Alice" || listing.StoreId != "store-live" || listing.SellerId != "seller-live" || listing.TaxRate != 0.1)
        {
            throw new InvalidOperationException("Reflection economy reader dropped store metadata.");
        }

        var nestedListing = economy.Listings.SingleOrDefault(entry => entry.ItemClass == nameof(FakeHousingItem));
        if (nestedListing is null)
        {
            throw new InvalidOperationException($"Reflection economy reader did not expose dictionary-backed store offers. Listings: {string.Join(", ", economy.Listings.Select(entry => $"{entry.ItemClass}/{entry.Currency}/{entry.Price}"))}. Warnings: {string.Join(" | ", economy.Warnings)}");
        }
        if (nestedListing.Quantity != 7 || nestedListing.Price != 3.25 || nestedListing.Currency != "Nested Credits" || nestedListing.Fee != 0.2)
        {
            throw new InvalidOperationException("Reflection economy reader did not read nested price/currency metadata.");
        }

        var ecoStyleListing = economy.Listings.SingleOrDefault(entry => entry.ItemClass == "WorkbenchItem");
        if (ecoStyleListing is null || ecoStyleListing.Quantity != 3 || ecoStyleListing.Price != 11 || ecoStyleListing.Currency != "Server Credits")
        {
            throw new InvalidOperationException("Reflection economy reader did not read Eco-style StoreData/SellOffers/Stack.Quantity.");
        }
        if (ecoStyleListing.StoreName != "Named Store" || ecoStyleListing.Seller != "Charlie" || ecoStyleListing.StoreId != "11111111-1111-1111-1111-111111111111")
        {
            throw new InvalidOperationException("Reflection economy reader did not read Eco-style parent store metadata.");
        }
        if (economy.Listings.Any(entry => entry.ItemClass == "IgnoredBuyItem"))
        {
            throw new InvalidOperationException("Reflection economy reader exposed a buy offer as a sell listing.");
        }
    }

    private static void AssertDataBuilderVariantsAndEquivalences()
    {
        var builtData = new EcoDataSnapshotBuilder(new FakeVariantEquivalenceDataReader(), () => new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero)).Build();
        var baseBench = builtData.Housing.Single(entry => entry.ItemClass == "HewnBenchItem");
        var variantBench = builtData.Housing.Single(entry => entry.ItemClass == "HewnHardwoodBenchItem");
        var stoneBench = builtData.Housing.Single(entry => entry.ItemClass == "MortaredStoneBenchItem");

        if (baseBench.VariantGroupKey != "HewnBenchRecipe" || baseBench.VariantItemClasses.Count != 2 || variantBench.VariantOfItemClass != "HewnBenchItem")
        {
            throw new InvalidOperationException("Data builder did not annotate variant groups.");
        }
        if (builtData.HousingEquivalenceGroups.Count != 1 || baseBench.EquivalenceGroupKey is null || stoneBench.EquivalenceGroupKey != baseBench.EquivalenceGroupKey)
        {
            throw new InvalidOperationException("Data builder did not create housing equivalence groups.");
        }
        var option = builtData.HousingEquivalenceGroups[0].Options.Single(entry => entry.ItemClass == "MortaredStoneBenchItem");
        if (!option.RequiredSkillClasses.Contains("MasonrySkill"))
        {
            throw new InvalidOperationException("Data builder did not attach recipe skills to equivalence options.");
        }
    }
}

public sealed class FakeEndpointHost : IEcoHousingEndpointHost
{
    public Dictionary<string, Func<string, EcoHousingHttpResponse>> Handlers { get; } = [];

    public void RegisterEndpoint(string path, Func<string, EcoHousingHttpResponse> handler)
    {
        Handlers[path] = handler;
    }
}

public sealed class FakeRichExportProvider : IEcoHousingExportProvider
{
    public EcoHousingStatusDto GetStatus() => new(
        ServerName: "Smoke Server",
        EcoVersion: "0.0-smoke",
        ExporterVersion: EcoHousingApiContract.ExporterVersion,
        GeneratedAt: "2026-01-01T00:00:00.0000000+00:00",
        Endpoints: EcoHousingApiContract.Endpoints,
        Warnings: []);

    public EcoHousingDataDto GetData() => new EcoDataSnapshotBuilder(
        new FakeDataReader(),
        () => new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero)).Build();

    public EcoHousingEconomyDto GetEconomy() => new EcoEconomySnapshotBuilder(
        new FakeEconomyReader(),
        () => new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero)).Build();
}

[AttributeUsage(AttributeTargets.Class, AllowMultiple = true)]
public sealed class TagAttribute(string name) : Attribute
{
    public string Name { get; } = name;
}

[AttributeUsage(AttributeTargets.Class)]
public sealed class LocDisplayNameAttribute(string name) : Attribute
{
    public string Name { get; } = name;
}

public sealed class LocDescriptionAttribute(string description) : Attribute
{
    public string Description { get; } = description;
}

public sealed class RequiresSkillAttribute(Type skillType, int level) : Attribute
{
    public Type SkillType { get; } = skillType;
    public int Level { get; } = level;
}

public sealed class RequireRoomVolumeAttribute(double volume) : Attribute
{
    public double Volume { get; } = volume;
}

public sealed class RequireRoomMaterialTierAttribute(double tier) : Attribute
{
    public double Tier { get; } = tier;
}

public sealed class RequireRoomContainmentAttribute : Attribute;

[AttributeUsage(AttributeTargets.Class, AllowMultiple = true)]
public sealed class RequireComponentAttribute(Type componentType) : Attribute
{
    public Type ComponentType { get; } = componentType;
}

public sealed class OccupancyRequirementComponent;

public sealed class RoomRequirementsComponent;

public sealed class PowerConsumptionComponent;

[LocDisplayName("Fake Housing Object")]
[Tag("Surface")]
[RequireComponent(typeof(OccupancyRequirementComponent))]
[RequireComponent(typeof(RoomRequirementsComponent))]
[RequireComponent(typeof(PowerConsumptionComponent))]
[RequireRoomContainment]
[RequireRoomVolume(12)]
[RequireRoomMaterialTier(2.2)]
public sealed class FakeHousingObject;

[Tag("Housing")]
[LocDisplayName("Fake Housing")]
public sealed class FakeHousingItem : WorldObjectItem<FakeHousingObject>
{
    public static readonly FakeHomeFurnishingValue homeValue = new()
    {
        BaseValue = 7,
        Category = new FakeRoomCategory("Bathroom"),
        TypeForRoomLimit = "Toilet",
        DiminishingReturnMultiplier = 0.2,
    };
}

public sealed class FakeHomeFurnishingValue
{
    public double BaseValue { get; set; }

    public FakeRoomCategory? Category { get; set; }

    public string? TypeForRoomLimit { get; set; }

    public double DiminishingReturnMultiplier { get; set; }
}

public sealed class FakeRoomCategory(string name)
{
    public string Name { get; } = name;
}

public abstract class WorldObjectItem<TWorldObject>;

[LocDisplayName("Fake Crafting")]
public sealed class FakeCraftingSkill;

[RequiresSkill(typeof(FakeCraftingSkill), 2)]
public sealed class FakeHousingRecipe;

public sealed class FakeBoardItem;

public sealed class FakeCraftingTableObject;

public sealed class FakeEconomyReader : IEcoLiveEconomyReader
{
    public EcoLiveEconomySnapshot ReadSnapshot() => new(
        Currencies: [new EcoLiveCurrency("Credits")],
        SellOffers:
        [
            new EcoLiveStoreOffer(
                ItemClass: "HewnTableObject",
                Quantity: 3,
                UnitPrice: 12.5,
                Currency: "Credits",
                StoreName: "Carpentry Store",
                Seller: "Player",
                StoreId: "store-1",
                SellerId: "seller-1",
                TaxRate: 0.05),
            new EcoLiveStoreOffer(
                ItemClass: "HewnTableItem",
                Quantity: 2,
                UnitPrice: 12.5,
                Currency: "Credits",
                StoreName: "Carpentry Store",
                Seller: "Player",
                StoreId: "store-1",
                SellerId: "seller-1",
                TaxRate: 0.05),
            new EcoLiveStoreOffer(
                ItemClass: "BadOfferItem",
                Quantity: 0,
                UnitPrice: 1,
                Currency: "Credits",
                StoreName: "Bad Store",
                Seller: "Player"),
        ],
        Warnings: []);
}

public sealed class FakeLiveStore
{
    public string? StoreName { get; set; }
    public string? Seller { get; set; }
    public string? StoreId { get; set; }
    public string? SellerId { get; set; }
    public List<FakeLiveOffer> SellOffers { get; set; } = [];
}

public sealed class FakeLiveOffer
{
    public string? ItemClass { get; set; }
    public double Quantity { get; set; }
    public double UnitPrice { get; set; }
    public FakeLiveCurrency? Currency { get; set; }
    public double? TaxRate { get; set; }
}

public sealed class FakeDictionaryStore
{
    public string? StoreName { get; set; }
    public string? Seller { get; set; }
    public string? StoreId { get; set; }
    public string? SellerId { get; set; }
    public Dictionary<Type, FakeNestedLiveOffer> Listings { get; set; } = [];
}

public sealed class FakeNestedLiveOffer
{
    public double AvailableQuantity { get; set; }
    public FakeNestedPrice? Price { get; set; }
    public double? Fee { get; set; }
}

public sealed class FakeNestedPrice
{
    public double Amount { get; set; }
    public FakeLiveCurrency? Currency { get; set; }
}

public sealed class FakeLiveCurrency
{
    public string? Name { get; set; }
}

public sealed class FakeEcoStyleStoreComponent
{
    public FakeEcoStyleWorldObject? Parent { get; set; }
    public string? CurrencyName { get; set; }
    public FakeEcoStyleStoreData StoreData { get; set; } = new();
}

public sealed class FakeEcoStyleWorldObject
{
    public string? Name { get; set; }
    public string? DisplayName { get; set; }
    public Guid ObjectID { get; set; }
    public string? NameOfCreator { get; set; }
}

public sealed class FakeEcoStyleStoreData
{
    public List<FakeEcoStyleTradeOffer> SellOffers { get; set; } = [];
    public List<FakeEcoStyleTradeOffer> BuyOffers { get; set; } = [];
}

public sealed class FakeEcoStyleTradeOffer
{
    public FakeEcoStyleStack? Stack { get; set; }
    public double Price { get; set; }
    public bool Buying { get; set; }
}

public sealed class FakeEcoStyleStack
{
    public FakeEcoStyleItem? Item { get; set; }
    public double Quantity { get; set; }
}

public sealed class FakeEcoStyleItem
{
    public string? ClassName { get; set; }
}

public sealed class FakeDataReader : IEcoLiveDataReader
{
    public EcoLiveDataSnapshot ReadSnapshot()
    {
        var item = new EcoItemDto(
            ClassName: "HewnTableItem",
            FriendlyName: "Hewn Table",
            LocalizedName: null,
            Description: null,
            WorldObjectClass: "HewnTableObject",
            Categories: [],
            Tags: ["Housing"],
            HiddenCategory: false,
            NotInBrowser: false,
            NoIcon: false,
            IconUrl: null,
            AttachmentDirections: [],
            VariantGroupKey: null,
            VariantOfItemClass: null,
            VariantItemClasses: [],
            EquivalenceGroupKey: null,
            EquivalentItemClasses: [],
            Source: "test");

        var housing = new HousingValueDto(
            ItemClass: "HewnTableItem",
            FriendlyName: "Hewn Table",
            LocalizedName: null,
            Description: null,
            WorldObjectClass: "HewnTableObject",
            Category: "Seating",
            Value: 1,
            TypeForRoomLimit: "Table",
            DiminishingReturnPercent: 50,
            DiminishingMultiplierAcrossFullProperty: null,
            HasDynamicFurnishingValue: false,
            Categories: [],
            Tags: ["Housing"],
            HiddenCategory: false,
            NotInBrowser: false,
            NoIcon: false,
            IconUrl: null,
            AttachmentDirections: [],
            VariantGroupKey: null,
            VariantOfItemClass: null,
            VariantItemClasses: [],
            EquivalenceGroupKey: null,
            EquivalentItemClasses: [],
            Source: "test");

        return new EcoLiveDataSnapshot(
            Items: [item, item],
            Housing: [housing, housing],
            Recipes: [],
            Skills: [],
            RoomCategories:
            [
                new RoomCategoryDto(
                    Name: "Seating",
                    LocalizedName: null,
                    ColorHex: null,
                    ColorSource: null,
                    CanBeRoomCategory: false,
                    CanAutoChooseCategory: true,
                    SupportForAnyRoomType: true,
                    NegatesValue: false,
                    ShouldCapFromRoomMaterials: true,
                    MaxSupportPercentOfPrimary: 30,
                    MaxSupportPercentOfPrimaryPerCategory: null,
                    CapToPercentOfRestOfProperty: null,
                    SupportingRoomCategoryNames: []),
            ],
            RoomTiers: [new RoomTierDto(1, 5, 10, 65), new RoomTierDto(1, 5, 10, 65)],
            WorldObjects: [],
            Occupancy: [],
            HousingEquivalenceGroups: [],
            ConstructionMaterials: [new ConstructionMaterialTierDto(1, ["HewnLogItem"], "test")],
            HousingConfig: null,
            Metadata: new Dictionary<string, object?> { ["source"] = "test" },
            Warnings: []);
    }
}

public sealed class FakeVariantEquivalenceDataReader : IEcoLiveDataReader
{
    public EcoLiveDataSnapshot ReadSnapshot()
    {
        var items = new[]
        {
            Item("HewnBenchItem", "Hewn Bench", "HewnBenchObject"),
            Item("HewnHardwoodBenchItem", "Hewn Hardwood Bench", "HewnHardwoodBenchObject"),
            Item("MortaredStoneBenchItem", "Mortared Stone Bench", "MortaredStoneBenchObject"),
        };
        var housing = new[]
        {
            Housing("HewnBenchItem", "Hewn Bench", "HewnBenchObject"),
            Housing("HewnHardwoodBenchItem", "Hewn Hardwood Bench", "HewnHardwoodBenchObject"),
            Housing("MortaredStoneBenchItem", "Mortared Stone Bench", "MortaredStoneBenchObject"),
        };
        var recipes = new[]
        {
            Recipe("HewnBenchRecipe", "HewnBenchItem", "LoggingSkill", null),
            Recipe("HewnHardwoodBenchRecipe", "HewnHardwoodBenchItem", "LoggingSkill", "HewnBenchRecipe"),
            Recipe("MortaredStoneBenchRecipe", "MortaredStoneBenchItem", "MasonrySkill", null),
        };
        return new EcoLiveDataSnapshot(
            Items: items,
            Housing: housing,
            Recipes: recipes,
            Skills: [],
            RoomCategories: [],
            RoomTiers: [],
            WorldObjects:
            [
                WorldObject("HewnBenchObject", "HewnBenchItem"),
                WorldObject("HewnHardwoodBenchObject", "HewnHardwoodBenchItem"),
                WorldObject("MortaredStoneBenchObject", "MortaredStoneBenchItem"),
            ],
            Occupancy:
            [
                new OccupancyDto("HewnBenchObject", 2, 2, 2, 1, 1),
                new OccupancyDto("HewnHardwoodBenchObject", 2, 2, 2, 1, 1),
                new OccupancyDto("MortaredStoneBenchObject", 2, 2, 2, 1, 1),
            ],
            HousingEquivalenceGroups: [],
            ConstructionMaterials: [],
            HousingConfig: null,
            Metadata: new Dictionary<string, object?> { ["source"] = "variant-test" },
            Warnings: []);
    }

    private static EcoItemDto Item(string className, string name, string worldObjectClass) => new(
        ClassName: className,
        FriendlyName: name,
        LocalizedName: null,
        Description: null,
        WorldObjectClass: worldObjectClass,
        Categories: [],
        Tags: ["Housing"],
        HiddenCategory: false,
        NotInBrowser: false,
        NoIcon: false,
        IconUrl: null,
        AttachmentDirections: [],
        VariantGroupKey: null,
        VariantOfItemClass: null,
        VariantItemClasses: [],
        EquivalenceGroupKey: null,
        EquivalentItemClasses: [],
        Source: "test");

    private static HousingValueDto Housing(string itemClass, string name, string worldObjectClass) => new(
        ItemClass: itemClass,
        FriendlyName: name,
        LocalizedName: null,
        Description: null,
        WorldObjectClass: worldObjectClass,
        Category: "Seating",
        Value: 1,
        TypeForRoomLimit: "Bench",
        DiminishingReturnPercent: 50,
        DiminishingMultiplierAcrossFullProperty: null,
        HasDynamicFurnishingValue: false,
        Categories: [],
        Tags: ["Housing"],
        HiddenCategory: false,
        NotInBrowser: false,
        NoIcon: false,
        IconUrl: null,
        AttachmentDirections: [],
        VariantGroupKey: null,
        VariantOfItemClass: null,
        VariantItemClasses: [],
        EquivalenceGroupKey: null,
        EquivalentItemClasses: [],
        Source: "test");

    private static RecipeDto Recipe(string className, string itemClass, string skillClass, string? variantBaseRecipeClass) => new(
        ClassName: className,
        Name: className,
        LocalizedName: null,
        RequiredSkillClass: skillClass,
        RequiredSkillLevel: 1,
        CraftingTableClass: null,
        VariantBaseRecipeClass: variantBaseRecipeClass,
        Products: [new RecipeElementDto(itemClass, null, 1, null)],
        Ingredients: [],
        Source: "test");

    private static WorldObjectRequirementDto WorldObject(string className, string itemClass) => new(
        ClassName: className,
        DisplayName: className,
        RepresentedItemClass: itemClass,
        Categories: [],
        Tags: [],
        RequireRoomContainment: false,
        RequiredRoomVolume: null,
        RequiredRoomMaterialTier: null,
        RequiresOccupancy: true,
        RequiresRoomRequirements: false,
        AttachmentDirections: [],
        OperationalRequirements: null);
}
