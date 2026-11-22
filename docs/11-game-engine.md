# 11 - Game engine (Phase 6)

Code: `backend/src/game/deck.js`, `flip7Game.js` (the rules), `gameManager.js` (clocks and rooms). Screen: `frontend/src/features/game/`.

Rules source: the project owner's *Flip 7 Complete Rules and Online Project Notes* (Op Games Ruleset 3.1). The engine implements Normal Mode only.

## How it is built

| Piece | Job |
|---|---|
| `deck.js` | The 94 cards (79 Number, 6 Score Modifier, 9 Action) and a secure shuffle (`crypto.randomInt`) |
| `flip7Game.js` | **Pure rules**, no database, sockets or timers. A round is written as one generator function that reads like the rulebook; when a player must decide something it *pauses* with a question (a "decision") and resumes when answered. This is what makes a Flip Three inside a Flip Three, or a Freeze drawn mid-sequence, come out right |
| `gameManager.js` | One live game per room (in memory, like the RoomManager). Adds the **time limit**, the **pause between rounds**, and tells the room manager to push the new state |
| `POST /api/rooms/current/game/action` | The only way a player makes a move (doc 05) |

The server is authoritative: the browser sends a *wish* ("Hit"), the engine decides if it is legal. The draw pile's order never leaves the server (only its size is sent). Everything on the table is face-up in Flip 7, so every player receives the **same** game view inside `room:state`.

### Questions the game can ask (`decision.type`)

| Type | Asked when | Valid answers |
|---|---|---|
| `hit_or_stay` | A player's turn | `hit`, `stay` |
| `choose_target` | A player received Freeze / Flip Three (including one set aside during a Flip Three) | `target` + `targetId` among the active players, themselves included |
| `choose_gift` | A player who already holds a Second Chance receives another | `gift` + `targetId` among other active players without one |

Each question has an `id`. A move must quote it (`decisionId`), so a double-click or a late request can never answer a *newer* question. Two simultaneous Hits therefore draw one card.

## Rules as implemented (from the rules document)

Dealing one card each (dealer last, an Action card pauses the deal); Hit gives one card then the turn passes; Stay secures the score; a duplicate Number card busts (round score 0, earlier rounds kept); Second Chance discards only itself: the duplicate stays in the line and counts (**owner's house rule**, see below), the player stays in, no extra turn; a second Second Chance goes to another active player without one or is discarded; Freeze banks the target's points (not a bust), and must target yourself if you are the only active player; Flip Three: three cards one at a time, every card type counts, a bust stops it, Flip 7 ends the round, Freeze/Flip Three drawn during it wait until all three are drawn and are lost if the target busted; modifiers +2..+10 add, x2 doubles only the Number cards, a + card scores alone and x2 alone scores 0; Flip 7 (seven different Number cards, the 0 counts) ends the round at once for everyone with +15 (not doubled), active players score what they have; round score = (Number sum x 1 or 2) + additions + bonus; the 200-point check happens only after a round is scored; most points wins; a tie at the top means extra rounds; the dealer role passes on; used cards go to the discard pile, which is shuffled into a new deck when the draw pile runs out (cards in front of players are left alone).

## Decisions by the project owner (this phase)

| Topic | Decision |
|---|---|
| Ranking points | Equal to the points earned in the game when it finishes (`ranking_points` = `final_points`) |
| Leaving mid-match | The leaver gets **nothing** (0 final, 0 ranking points) and still gets a result row. Leaving a running match needs a **confirmation** (see below) |
| Leavers and card choices | A player who has left **cannot be chosen** for a Freeze, a Flip Three or a spare Second Chance: they are taken out of a choice that is already waiting, and if that leaves only the holder, the holder must take the card. Someone who leaves **in the middle of their own Flip Three** still gets the rest of the three cards: a bust stays a bust, otherwise they count as left once the drawing ends (0 points either way; a spare Second Chance they draw is discarded) |
| Second Chance (house rule) | When a Second Chance saves a duplicate, **only the Second Chance is discarded; the duplicate stays in the line and its points count**. The printed rulebook discards both. A further copy still busts; Flip 7 still needs seven *different* numbers. The view marks saved cards in `savedIndexes`, and the table plays a short "duplicate, saved" animation. To go back to the printed rule, change the Second Chance branch of `#receive` in `flip7Game.js` (marked PROJECT OWNER'S RULE) |
| Turn time limit | **15 seconds** (`GAME_TURN_SECONDS`). No answer = automatic **Stay** |
| Creator leaves on the results screen | Room stays, no transfer; if the others play again without them, the longest-present player becomes owner (Phase 7) |

### Leave confirmation

Leaving while a match is *running* costs the player their points, so it is protected twice: the screen shows a dialog ("you get no points"), **and** the server refuses `POST /api/rooms/current/leave` with `409 LEAVE_CONFIRMATION_REQUIRED` unless the body has `{ "confirm": true }`. After the match is over no confirmation is needed (the points are kept). A player whose connection never comes back (doc 06) is removed by the server itself under the same rules: 0 points.

## Choices I had to make (marked [OPEN] in the code)

The rules document does not cover these. They are sensible defaults, listed so the owner can confirm or change them. None changes how a normal game plays.

1. **First dealer** is chosen at random (the rules say "choose a player").
2. **Time-out on a card choice** (the 15 s also applies to choosing a Freeze / Flip Three target and a Second Chance recipient): a Freeze / Flip Three goes to a **random active player, the holder included** (the owner's choice, to keep it fun); a spare Second Chance is **discarded**. (Hit/Stay time-out is Stay.) The random pick uses the same secure generator as the shuffle.
3. **Only one player left** after others leave: the match ends and that player wins with the points from *completed* rounds; the unfinished round is not scored.
4. **A leaver in the pause between rounds** can decide a tie for the lead (the remaining top player wins immediately).
5. **Pause between rounds:** 8 seconds (`GAME_ROUND_END_SECONDS`) to read the scores; the next round then starts by itself.
6. **Empty deck and discard pile** at the same time (very unlikely, but possible with 12 players holding many cards at once) ends the round instead of hanging.
7. A match with **2 players** (after leavers) continues normally, although the tabletop game starts at 3. The room still needs 3 players to *start*.
8. **Hits / busts** recorded for the match history count each Hit the player chose and each bust (Phase 7 stores them in `MatchPlayers`).

## Match result and saving (Phase 7)

When the match ends, `gameManager` calls `hooks.onFinished({ room, result, startedAt, finishedAt })` exactly once (its `reported` flag is the `finalized` guard). `result` is:

```
{ reason: 'target_reached' | 'last_player', rounds, winnerIds: [userId],
  standings: [{ userId, finalPoints, rankingPoints, hits, busts, left }]  // winner first, then by points; leavers on 0
}
```

`services/matchService.js` saves it in **one transaction** (`db/transaction.js`): one `MatchHistories` row (`Completed`), one `MatchPlayers` row for **every** player who took part (leavers get 0 / 0), and `Users.total_points += ranking_points`. If the database hiccups the save is retried up to 3 times (the players keep seeing their results meanwhile); a final failure is logged. The save runs in the background so a slow database never delays the screen.

If the room empties while a match is still running (the room closes), `hooks.onAbandoned` records one `MatchHistories` row with status `Abandoned` and **no** player rows and no points.

### Results screen, ready system and rematch

- When a match ends the room stays `In Progress` (nobody new can join) and shows the results with **ranking points**. Each remaining player presses **Play again** (`POST /api/rooms/current/ready {ready}`, can be undone).
- A new match starts by itself as soon as **everyone still in the room is ready and at least 3 remain**. Leaving also counts: if the only unready player walks out, the rest start.
- Fewer than 3 players left: no rematch is possible; the screen says so and players leave.
- **Creator leaves on the results screen** (owner's decision): the room is not closed and nobody is promoted. When the rest start another match without them, the **longest-present** remaining player becomes the host (`GameRooms.creator_id` updated). While no host is present nobody has host controls (none are needed on that screen).
- Leaving the results screen needs no confirmation (nothing is lost).
- **Host button (owner's decision):** a rematch starts by itself when *every* member is ready, but the host can also press **Start now with the players who are ready** (`POST /api/rooms/current/rematch`, host only). It needs 3 ready players, the host counting as ready. Members who were not ready watch that match and can get ready for the one after.
- **Spectators (owner's decision):** anyone with the room code can join while a match is being played and **watches** it until the next match, unless the room is **full** (then joining is refused with `ROOM_FULL`, even to watch). A spectator takes a seat (counts toward the room's capacity), sees the same table as the players, is not dealt in, is not saved in the match, and may leave without the "you lose your points" warning. On the results screen they become ordinary members and can press Play again. If the host leaves mid-match, a player is preferred as the next host; a spectator only if nobody else is left.

## Computer players ("Fill empty seats with bots")

In a waiting room the host sees **Fill N empty seats with bots** while there are free seats. `POST /api/rooms/current/fill-bots` counts the empty seats on the server and `services/botService.js` seats that many bots.

- **Who they are:** ordinary `Users` rows whose `google_id` starts with `dev-bot-` (no Google account can), named `Bot_1`, `Bot_2`, ... with avatars from the allowlist. Free accounts are reused; missing ones are created. The developer script `scripts/bots.js` uses the same accounts.
- **How they play:** seated with `manager.join` and playing through `games.act`, like any player, so the engine checks every move. The decision rules (`game/botStrategy.js`, shared with the script): stay at 5 number cards or 25 points unless a Second Chance covers the risk; Freeze / Flip Three go to the opponent with the best round; a spare Second Chance goes to the first player offered. Each move comes after a short pause (1.2 s) so people can follow.
- **Owner's decisions:** bots earn **no ranking points** (set to 0 as the match ends, so the results screen and the database agree); they **stay for the rematch** and press "Play again" by themselves; the host can **kick** them like anyone else (a kicked bot is no longer played).
- **Safety rules:** bots never open a connection, so the socket server gives them no grace timer (doc 06). When the host role moves on, a person is preferred over a bot. When only bots are left, they leave too and the room closes instead of playing forever.
- Only bots seated by the server are played by it: bots run by `scripts/bots.js` keep playing through their own script.

## Tests

- `flip7Game.test.js` (85): the deck, every rule above with hand-stacked decks (rulebook example 66 / 81 included), time-outs, leavers, and **450 randomly played full games** that check the invariants (finish, all 94 cards accounted for between rounds, winner has the top score, leavers on 0). It found a real bug (a leaver's Second Chance discarded twice).
- `game.integration.test.js` (31, real MySQL + sockets): start, moves over HTTP, wrong player, forged player id, double-click, malformed moves, rate limit, live push, leave confirmation, one-player-left, finished-match reporting, clocks (auto-Stay, next round) with short timers.
- `matchLifecycle.test.js` (28, no database): finished match reported once, abandoned room, ready rules, creator rule, saving transaction with retries (fake pool).
- `match.integration.test.js` (16, real MySQL): rows written and totals updated, leavers on 0, one match shared by all players, second match saved separately, ready validation/CSRF, rematch start, creator leaving on the results screen, takeover in the database, closing. Mutation checks (always promote, no points update, no takeover) all fail the suite.
- Frontend `game.test.jsx` (57): the table, every kind of question, countdown, summary, results, leave dialog, live updates, event wording.

## Not done yet (later phases)

Card-flip animations and a sound-free polish pass, contrast audit, cross-browser checks (Phase 8). Cards currently appear without an animation.
