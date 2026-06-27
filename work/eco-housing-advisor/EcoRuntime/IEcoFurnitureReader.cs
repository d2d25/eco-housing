using System.Collections.Generic;
using EcoHousingAdvisor.Domain;

namespace EcoHousingAdvisor.EcoRuntime
{
    public interface IEcoFurnitureReader
    {
        IReadOnlyList<HousingFurnitureItem> ReadFurniture();
    }
}
