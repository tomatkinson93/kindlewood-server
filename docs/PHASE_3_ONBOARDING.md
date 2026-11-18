# Phase 3 — Onboarding and the guide

**Status (2026-11-17): agreed with the owner and being built.** Section 8
says what is built. Section 9 records the decisions. This turns
`ROADMAP_1_0.md` §6 into something buildable against the game as it stands
(the Home scene, moments, building time behind its switch).

## 1. What it is for

A new player should get three payoffs in the first fifteen minutes: **build
something, send someone on an errand, and meet a family.** They should leave
the first session knowing what will have happened by tomorrow, and wanting to
see it.

It is measured, not guessed: the funnel records the first time each player
reaches each step (`lib/milestones.js`, Dev Tools → Funnel), now including
"the tour began", "three homes built", "finished the tour" and "skipped the
tour", and a row for every beat reached (`guide:<key>`).

## 2. What existed before (so nothing is rebuilt)

| Piece | Where | State |
|---|---|---|
| The funnel | `lib/milestones.js`, `js/funnel-admin.js` | built; needs real numbers |
| The dialogue box for moments | `js/say.js` (`KWSay.ask`) | built |
| First steps: a checklist worked out from what the town has done | `lib/first_steps.js`, `js/first-steps.js` | built; becomes the guide's "What next?" (§6) |
| The five places | `js/places.js` | built; §6 changes what a new town sees |
| Home: buildings as buttons, Build mode, villagers with a menu | `js/home-scene.js`, `js/villager-engine.js` | built |
| Moments: a new town's first comes within ten minutes, a gentle one | `lib/moments.js` | built |

**What a new town is given** (`routes/map.js`): ten founders in families,
three starter buildings by species (Mice: Granary, Farm, Market), 500 food,
300 timber, 150 stone, 50 iron, 100 wealth, and no homes.

## 3. The new town

**It still starts with no homes** (owner's decision). The elder gives timber
and stone for exactly three homes and walks the player through building them
in the Neighbourhood and moving someone in. So the first thing a player does
is put roofs over their people's heads, with the elder's gift, not their own
stores.

## 4. The guide

### 4.1 Who
An elder of the player's species: a voice, not a citizen (they do not age,
work, or appear in the families). The owner draws a character for each
(`ART_GUIDE.md` §8, batch T); until a picture is there the species' emoji
stands in.

| Species | Name | Manner |
|---|---|---|
| Mice | Old Bramble | fussy, kind, counts everything |
| Badgers | Gran Holt | blunt, proud of hard work |
| Otters | Uncle Reedy | cheerful, easily distracted by the river |
| Moles | Deepa Loam | patient, speaks in short sentences |
| Foxes | Aunt Russet | sly, fond of a bargain |
| Hares | Thistle the Elder | brisk, always a little out of breath |

Each has their own greeting and goodbye today (`lib/guide.js` `ELDERS`); the
rest of the script is shared until the owner has heard how they feel.

### 4.2 The look
As in the owner's reference picture: the character stands large at the lower
left (up to 62 % of the screen's height), and a dark translucent box across
the bottom carries their name, one line at a time, and an arrow for "next".
The game stays visible and usable behind it; only the box and the character
take clicks. On a phone the character stands above a full-width box. This is
`KWSay.tell` in `js/say.js`, so anything else that should speak this way
(an envoy, the crier) can use it.

### 4.3 How it works
- **The server holds the tour** (`lib/guide.js`, `guide_progress`): which beat
  a player is on, when it is done, and what has been given. So it survives a
  reload and follows the player to their phone.
- **A beat** is one to three short lines and, usually, one thing to do. It is
  done when the town shows it (a home stands, someone has the job), when a
  route noted it (someone was moved into a home), or, for things that change
  nothing (a villager pressed, a window opened, a walk to another part of
  Home), when the screen reports it. Nothing that gives anything can be
  completed by the screen saying so.
- **While it waits** the lines fold to a chip at the lower left: the elder,
  what to do, "hear that again", "Skip the tour", and the step number. The
  thing to press is ringed (`js/guide.js`: named targets, most exact first:
  a villager, then their menu's button once the menu is open; Build, then a
  plot once Build mode is on, then the choice once the panel is open).
- **The ring only goes on what can be pressed.** Of several matches it takes
  the first that is on the screen and not behind something else (a villager
  standing behind a building is passed over). When none is on the screen it
  leads the view there, scrolling only what a player could scroll, and rings
  nothing less exact meanwhile. Villagers hide while building, so Done is
  ringed first for anything that needs one. Behind an open window, the
  window's close button is ringed. In a villager's page, the job chooser is.
- **It never blocks.** Everything in the game works whatever the beat.
- **Skip** at any time. Skipping gives every gift the tour would have given
  (the homes' timber and stone, the errand's reward, the parting gift), and
  brings home anyone out on the errand.
- **Replay** from Help starts it again; what the town has already done is
  passed as it comes, and no gift is given twice.
- **Lines name real villagers** (someone with a partner for "meet a family",
  a forager for the first job), and read plainly where there is nobody to
  name.

## 5. The first session (as built)

| # | Beat | The elder says (Mice) | Rings | Done when |
|---|---|---|---|---|
| 1 | arrival | "There you are. I have counted us twice: ten, and not one roof." "Welcome to {town}…" | — | next |
| 2 | look | "Drag the view to look about. Those are your people. Press one of them." | a villager | a villager is selected (screen) |
| 3 | family | "Everyone here belongs to a family. Press Family to see theirs." | Family in their menu | the family window opens (screen) |
| 3b | builder | (building time only) "Nothing gets built here without a builder…" | Work in {a}'s menu | someone is a builder |
| 4 | homes_gift | "First, roofs. Here is timber and stone enough for three homes: my gift." | the Neighbourhood | the player walks there (screen) |
| 5 | first_home | "Press Build, then an empty plot, and choose how the home should look." | Build, a plot, a style | one home stands |
| 6 | more_homes | "That is four beds. We are ten: two more homes, if you please." | a plot | three homes stand |
| 7 | move_in | "They have found their own beds. But who lives where is yours to say…" | a home, then Move in | someone is moved in by hand |
| 8 | lumber | "Now, timber… choose the Lumber Camp." | Build, a plot, the camp | a Lumber Camp stands |
| 9 | job | "A camp wants a woodcutter. Press {b}, choose Work…" | Work in {b}'s menu | someone is a woodcutter |
| 10 | errand | "Word has come from the next valley… Send someone to hear them out." | Send someone | the errand is sent |
| 11 | families | "{errand} will be back in two minutes. Meanwhile, look in on the Families." | Families | Families is opened (screen) |
| 12 | collect | "{errand} is back, and not empty-handed." | Hear the news | the errand is collected |
| 13 | moment | "Someone wants a word with you. It is yours to decide, and nothing here is wrong." | the waiting moment | a moment is answered by the player |
| 14 | goodbye | their own goodbye; "By tomorrow: {tomorrow}"; a parting gift | — | next: the tour is done |

- **Homes move people in by themselves** when they are built (as they always
  have), so beat 7 teaches the house window's Move in by asking for one move.
- **The first errand** is the guide's own (decision 3): two minutes, always
  comes home, 30 wealth and 40 food. It counts as the first quest sent and
  collected in the funnel. The Tavern, and with it The Road, comes later.
- **The first moment** is the real moments system: reaching the beat starts a
  gentle one at once if none is waiting.
- **{tomorrow}** is built from the real town: the Lumber Camp filling the
  store, a pair who may grow closer, when the merchant is due.
- **Building time** (decision 6): the tour is written for it. Where it is on,
  beat 3b comes first, and the chip offers a free **Finish now** on whatever
  is being built, six times during the tour, so no beat waits on builders.

## 6. After the first session

- **What next?** The first-steps checklist becomes the guide's list.
- **Later, one-off lines** the first time a thing happens, once the tour is
  over: a merchant's visit, a lost thing, a broken building, a Tavern (The
  Road), a Guild Hall (The Clan), a raid, a season turning, a birth
  (`lib/guide.js` `LATER`).
- **Progressive unlock.** A town founded with the tour sees Home, Families
  and The Land; The Road appears when it has a Tavern and The Clan when it
  has a Guild Hall. Towns from before this, and towns that asked for a
  replay, see all five.

## 7. Rules it keeps

- **Never blocks.** Every beat can be ignored; closing the box is always
  possible.
- **Never lies.** Lines are filled from the real town.
- **Server decides.** Progress, completion and gifts are on the server.
- **One voice.** The story layout is one function, `KWSay.tell`.
- **Access.** Enter, Space or the arrow key advance; the box is a named
  dialog; the chip is a live region; buttons are at least 36 px (44 on the
  ring); reduced motion stills the ring and the arrow.
- **Measured.** Each beat reached is a funnel row.

## 8. Build order

1. ~~Homes on arrival~~ (dropped: decision 1).
2. **Server** (built 2026-11-17): `lib/guide.js`, `/api/guide`,
   `migrations/0NN_guide.sql`, `scripts/guide_test.js`.
3. **The look and the guide** (built 2026-11-17): `KWSay.tell`,
   `js/guide.js`, `css/guide.css`.
4. **Pointing** (built 2026-11-17, with step 3).
5. **The first session** on a brand-new town, desktop and phone (followed
   in a browser by pressing only what is ringed: 2026-11-18).
6. **What next?** replaces the first-steps card; Help gets Replay.
7. **Progressive unlock** (the server and the place bar are built; the
   one-off lines for Tavern and Guild Hall come with step 8).
8. **Later beats**.
9. **Watch five to ten first sessions** and tune.

## 9. Decisions (owner, 2026-11-17)

1. **No homes on arrival.** The elder gives the resources and walks the
   player through building them and moving people in.
2. **Skip is always available**, and skipping gives every reward the tour
   would have given.
3. **The first errand is the guide's own.**
4. **The elder is a voice, not a citizen.** The owner draws a character for
   each species, shown large at the lower left with the dialogue box across
   the bottom, as in the reference picture.
5. **Progressive unlock only for towns founded after this ships.** Also: a
   "Play as a fresh test account" button on the login screen, deleted on
   sign-out (`lib/test_accounts.js`), for the owner's testing.
6. **The tour is written for building time**, with a free Finish now during
   the tour so nothing waits on builders.
7. **The six names stand for now.**
8. **Ships with the species' emoji standing in** until the owner's
   characters are in (`ART_GUIDE.md` §8, batch T).
