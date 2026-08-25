# D&D Character Creator

A Foundry VTT module that adds a step-by-step character creation wizard for the dnd5e system. It supports both rulesets: 2014 (5e) and 2024 (5.5e).

This module does not copy text from any book. It reads classes, species, backgrounds, feats, spells, and equipment from the compendiums already installed in your world (system packs, official modules like the Player's Handbook, and any homebrew content).

The module runs entirely locally. It does not send data anywhere, does not phone home, and does not collect any telemetry.

## Requirements

- Foundry VTT version 13 or 14.
- The dnd5e system, version 3.0 or newer.

## Installation

1. In Foundry, open "Add-on Modules" and add the module using its manifest link, or copy this folder into `Data/modules/`.
2. Enable the module in your world's settings.
3. Open the "Actors" tab. A button to create a character will appear there.
4. The wizard creates a real Actor for the draft character, so players need the "Create New Actors" permission. By default Foundry only grants this to the game master. Go to **Configure Permissions** and enable "Create New Actors" for the Player role (or for individual players) so they can use the wizard themselves.

## What the wizard does

- Eleven steps: Ruleset, Class, Species, Background, Abilities, Feats, Skills, Spells, Equipment, About, Review.
- Choosing a ruleset (2014, 2024, or both) controls which content is offered.
- Multiclassing: add as many classes as you want and remove any of them.
- Species that are split into several variants in the compendiums (for example Elf: Drow, High, Wood) show up as one card with a variant picker, instead of separate cards.
- Four ways to generate ability scores: standard array, point buy, dice roll (per ability, with the option to swap values), and manual entry.
- Character advancement (skill picks, traits, subclass choices, and so on) happens right inside the wizard window, with no separate popups.
- The Equipment step lets you pick a starting kit from your class or background, or buy your own gear using the character's real money. You cannot buy something you cannot afford.
- The "Learn More" button on a class or species card shows its stats and real features, with a link to the compendium.
- The "Add Custom" button quickly creates a placeholder for a homebrew class, species, or background, which you can then finish by hand.
- The character's portrait and name can be edited from any step.
- A finished character can be exported as a PDF (for printing) or as a Foundry Journal Entry.
- The "Start Over" button lets you delete the current draft character and begin a new one.

## Settings for the game master

All settings are available through the module's menu in the world's Configure Settings screen.

**Compendium Sources.** A list of every installed pack that contains items. The game master chooses which packs the wizard can use, and can optionally tag each one as 2014, 2024, or both.

**House Rules.** Lets you restrict:
- which ability score generation methods players can use;
- which alignments are not allowed;
- the minimum level needed to pick a feat;
- which species are banned at the table.

**Default Ruleset.** Which ruleset (2014, 2024, or both) a new character starts with.

**Require GM review before finalizing.** When turned on, a player's "Build Character" button does not finish the character right away. Instead it sends the game master a chat card asking for approval. The game master is never subject to this setting. It is off by default.

## Settings for players

The "Sources" button in the wizard's top bar lets a player personally hide any content source the game master has enabled (for example, a book the player does not own). This only affects that player's own view, not the table's settings.

## Language

The interface is available in English right now, can be changed later.

## License

MIT. See the [LICENSE](LICENSE) file.
