# Changelog

## 0.6.7

### New

- **Getting Started step** (renamed from "Ruleset"): a short, factual comparison of what actually differs between the 2014 and 2024 rules for a new player (ability score increase source, starting feats, Weapon Mastery, terminology), with a few terms linked straight into dnd5e's own bundled rules-glossary compendiums for a real hover explanation - no rules text of our own.
- **Level Up**: a button on an already-finished character's own sheet reopens the wizard pointed at that character instead of a fresh draft, so you can add levels, resolve new choices, and pick up new class features through the same guided flow used at creation.
- **GM Progress Dashboard**: a button next to "Create Character" in the Actor Directory (game master only) lists every player's in-progress draft, who owns it, which step they're on, and which required steps are still incomplete, with a button to reopen the wizard on that specific draft.
- **Accessibility pass**: the step list is fully keyboard-navigable (tab/enter/space), done and warning states carry a distinct icon instead of relying on color alone, and a persistent text-size control (A/A+/A++) and a "Simplify" toggle (hides card artwork, keeps the plain colored card) are available at any time.
- **Richer "Add Custom"**: homebrew class/species/background creation now has real type-specific fields (hit die and primary ability for a class, speed for a species, spell level and school for a spell) instead of just a bare name, and a second tab lets you adopt an already-existing world item instead of only starting from a blank placeholder.
- **Class step comparison**: an opt-in "Compare" mode lets you check 2-3 addable classes and see their hit die, primary ability, complexity, and party role side by side. An already-added class also gets a small warning icon when its primary ability sits on the character's current lowest score.

### Improved

- Compendium Sources (game master settings) now groups packs into Core Rules / Expanded Rules / Homebrew / Legacy instead of one flat table.
- Class, Species, and Background addable-item grids are grouped by source book, with the core rulebook listed first.
- Any step is now reachable directly from the step rail - navigating alone never changes anything, only picking something does.
- The persistent header was redesigned: portrait and name moved into the top of the step rail, and the text-size/Simplify/Sources/Start Over controls moved into the native window title bar as compact icon buttons.
- The wizard window holds a fixed size regardless of text-size setting; oversized content scrolls within the window instead of resizing it.
- The embedded advancement panel (skill picks, hit points, subclass choices) got a real "easier to read" pass: bigger text, bigger controls, and hit point rolls now render as large display digits instead of being lost in empty space.
- The About step's Characteristics and Personality sections were compacted to fit without an awkward half-empty row, and Languages now shows the "add a language" controls before the list of known languages.
- The Review step was trimmed to fit a fully-built character without scrolling at the default window size.

### Fixed

- The portrait picker now falls back to a plain path/URL prompt for a player who lacks Foundry's file-browsing permission, instead of silently doing nothing.
- A completeness check could misreport a genuinely finished choice (for example a Weapon Mastery pick) as unresolved, because some of dnd5e's own tracked selections are a real `Set`, not an array or plain object.
- Swapping Species or Background could, in rare cases, end up removing both the old and the new item, because dnd5e rejects adding a second Species/Background while one already exists. Swapping now removes the old item first and shows a confirmation listing exactly what the current pick granted before doing anything.
- The Class step's complexity filter, remove-class button, and a few other custom buttons could render at the wrong size because of how Foundry layers module CSS under its own core styles; fixed with the correct cascade-layer-aware override.
- The Equipment step now clearly states that starting currency has no source beyond the class/background kit or "take gold instead," since that was previously easy to miss.
