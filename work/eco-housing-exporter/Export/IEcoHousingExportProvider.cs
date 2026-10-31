using EcoHousingExporter.Contracts;

namespace EcoHousingExporter.Export;

public interface IEcoHousingExportProvider
{
    EcoHousingStatusDto GetStatus();
    EcoHousingDataDto GetData();
    EcoHousingEconomyDto GetEconomy();
}

public interface IEcoHousingDataWarmup
{
    void StartDataWarmup();
}
