# How To Create An Issue

Use GitHub issues to report problems. There are two main cases.

## App-vs-Game Calculation Difference

Use the **App vs game calculation bug** template when the app result differs from Eco's in-game **Room Details** tooltip.

Please include:

- the JSON file exported from the Room page with **Export**;
- a screenshot of Eco's **Room Details** tooltip for the same room;
- a short summary of the difference.

Example summary:

```text
App total: 18.6
Game total: 18.74
Possible difference: material tier cap or seating support cap
```

The exported JSON contains the app version, export schema version, app configuration, and calculated result. The screenshot is required because the game tooltip is the comparison source.

If you receive a JSON file from another tester, use **Import** on the Room page to load the same configuration locally. Imports are accepted only for supported `schemaVersion` values; incompatible future formats should be reported as import errors.

## Other Bugs Or Feedback

Use the **General beta feedback** template for anything that is not an app-vs-game calculation difference:

- confusing labels;
- layout or mobile problems;
- slow interactions;
- missing object information;
- filters that are hard to use;
- deployment or loading problems.

Include the app version or URL and a short reproduction path when possible.
