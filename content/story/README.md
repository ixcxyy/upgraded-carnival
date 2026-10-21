# The story files

The story side of Signal / Noise: chapters 1–4 and their 15 tasks, as plain text. Clickable clues feed a case board and a codex, with a recall scene, four epilogue fragments and saves. Each task's sheet (lab sheet, exam sheet or work order) is written here; the puzzle behind it — the board, the stimulus, the checker — lives in `crates/levels`, and the two have to agree.

The game builds these files into its UI (`app/ui/build.mjs` inlines every `.story` file into the page), so an edit here shows up on the next build. In a running game, Menu → Author tools → Story files → Load .story files replaces files on the spot and checks them.

## Check

```
node tools/ledger-cli.js content/story        # check the story and play it through 450 times
```

The ledger must report no errors before a release; CI runs it on every push.

## The .story format

```
@@title SIGNAL / NOISE                 file-level settings; %FIRM% %FIRMSHORT% %MCU% %CITY% are substituted everywhere
@@chapter ch1 | Chapter 1 | Lab 2.14 | University | doc_exam_notice    id | label | title | phase | lore docs unlocked at its end

=== scene ch1_open                     blocks: person place hypothesis doc device coda scene clue task
@chapter ch1
@place lab214
@location Lab 2.14 · Engineering, third floor
~ Narration. {Hotspot text|clue_id} anywhere in a line makes a clickable detail.
Brandt: Dialogue. Elias [text]: phone text. Brandt [letter]: letter. Elias: (in the notebook) notebook line.
? flag:measured_hb | ~ Any line can be conditional.
* "A choice that calls a sub-scene, then comes back" => ch1_ask_point
+ "An ask option; the menu stays until a * is chosen" => ch2_ask_what
* [flag:jonas_invite] A gated choice that jumps -> ch4_jonas_flat
! next ch1_home        ! task 1.1        ! stat trust.brandt +1        ! flag name
! open H_A             ! demote H_A      ! doc id    ! device id       ! place id
! chapter ch1          ! endchapter ch1  ! recall    ! believe         ! codex devices    ! ending
```

**Conditions** join with `&`, and `!` negates one: `flag:x`, `stat:trust.sina>=3`, `seen:c`, `noticed:c`, `followed:c`, `tag:pattern>=3` (followed clues carrying the tag), `tagphases:pattern>=2`, `solved:3.1`, `taskextra:4.4`.

**Clues** take `@chapter` (the only time they can be clicked), `@volume loud|murmur|whisper`, `@track technical|situational`, `@tags`, `@supports`, `@weakens`, `@opens`, `@observation`, `@observation_if cond | text`, `@ask label => scene` and `@decoy`. Clicking gives three choices: ask (when the clue has an `@ask`), note, or let go. Asked and noted clues pin to the case board.

**Tasks** take `@form lab|exam|workorder`, `@behavior`/`@schematic`/`@rules`/`@datasheet` … `@end` blocks, and `@capture` … `@end` with `span 0 4000` and `ch NAME | 0:0 1000:1 | clue` or `ch NAME | hb from to`. They also take `@hint1`–`@hint3` (as "Speaker: text"), `@after scene`, `@driver` and `@extra cond | text` (an extra check that clue attention adds, and that an epilogue can require).

**Hypotheses** marked `@key` are held to the rule of three by the ledger. `@trail` marks a false trail.

## What the ledger checks

It checks that every reference resolves (scenes, clues, tasks, docs, devices, speakers, flags and stats) and that every clue is planted in its own chapter. It also checks hotspot density per scene, the rule of three for key hypotheses, and each epilogue gate's slack: how many clues can be missed before the gate locks. Then it plays the story with zero clicks, every hotspot, and half the hotspots with failed runs, 150 times each. It confirms the main ending is always reachable, reports how often each epilogue opens, checks scene coverage, and checks that the same seed gives the same log.

## Saves

Each profile is a folder in the game's data folder, with `save.json` (progress, every clue's state, the full log and the workbench layout) next to the player's C files in `workspace/`. Menu → Profiles, saves and settings → Open the profile folder shows it.
