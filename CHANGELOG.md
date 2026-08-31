# Changelog

## 0.8.6

### Fixed

- Swapping an already-selected species or background (including through the new "Resolve Missing Choice" button, and the equivalent "redo this class's choices"/swap-a-feat actions) could leave the next choice screen invisible - it was fully there and interactable underneath, just impossible to see, and could also leave a stray "undefined" label above it.
- Swapping a feat that grants no further choices of its own (for example switching a background's origin feat to Alert) could permanently freeze that step with an empty panel and no way to continue except closing and reopening the wizard.

## 0.8.5

### Fixed

- The Actor Directory's "Create Character"/"Resume Character"/"My Characters" buttons could wrap their own label text onto multiple lines on a narrow sidebar (most noticeable for a non-GM player), instead of the whole button moving to its own row the way Foundry's native buttons do.
- Picking an item through an inline browser nested inside a native advancement popup (for example a spell chosen through Magic Initiate, an Ability Score Improvement's feat choice, or a Subclass pick) could leave a large empty gap in the panel afterward.
- If a species or background's own choice (or a feat it granted, such as a human's bonus origin feat) was skipped past without answering, the character could get permanently stuck: "Next" stayed blocked, and there was no way to reopen that choice or change species/background/the stuck feat at all. Species/Background cards with an unresolved choice now show a "Resolve Missing Choice" button to redo the pick, and a stuck origin feat can now be swapped even when the "Minimum Feat Level" house rule would otherwise block picking feats. This also covers pre-split lineage species (Elf, Tiefling, Gnome, etc.).

## 0.8.3

### New

- **Cantrips/spells-known progression table**: an optional, collapsible reference table on the Spells step shows a spellcasting class's cantrip and spell counts across all 20 levels, similar to a printed class table but limited to just those two columns.
- **"My Characters" panel**: a player-facing counterpart to the GM's Progress dashboard. Shows your own in-progress draft and finished characters (useful if you have more than one) - read-only, with no way to see or affect anyone else's characters, and no way to raise your own level from here.
- **"Resume Character"**: the Actor Directory button now says "Resume Character" (with a short explanation) instead of "Create Character" whenever you already have an unfinished character, so it's clear your progress is still there after a disconnect or a page refresh.
- A short "Loading..." label now appears under the spinner during a step transition that takes a moment, instead of the wizard appearing to do nothing.

### Improved

- Moving between steps (especially into Feats) is now noticeably faster, particularly on tables with a lot of installed content - the wizard no longer inspects every class feature in every enabled compendium just to find the handful of real feats, and a step's content list is now cached for the rest of the session instead of being recomputed on every render.
- The ability-score-improvement-or-feat choice (including a 2024-rules Epic Boon pick) and a class or feat's own nested "choose from a list" pick (for example Magic Initiate's spell choice) now open their item browser inline inside the wizard, matching how spell and equipment browsing already worked, instead of popping out as a separate window.

### Fixed

- Sorcerer, Bard, Warlock, and Ranger under the 2014 ruleset showed cantrips but no leveled spells at all - their "spells known" count is tracked differently from prepared casters like Wizard or Cleric, which the lookup didn't account for.
- The wizard could freeze or take a long time to respond when moving past the Abilities step, most noticeably on a table with several content modules installed.

## 0.8.0

### New

- **Level Up redesigned**: the Class step now shows a big "Level Up" card (with a preview of what the next level actually grants) alongside a "Multiclass into a New Class" card, replacing the plain level dropdown. Picking either takes you straight into the resulting choices, and once they're resolved the wizard automatically moves on to the next step instead of leaving you on Class.
- **Quick level control on the GM Progress Dashboard**: a small progress bar with +1/-1 buttons and an "add several levels at once" option lets a game master raise or lower a finished character's level directly from the dashboard, opening a guided Level Up session for whatever choices that change requires.
- **Level-change notifications**: a character's own player is now whispered a chat message when their level changes without them doing it themselves (for example, a game master leveling up their character from the dashboard). The existing "ready to level up" notification now always reaches the player too, not only the game master.
- **Point Buy and reroll house rules**: a game master can now customize Point Buy's minimum/maximum ability score and point budget, and allow or disallow rerolling a rolled ability score, from the House Rules settings screen. Defaults match the standard rules (8-15 range, 27 points, rerolls allowed).
- The Abilities step now highlights whichever ability your current class (or classes, if multiclassed) actually relies on, updating automatically as classes are added, swapped, or removed.

### Fixed

- Artificer showed no cantrips at all on the Spells step during creation - its cantrip count is tracked under a different internal key than every other spellcasting class, which the lookup didn't account for.
- The embedded spell/item browser could show duplicate, unfiltered results from generic SRD sourcebooks the very first time it was opened in a session, correcting itself only after closing and reopening it - the underlying source filter needed a moment to finish loading that a single, non-retrying check could miss.
- Closing the embedded spell/item browser (Cancel or a confirmed selection) could briefly show a visibly collapsed, broken-looking panel before the wizard's normal content reappeared.

## 0.7.3

### New

- **Ability Scores step redesigned**: each ability is now a flip card with its own icon. The front keeps the existing Standard Array/Point Buy/Roll/Manual controls; the back shows that ability's saving throw and every skill it governs, including passive scores. The separate Skills step has been removed - it was a plain read-only table showing the same information, now folded directly into these cards.
- **Browse Feats**: the Feats step gained a general browsable grid of every available feat, not just the background's origin feat swap, with a level-requirement pill on any feat you don't yet qualify for and a plain warning (not a hard block) if you pick one anyway or one that would duplicate a "normally singular" type like your Fighting Style.
- **Inline item browsing**: picking a spell, buying equipment, resolving an equipment category choice, or choosing a subclass now opens dnd5e's compendium browser directly inside the wizard window instead of a separate popup, with its filter panel collapsed to just Search by default and content matching your character's ruleset shown first.
- **GM Progress Dashboard improvements**: now lists finished characters alongside in-progress drafts, with class/level, species, background, HP, and (when your world uses XP-based leveling) a "ready to level up" indicator; the dashboard also refreshes itself live as players make progress, with no need to click Refresh. A whispered chat notification lets a game master (and, if enabled, the player) know when a character has earned enough XP to level up.
- **Level Up now works with Tidy 5e Sheets**, and only shows the steps that are actually relevant to an existing character (no Ruleset/Species/Background/Abilities/Equipment) - continuing your current class is a single click, and multiclassing into a new one is an explicit opt-in rather than always-expanded.
- **Add Custom** now covers subclasses and equipment as well as class/species/background/feat/spell.

### Improved

- The Ability Scores grid now lays out three cards per row instead of six in one line, with a "Flip All" button and a small always-visible flip control on each card.
- The Class, Species, and Background card grids now flow "Add Custom" into whatever room is left in the last row instead of always starting a new one.
- Review's Feats section now shows each feat as a full row with its subtype, and its name links to dnd5e's own item preview on hover.

### Fixed

- A Warlock or a third-caster subclass (Eldritch Knight, Arcane Trickster) could show no spellcasting options at all on the Spells step - the third-caster case reads its spellcasting configuration from the subclass rather than the class, which wasn't accounted for.
- Removing a class or swapping Background could leave behind spells or starting equipment that were never actually removed, tagged to a source that no longer existed on the character.
- An equipment choice offering a fixed item "or" a category of items (for example "a Greataxe or any martial melee weapon") silently did nothing when picked - both alternatives, including a focus-item alternative, now resolve correctly.
- A background or class Ability Score Improvement could be reported as fully resolved even when no points had actually been spent on it, letting a step show as complete with a real choice still missing.
- The "Minimum Feat Level" house rule wasn't enforced on the new Browse Feats grid, only the origin-feat swap.
- Several embedded compendium-browser layout issues: duplicated filter rows, a search box crowded by an oversized "Filters" button, an oversized empty gap above search results, and a Select button that could scroll out of view.

## 0.7.0

### New

- **Identity step**: a new step, positioned right before About, for Name, Portrait, Pronoun, Alignment, and Backstory - with a "Randomize Name" button (a pool of invented, generic fantasy names) and a few short roleplay tips. The rest of the physical-characteristics fields stayed on About.
- **Configurable step order**: a game master settings screen lets you reorder the wizard's steps (drag-and-drop, or up/down buttons for keyboard use), resettable to the default order. Applies to every player and the game master alike.
- **Accent color picker**: the default accent is now a neutral tone instead of red, so it no longer sits in direct color competition with the step rail's green "done" state. A small picker (alongside the existing text-size/Simplify controls) offers four more accent options, including the previous red. "Simplify" now also strips card gradients, not just artwork.
- **Randomize buttons** on Class, Species, Background, and Abilities let you quickly pick a random option to start from - you still resolve every resulting choice normally, nothing is auto-completed for you.
- **One-click diagnostic report**: a "Copy Diagnostic Report" entry in the wizard window's own "..." menu copies module/Foundry/dnd5e versions, your current step, and basic environment info to the clipboard, useful when reporting a bug.
- Ability score bonuses granted by a class, species, or background (for example "increase one ability by 2 and a different one by 1") are now previewed directly on that item's card and in its "Learn More" panel, before you pick it.
- Background cards now show which abilities their Ability Score Improvement can raise and the name of the feat they grant, at a glance.
- The Abilities step now opens with Standard Array already selected instead of a blank method picker.

### Improved

- Class cards are now fully square; Species and Background cards use a taller 3:4 ratio instead of a wide rectangle.
- The README now states plainly that the module runs entirely locally, with no telemetry.
- Back/Next button labels and tooltips are clearer about what each one does.

### Fixed

- A Warlock-only character could not pick any spells (cantrips and feats worked fine) - the spell-level filter only checked normal spell slots and missed Pact Magic's separate slot table. Warlock spell selection now works correctly.
- Typing in one field on the About or Identity step, then clicking directly into a different field, could scramble the second field's cursor/selection.
- The Backstory editor could visually hide the cursor and typed text behind its own toolbar under certain layouts; fixed so the editor's toolbar and text area stack correctly.
- The "Build Character" button (and a few other solid-accent-filled controls) could render illegible text against the new lighter default accent color.

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
