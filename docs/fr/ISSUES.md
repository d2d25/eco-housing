# Comment Creer Une Issue

Utiliser les issues GitHub pour remonter les problemes. Il y a deux cas principaux.

## Difference De Calcul Entre L'App Et Le Jeu

Utiliser le template **App vs game calculation bug** quand le resultat de l'application est different du tooltip Eco **Room Details**.

Il faut fournir:

- le JSON exporte depuis la page **Piece** avec **Export**;
- une capture du tooltip Eco **Room Details** pour la meme piece;
- un resume court de la difference.

Exemple:

```text
App total: 18.6
Game total: 18.74
Difference possible: cap materiaux ou cap support seating
```

Le JSON contient la version de l'app, la version du schema d'export, la configuration et le resultat calcule par l'application. La capture en jeu est obligatoire parce que le tooltip Eco sert de source de comparaison.

Si tu recois un JSON d'un autre testeur, utilise **Import** sur la page Piece pour charger la meme configuration. L'import accepte uniquement les `schemaVersion` supportees; un futur format incompatible doit etre refuse proprement.

## Autres Bugs Ou Retours

Utiliser le template **General beta feedback** pour tout ce qui n'est pas une difference de calcul app vs jeu:

- libelles confus;
- probleme d'affichage;
- lenteur;
- information objet manquante;
- filtres difficiles a utiliser;
- probleme de chargement ou de deploiement.
