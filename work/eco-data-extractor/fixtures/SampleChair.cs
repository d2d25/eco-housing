namespace Eco.Mods.TechTree
{
    using Eco.Gameplay.Housing;
    using Eco.Gameplay.Items;
    using Eco.Gameplay.Objects;
    using Eco.Gameplay.Skills;
    using Eco.Gameplay.Components;

    public partial class SampleChairObject : WorldObject
    {
    }

    public partial class SampleChairItem : WorldObjectItem<SampleChairObject>
    {
        public override string FriendlyName { get { return "Sample Chair"; } }
        public override string Description { get { return "A small test chair."; } }

        [TooltipChildren] public static HousingValue HousingVal { get { return new HousingValue()
        {
            Category = "Chair",
            Val = 2.5f,
            TypeForRoomLimit = "Living Room",
            DiminishingReturnPercent = 0.5f
        };}}
    }

    [RequiresSkill(typeof(CarpentrySkill), 1)]
    public partial class SampleChairRecipe : Recipe
    {
        public SampleChairRecipe()
        {
            this.Products = new CraftingElement[]
            {
                new CraftingElement<SampleChairItem>(),
            };

            this.Ingredients = new CraftingElement[]
            {
                new CraftingElement<HewnLogItem>(typeof(CarpentryEfficiencySkill), 4, CarpentryEfficiencySkill.MultiplicativeStrategy),
                new CraftingElement<PlantFibersItem>(2),
            };

            this.Initialize("Sample Chair", typeof(SampleChairRecipe));
            CraftingComponent.AddRecipe(typeof(CarpentryTableObject), this);
        }
    }

    public partial class CarpentrySkill : Skill
    {
        public override string FriendlyName { get { return "Carpentry"; } }
    }
}
