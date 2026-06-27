#if ECO_MODKIT
using Eco.Gameplay.Players;
using Eco.Gameplay.Systems.Messaging.Chat;
using Eco.Gameplay.Systems.Messaging.Chat.Channels;
using Eco.Gameplay.Systems.Messaging.Chat.Commands;
using EcoHousingAdvisor.Domain;
using EcoHousingAdvisor.EcoRuntime;
using EcoHousingAdvisor.Presentation;

namespace EcoHousingAdvisor.Commands
{
    [ChatCommandHandler]
    public static class HousingAdvisorCommands
    {
        [ChatCommand("List housing furniture values discovered from the Eco runtime.")]
        public static void HousingAdvisor(User user)
        {
            var furniture = new EcoFurnitureReader().ReadFurniture();
            var groups = new HousingFurnitureGrouper().GroupFurniture(furniture);
            var text = new AdvisorTextRenderer().RenderFurnitureGroups(groups);
            ChatManager.SendMessage(user, ChannelManager.Obj.Get(SpecialChannel.General), text);
        }
    }
}
#endif
