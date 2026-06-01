# Eco Housing Beta

Utilitaire local/web pour optimiser une piece dans Eco et explorer les objets housing a partir de donnees extraites du jeu.

La documentation principale est en anglais a la racine du depot. Ce dossier garde les notes francaises pour le contexte projet.

Pour creer une issue exploitable, voir [ISSUES.md](./ISSUES.md).

## Etat actuel

- Page **Piece**: optimise une piece selon type, tier, taille, metiers, objets acquis et autorisations.
- Page **Objets**: catalogue filtrable des objets housing avec valeur, craftabilite, dimensions, volume et placement.
- Version beta: `0.1.0-beta`.

## Lancer en local

```powershell
npm run install:app
npm run dev
```

## Tester et builder

```powershell
npm test
npm run build
```

Le build statique est genere dans `outputs/`. Le fichier `outputs/eco-data.json` doit rester present.
