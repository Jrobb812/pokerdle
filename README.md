# Pokerdle

A daily browser game. Each day shows a real hand from the World Series of Poker. Every player's hole cards are face up except one, and you guess that player's two cards. You get one guess per street (preflop, flop, draw and river), and each new street adds its board cards and betting.

The game currently has 307 real hands, about 10 months of daily puzzles.

## Run it

Open `index.html` in a browser. There's no server or build step.

To play a specific hand, add `?hand=N` to the address, for example `index.html?hand=2`. These practice hands don't affect your stats.

## Host it

The site is plain static files: `index.html`, `styles.css` and the `js/` folder. Any static host works:

- **GitHub Pages:** push the folder to a repository, then go to Settings → Pages → "Deploy from branch".
- **Netlify or Cloudflare Pages:** drag and drop the folder.

The `tools/` folder is only needed for adding hands. It stays on your computer and is not in this repository.

Before launch, set `EPOCH` in `js/game.js` to your launch date. That date is puzzle #1.

## How guesses are scored

| Card | Meaning |
|---|---|
| Filled green | Exact card. It locks in for the rest of the game and flips face up on the table. |
| Yellow outline | Right suit, wrong rank. |
| Red outline | Wrong suit. |

The color describes the suit, and the tag beside each yellow or red card describes the rank:
- **▲ Higher:** the real card ranks higher, with aces high.
- **▼ Lower:** the real card ranks lower.
- **✓ Right rank:** the rank is right. This only appears on red cards, because a right rank with a right suit would be green.

Each of the two columns always tracks the same hidden card. Until a card is found, the game may swap your two guessed cards into whichever columns give the most feedback. After that, every hint in a column describes the same card. Cards visible on the table are greyed out in the picker, because they can't be the hidden cards.

The ◀ ▶ arrows on the table, or your keyboard's arrow keys, step back through earlier streets. One line under the table shows that street's betting.

## Where the hands come from

Hands are transcribed from PokerNews live reporting of the WSOP Main Event final days (2022 to 2025), plus a few classic hands. Since about 2021, the final tables have been reported hand by hand with every player's hole cards from the broadcast.

The card facts come from the source. Each story is written in our own words, and every hand links back to its source on the results screen.

## Adding hands

`js/hands.js` is generated, so don't edit it by hand. The steps:

1. **Collect posts.** This downloads an event's live-reporting pages, waiting 1.5 seconds between requests:
   ```
   python tools/pn_scrape.py tools/.cache/posts.jsonl https://www.pokernews.com/tours/wsop/2025-wsop/event-81-10000-wsop-main-event/day9/
   ```
2. **Find candidates.** This finds hands that reach the river and show at least 9 cards:
   ```
   python tools/pn_candidates.py tools/.cache/posts.jsonl --json tools/.cache/candidates.json
   python tools/show.py 0 30
   ```
3. **Transcribe.** Write each hand into a file in `tools/hands/`. The format is documented at the top of `tools/build_hands.py`. Here's an example:
   ```
   == 2025me-final-hand
   src: pn 769933 79
   P John Wasnock | BTN / SB | As 9d
   P* Michael Mizrachi | BB | Tc 3c        (* = the hidden player)
   board: Ad 9c 7c 4c 5c
   pre: 0 r 5M, 1 c
   flop: 1 x, 0 x
   turn: 1 x, 0 b 10M, 1 r 30M, 0 a 70.5M, 1 c
   river: -
   story: A sentence or two, in your own words.
   ```
   Action codes: `x` check, `c` call, `b` bet, `r` raise to, `a` all-in, `f` fold. A player who folded without showing their cards can use `?? ??`.
4. **Build.** Run `python tools/build_hands.py`. It refuses to write `hands.js` if any hand fails a check:
   - every card appears in the source text
   - no card is used twice
   - each hand has 5 board cards and 2 cards per player
   - exactly one player is hidden
   - the betting is legal (nobody calls their own bet or checks facing a bet)
   - the blinds act first after the flop

The event, stage and blinds fill in automatically from the source.

**Puzzle order:** hands with IDs starting `classic-` come first, and the rest follow in a fixed shuffled order. Adding hands before launch is fine. After launch, adding a hand can change which puzzle falls on which future day. Past days stay correct for players who already played them, because progress is saved by date.

## Files

- `index.html`: page structure, the how-to-play popup and the stats popup.
- `styles.css`: all styling, including the four-color deck and the phone layout.
- `js/game.js`: game logic, scoring, saving progress and stats, and sharing.
- `js/hands.js`: the generated hand database.
- `tools/` (kept locally, not in this repository): the scripts for collecting, transcribing and validating hands.
