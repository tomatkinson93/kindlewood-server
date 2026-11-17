# Phase 3 — Onboarding and the guide (DRAFT for the owner, 2026-11-17)

**Status: a draft. Nothing here is built.** It turns `ROADMAP_1_0.md` §6 into
something that can be built, against the game as it stands today (the Home
scene, moments, building time behind its switch). Section 9 lists the
decisions that are the owner's; each has a recommendation, and the build
order in section 8 assumes the recommendations.

## 1. What it is for

A new player should get three payoffs in the first fifteen minutes: **build
something, send someone on an errand, and meet a family.** They should leave
the first session knowing what will have happened by tomorrow, and wanting to
see it.

It is measured, not guessed: the funnel already records the first time each
player reaches each step (`lib/milestones.js`, Dev Tools → Funnel). The
numbers to move are "built something", "changed a job", "answered a moment"
and "came back the next day".

## 2. What exists today (so the spec does not rebuild it)

| Piece | Where | State |
|---|---|---|
| The funnel: 18 steps from "made an account" to "came back after a week" | `lib/milestones.js`, `js/funnel-admin.js` | built; needs real numbers |
| The dialogue box: portrait, speaker, a line or two, up to three options | `js/say.js` (`KWSay`) | built; used by moments |
| First steps: a checklist worked out from what the town has done | `lib/first_steps.js`, `js/first-steps.js` | built; the guide replaces it (§6) |
| The five places, all shown from the start | `js/places.js` | built; §5 changes what a new town sees |
| Home: buildings as buttons, Build mode, villagers with a menu, Follow | `js/home-scene.js`, `js/villager-engine.js` | built |
| Moments: a new town's first comes within ten minutes and is a gentle one | `lib/moments.js` | built |
| Help | `js/help.js` | built; gets "Replay the tour" |

**What a new town is given** (`routes/map.js`): ten founders in families,
three starter buildings by species (Mice: Granary, Farm, Market), 500 food,
300 timber, 150 stone, 50 iron, 100 wealth, and **no homes**. So today a new
player's first look at their villagers finds every one of them thinking "Has
no bed of their own", the town card says "Beds 10 of 0", and the Neighbourhood
is empty. That is the first thing to fix (§3).

## 3. The new town (before any guide)

1. **Homes on arrival.** A new town is founded with three Willow Huts already
   standing (12 beds for 10 founders), placed on the first three open plots
   and the founders seated by family, as the beds-cliff fix did for old
   towns. The first thing a player sees is a small lived-in place.
2. **The founders' jobs.** As now: foragers, plus whatever the species'
   starter buildings need.
3. **Nothing else changes** in what a town starts with. The guide's first
   build is paid for from the starting timber.

## 4. The guide

### 4.1 Who
An elder of the player's species with a name and a manner of speaking, one
per species (roadmap decision 5). The portrait is the species' existing art
until proper portraits exist (`ART_GUIDE.md` gets a batch for six elder
portraits when this is built).

| Species | Name | Manner |
|---|---|---|
| Mice | Old Bramble | fussy, kind, counts everything |
| Badgers | Gran Holt | blunt, proud of hard work |
| Otters | Uncle Reedy | cheerful, easily distracted by the river |
| Moles | Deepa Loam | patient, speaks in short sentences |
| Foxes | Aunt Russet | sly, fond of a bargain |
| Hares | Thistle the Elder | brisk, always a little out of breath |

The guide is a voice, not a citizen: they do not age, work, or appear in the
families. (See decision 4.)

### 4.2 How it works
One module, `js/guide.js` (`KWGuide`), driven by a script held as data. A
step is:

```js
{ key: 'build_lumber',
  say: ['Timber first, {town} needs timber.', 'Press Build, then an empty plot.'],
  point: 'tool:build',            // what to ring (see 4.3)
  until: 'built:lumber_camp',     // the game event that completes it (see 4.4)
  then: 'A fine camp. {builder} will be pleased.' }   // optional line when done
```

- **Lines** are shown in `KWSay` with the elder's portrait and a "next"
  arrow. `{town}`, `{citizen}`, `{partner}` and the like are filled from the
  real town, so the guide names real villagers.
- **Waiting.** When a step has `until`, the box folds to a small chip ("Old
  Bramble: press Build") and waits for the player to do it. It never blocks
  the game: everything else still works.
- **Progress is on the server** (`guide_progress`: user, step key, state
  `active | done | skipped`, when), so it survives a reload and follows the
  player to their phone. `GET /api/guide`, `POST /api/guide/advance { key }`,
  `POST /api/guide/skip`, `POST /api/guide/replay`.
- **The server checks completion.** A step is done when the server sees the
  thing has happened (the same checks the first-steps list uses today), not
  when the client says so. The client only asks "has it happened yet?"
  (and listens for the live event).
- **Skip** at any time ("Skip the tour" in the box, and in Help). **Replay**
  in Help starts it again from the first step that still makes sense.

### 4.3 Pointing
`point` names a target; the module finds its element and draws a pulsing
ring round it, dimming the rest slightly. Targets are named, not CSS
selectors, so the script does not break when markup moves:

`tool:build`, `tool:names`, `building:<type>`, `plot:any`, `villager:<id>`,
`villager-menu:work`, `place:families`, `place:land`, `card:town`,
`window:<id>`, `moment:first`.

If the target is in another part of Home, the ring goes on the signpost
first. On a phone the ring is at least 44 px. Under reduced motion it does
not pulse.

### 4.4 Events
`until` is one of a small set the server can check and the live stream
already carries: `built:<type>`, `job:<class>` (or `job:any`),
`errand:sent`, `errand:collected`, `opened:<window>`, `moment:answered`,
`place:<key>`, `selected:villager`. `opened:` and `place:` and `selected:`
are client-only (they change nothing), and are the only ones the client may
complete by itself.

## 5. The first session

Written against the Home scene. Each beat is one or two lines and one thing
to do. Target: done in twelve to fifteen minutes; no beat needs waiting more
than two minutes.

| # | Beat | The guide says (Mice) | Points at | Done when |
|---|---|---|---|---|
| 1 | Arrival | "There you are. Welcome to {town}. Ten of us, three roofs, and a great deal to do." | nothing | next |
| 2 | Look round | "Drag the view to look about. Those are your people. Press one." | any villager | a villager is selected |
| 3 | Meet someone | "That is {citizen}. {partner} is their partner. Everyone here belongs to a family." | their menu's Family | the family window is opened |
| 4 | Build | "Timber first. Press Build, then an empty plot, and choose the Lumber Camp." | Build, then a plot | a Lumber Camp stands |
| 5 | A job | "A camp needs a woodcutter. Press {forager} and give them the work." | that villager, then Work | someone is a woodcutter |
| 6 | An errand | "The {village} folk have left word. Send {citizen2} to see what they want." | the notice (see decision 3) | an errand is sent |
| 7 | While they are gone | "They will be back in two minutes. Meanwhile, the Families: who is courting, who is expecting." | Families | Families is opened |
| 8 | Collect | "{citizen2} is back, and not empty-handed." | the returned errand | it is collected |
| 9 | A choice | "Someone wants a word with you. It is yours to decide; nothing here is wrong." | the first moment | it is answered |
| 10 | Goodbye | "That is a good first day. By tomorrow: {tomorrow}. I will be about if you want me." | nothing | closed |

- **Beat 4 with building time on:** the first building of a new town
  finishes at once, this one time, whether or not anyone is a builder
  (roadmap §6.2), and the guide's next beat is "Make someone a builder" in
  place of the woodcutter. With building time off, as written.
- **Beat 9** uses the real moments system: when the tour reaches it, the
  server starts the town's first gentle moment at once if it has not come
  yet (it is due within ten minutes anyway).
- **Beat 10's `{tomorrow}`** is built from the real town: "the Lumber Camp
  will have filled the stores", "{name} and {name} may be courting", "a
  merchant is due in two days".

## 6. After the first session

- **What next?** The first-steps checklist becomes the guide's list: the
  same server checks, shown from the guide's chip ("Old Bramble: what
  next?") instead of its own card. Steps stay as they are today (scout,
  outpost, research, market), each with a "Show me" that rings the target.
- **Later beats**, one or two lines each, the first time each thing
  happens: the first season turn, the first birth, the first death, the
  first raid warning, the first visit of the merchant, the first lost
  thing, the first broken building (upkeep), a Guild Hall built. Each is a
  row in the same script with an `on:` event instead of a place in the
  order, shown once, never blocking.
- **Progressive unlock** (roadmap §6.3). A new town's place bar shows Home,
  Families and The Land. The Road appears when the town has a Tavern, and
  The Clan when it has a Guild Hall, each with a one-line introduction.
  Nothing is hidden from a player who skipped the tour or whose account is
  older than this phase (decision 5).

## 7. Rules it keeps

- **Never blocks.** Every beat can be ignored; the game underneath always
  works. Closing the box is always possible.
- **Never lies.** Lines are filled from the real town; a beat whose subject
  does not exist (no partner, no village nearby) uses its plain variant.
- **Server decides.** Progress and completion are on the server; a second
  device shows the same beat.
- **One voice.** The guide, moments, the crier and envoys all use `KWSay`.
- **Access.** Tab reaches the box and the ringed target; Enter advances; a
  screen reader hears the line and what to press; full width on phones;
  reduced motion stills the ring.
- **Measured.** Each beat reached is a funnel row (`guide_<key>`), so the
  beat where players stop is visible in Dev Tools → Funnel.

## 8. Build order (assuming §9's recommendations)

1. **Homes on arrival** (§3) and its tests. Ships by itself.
2. **Server:** `guide_progress`, the script's step list and completion
   checks (`lib/guide.js`), the four routes, funnel rows, tests.
3. **`KWGuide`:** lines in `KWSay` with the elder's portrait, the waiting
   chip, skip and replay. No pointing yet; beats 1, 7 and 10 work.
4. **Pointing** (§4.3): the ring, the named targets, the other-area case.
5. **The first session** (§5), beat by beat, with a browser check of a
   brand-new town on desktop and phone. The first errand (decision 3).
6. **What next?** replaces the first-steps card; Help gets Replay.
7. **Progressive unlock** of The Road and The Clan.
8. **Later beats** (§6), a few at a time.
9. **Watch five to ten first sessions** and tune (roadmap §6.1). The spec is
   not finished until the funnel says the tour is being completed.

Steps 1 to 6 are the core. Each is its own commit, with proofs in the
frontend and tests on the server, as in Phases 1, 2 and 4b.

## 9. Decisions for the owner

1. **Homes on arrival.** Recommended: yes, three Willow Huts. The
   alternative is making "build your first home" beat 4 of the tour, which
   teaches the Neighbourhood but leaves the first minute looking like a
   town with a problem.
2. **How much of the tour is required.** Recommended: none; "Skip the tour"
   is always there, and skipping is recorded. The alternative is a short
   forced core (beats 1 to 5), which raises completion and annoys returning
   players making a second account.
3. **The first errand.** Today the quest board is reached from The Road
   (and from the Tavern in Home); the server does not ask for a Tavern. But
   progressive unlock (§6) hides The Road until there is a Tavern, and a new
   town has none (80 timber, 60 food, 40 wealth: affordable, but a second
   build before the first errand). Recommended: a one-off "first errand"
   given by the guide (two minutes, always succeeds, a small reward, counts
   as a quest for the funnel), and the Tavern introduced later as "more of
   these", which is also what brings The Road. Alternatives: make the
   Tavern beat 6 and the quest beat 7 (two builds in a row); or leave The
   Road showing from the start and send the player there (simplest, but it
   opens a screen full of things the tour has not mentioned).
4. **Is the elder a real citizen?** Recommended: no, a voice only. A real
   citizen would be a lovely touch (the guide could die of old age and be
   remembered), but it ties the tour to someone who can be sent away, and a
   very new player losing their guide in week eight reads as a bug.
5. **Who gets progressive unlock.** Recommended: only accounts made after
   it ships; existing towns keep all five places. The alternative
   (everyone, by building) hides The Road from old towns without a Tavern.
6. **Building time and the tour.** Recommended: write the tour for building
   time on (it is the game's direction) and keep the off wording as a
   variant, so turning the switch on later needs no rewrite.
7. **The six names and manners** in §4.1 are placeholders. Change freely;
   each species needs about forty lines in its own voice (a base script
   plus per-species wording for the ten first-session beats).
8. **Portraits.** Recommended: ship with the existing species art, and add
   six elder portraits to `ART_GUIDE.md` when step 3 is built.
