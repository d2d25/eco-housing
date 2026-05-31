# Eco Data Extractor

Extracteur local pour transformer les fichiers serveur/mods d'Eco en JSON exploitable par un futur outil d'optimisation housing/craft.

## Utilisation

```powershell
node .\work\eco-data-extractor\src\extract-eco-data.mjs --eco-path "C:\Program Files (x86)\Steam\steamapps\common\Eco" --out .\outputs\eco-data.json
```

Tu peux aussi pointer directement vers le dossier `Mods` :

```powershell
node .\work\eco-data-extractor\src\extract-eco-data.mjs --mods-path "C:\Program Files (x86)\Steam\steamapps\common\Eco\Eco_Data\Server\Mods" --out .\outputs\eco-data.json
```

## Donnees extraites

- `items` : classes item, nom lisible, description si disponible, source.
- `housing` : valeurs housing declarees dans `HousingValue`.
- `recipes` : produits, ingredients, skill requis, table de craft.
- `skills` : classes de skills detectees.

L'objectif est de garder cette couche independante de l'interface : quand Eco change de version, on relance l'extracteur et l'app lit le nouveau JSON.

## Lancer l'interface

Depuis la racine du projet :

```powershell
node .\work\serve-outputs.mjs
```

Puis ouvrir :

```text
http://127.0.0.1:4173
```
