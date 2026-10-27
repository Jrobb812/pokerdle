// Pokerdle: guess the hidden hole cards from a real WSOP hand.
(() => {
  "use strict";

  // ---------------------------------------------------------------------------
  // Config
  const EPOCH = Date.UTC(2026, 9, 14); // Puzzle #1 (months are 0-based: 9 = October)
  const STREETS = ["preflop", "flop", "turn", "river"];
  const STREET_NAMES = { preflop: "Preflop", flop: "Flop", turn: "Draw", river: "River" };
  const BOARD_COUNT = { preflop: 0, flop: 3, turn: 4, river: 5 };
  const RANKS = "23456789TJQKA";
  const RANK_LABEL = { T: "10" };
  const SUITS = { s: "♠", h: "♥", d: "♦", c: "♣" };
  const SUIT_ORDER = ["s", "h", "d", "c"];
  const STATE_KEY = "pokerdle-state-v1";
  const STATS_KEY = "pokerdle-stats-v1";
  const ARCHIVE_KEY = "pokerdle-archive-v1";
  const ARCHIVE_DAYS = 30; // how many past days the archive offers

  // ---------------------------------------------------------------------------
  // Helpers
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const rankOf = (code) => code[0];
  const suitOf = (code) => code[1];
  const rankValue = (code) => RANKS.indexOf(rankOf(code));
  const rankLabel = (code) => RANK_LABEL[rankOf(code)] || rankOf(code);
  const shortName = (name) => name.split(" ").slice(-1)[0];

  function formatChips(n) {
    if (n == null) return "";
    if (n >= 1e6) return +(n / 1e6).toFixed(2) + "M";
    if (n >= 1e3) return +(n / 1e3).toFixed(1) + "K";
    return String(n);
  }

  function actionText(act) {
    const amt = act.amt != null ? " " + formatChips(act.amt) : "";
    switch (act.a) {
      case "post": return "Posts" + amt;
      case "check": return "Check";
      case "call": return "Call" + amt;
      case "bet": return "Bet" + amt;
      case "raise": return "Raise to" + amt;
      case "allin": return "All-in" + amt;
      case "fold": return "Fold";
      default: return act.a;
    }
  }

  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }
  function save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable (private mode) - game still works */
    }
  }

  // ---------------------------------------------------------------------------
  // Puzzle selection
  function todayIndex() {
    const now = new Date();
    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.max(0, Math.round((today - EPOCH) / 86400000));
  }

  const params = new URLSearchParams(location.search);
  const practiceHand = params.has("hand") ? parseInt(params.get("hand"), 10) : null;
  const practice = practiceHand != null && !Number.isNaN(practiceHand);
  // ?day=N opens puzzle #N from the archive (one of the last ARCHIVE_DAYS days).
  // Archive hands never touch the streak.
  const todayDay = todayIndex();
  const requestedDay = params.has("day") ? parseInt(params.get("day"), 10) - 1 : null;
  const archive = !practice && requestedDay != null && requestedDay < todayDay && requestedDay >= Math.max(0, todayDay - ARCHIVE_DAYS);
  if (!practice && !archive && params.has("day")) history.replaceState(null, "", location.pathname);
  const dayIndex = archive ? requestedDay : todayDay;
  const puzzleNumber = dayIndex + 1;
  function dateLabel(day) {
    return new Date(EPOCH + day * 86400000).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  }
  const hand = practice
    ? window.HANDS[((practiceHand % window.HANDS.length) + window.HANDS.length) % window.HANDS.length]
    : window.HANDS[dayIndex % window.HANDS.length];
  const hidden = hand.players[hand.hidden].cards;

  // ---------------------------------------------------------------------------
  // Scoring
  //
  // Each of the two columns belongs to one hidden card for the whole game, so
  // every hint in a column always describes the same card.
  //
  // Feedback per card. The color describes the suit, the tag describes the rank.
  //   exact   - right card (green)
  //   partial - right suit, wrong rank (yellow)
  //   miss    - wrong suit (red)
  // note: "up" / "down" when the rank is wrong (is the real card higher or
  // lower, aces high), "rank" when the rank is right but the suit isn't.
  function judge(guess, actual) {
    if (guess === actual) return { kind: "exact", score: 3 };
    const sameSuit = suitOf(guess) === suitOf(actual);
    if (rankOf(guess) === rankOf(actual)) return { kind: "miss", score: 2, note: "rank" };
    const note = rankValue(actual) > rankValue(guess) ? "up" : "down";
    return sameSuit ? { kind: "partial", score: 1, note } : { kind: "miss", score: 0, note };
  }

  // guess[j] is the card typed into column j. Until a card has been found, the
  // two cards may be swapped into whichever columns give more information
  // (ties keep the player's order). Returns results indexed by column.
  function evaluate(guess, found) {
    const orders = found[0] || found[1] ? [[0, 1]] : [[0, 1], [1, 0]];
    let best = null;
    for (const order of orders) {
      const columns = [];
      guess.forEach((card, slot) => {
        const col = order[slot];
        columns[col] = { card, ...judge(card, hidden[col]) };
      });
      const total = columns[0].score + columns[1].score;
      if (!best || total > best.total) best = { total, columns };
    }
    return best.columns;
  }

  // Replays all guesses to rebuild feedback and which columns are solved.
  function replay(guesses) {
    const found = [false, false];
    const feedback = [];
    for (const g of guesses) {
      const row = evaluate(g, found);
      row.forEach((r, col) => {
        if (r.kind === "exact") found[col] = true;
      });
      feedback.push(row);
    }
    return { found, feedback };
  }

  // ---------------------------------------------------------------------------
  // State
  // Archive progress is kept per day. An unfinished daily hand from that day
  // carries over into the archive.
  const archiveStates = load(ARCHIVE_KEY, {});
  let state = null;
  if (archive) {
    state = archiveStates[dayIndex];
    const daily = load(STATE_KEY, null);
    if (!state && daily && daily.day === dayIndex && daily.status === "playing") state = daily;
  } else if (!practice) {
    state = load(STATE_KEY, null);
  }
  if (!state || state.day !== dayIndex || state.handId !== hand.id) {
    state = { day: dayIndex, handId: hand.id, guesses: [], status: "playing" };
  }
  let derived = replay(state.guesses);
  let draft = [null, null];

  // Latest street the player has reached, and the street being viewed on the table.
  function reachedIndex() {
    return state.status === "playing" ? Math.min(state.guesses.length, STREETS.length - 1) : STREETS.length - 1;
  }
  let viewIndex = reachedIndex();

  function persist() {
    if (practice) return;
    if (!archive) return save(STATE_KEY, state);
    archiveStates[dayIndex] = state;
    for (const d of Object.keys(archiveStates)) if (d < todayDay - ARCHIVE_DAYS) delete archiveStates[d];
    save(ARCHIVE_KEY, archiveStates);
  }

  // ---------------------------------------------------------------------------
  // Win percentages ("Show Percentages" switch)
  //
  // Each player still in the hand gets their chance to win from the viewed
  // board, with ties split, using everyone's real cards (the hidden player's
  // too, so the odds can hint at the answer; that's why the switch starts off
  // on every visit). Every card on the table is out of the deck, folded hands
  // included.
  const ITERATIONS = 20000;
  let showEquity = false;
  const equityCache = new Map();

  const cardIndex = (code) => RANKS.indexOf(rankOf(code)) * 4 + SUIT_ORDER.indexOf(suitOf(code));

  // Highest straight in a 13-bit rank mask (bit 12 = ace), or -1.
  function topStraight(mask) {
    const m = (mask << 1) | ((mask >> 12) & 1); // the ace also plays low
    for (let hi = 13; hi >= 4; hi--) if (((m >> (hi - 4)) & 31) === 31) return hi - 1;
    return -1;
  }

  function topBits(mask, n) {
    const out = [];
    for (let r = 12; r >= 0 && out.length < n; r--) if (mask & (1 << r)) out.push(r);
    return out;
  }

  // Hand category, then up to five ranks, packed into one comparable number.
  function packScore(cat, ranks) {
    let v = cat;
    for (let k = 0; k < 5; k++) v = v * 13 + (ranks[k] ?? 0);
    return v;
  }

  // Best 5-card hand out of 7 cards (card = rank * 4 + suit).
  const rankCount = new Int8Array(13);
  const suitCount = new Int8Array(4);
  const suitMask = new Int16Array(4);
  function score7(cards) {
    rankCount.fill(0);
    suitCount.fill(0);
    suitMask.fill(0);
    let rankMask = 0;
    for (const c of cards) {
      const r = c >> 2, su = c & 3;
      rankCount[r]++;
      suitCount[su]++;
      suitMask[su] |= 1 << r;
      rankMask |= 1 << r;
    }
    let flush = -1;
    for (let su = 0; su < 4; su++) if (suitCount[su] >= 5) flush = su;
    if (flush >= 0) {
      const sf = topStraight(suitMask[flush]);
      if (sf >= 0) return packScore(8, [sf]);
    }
    let quad = -1;
    const trips = [], pairs = [];
    for (let r = 12; r >= 0; r--) {
      if (rankCount[r] === 4) quad = r;
      else if (rankCount[r] === 3) trips.push(r);
      else if (rankCount[r] === 2) pairs.push(r);
    }
    if (quad >= 0) return packScore(7, [quad, ...topBits(rankMask & ~(1 << quad), 1)]);
    if (trips.length > 1 || (trips.length && pairs.length)) {
      return packScore(6, [trips[0], Math.max(trips[1] ?? -1, pairs[0] ?? -1)]);
    }
    if (flush >= 0) return packScore(5, topBits(suitMask[flush], 5));
    const st = topStraight(rankMask);
    if (st >= 0) return packScore(4, [st]);
    if (trips.length) return packScore(3, [trips[0], ...topBits(rankMask & ~(1 << trips[0]), 2)]);
    if (pairs.length >= 2) {
      return packScore(2, [pairs[0], pairs[1], ...topBits(rankMask & ~(1 << pairs[0]) & ~(1 << pairs[1]), 1)]);
    }
    if (pairs.length) return packScore(1, [pairs[0], ...topBits(rankMask & ~(1 << pairs[0]), 3)]);
    return packScore(0, topBits(rankMask, 5));
  }

  // Seeded random numbers, so the same board always shows the same odds.
  function seededRandom(seed) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // { playerIndex: chance to win (0-1) } for players who haven't folded.
  function equities(streetIndex, folded) {
    const key = streetIndex + "|" + [...folded].join();
    if (equityCache.has(key)) return equityCache.get(key);

    // Mucked cards ("??") are the only unknown hole cards.
    const known = (i, j) => hand.players[i].cards[j] !== "??";

    const board = hand.board.slice(0, BOARD_COUNT[STREETS[streetIndex]]).map(cardIndex);
    const dead = new Set(board);
    hand.players.forEach((p, i) => p.cards.forEach((code, j) => known(i, j) && dead.add(cardIndex(code))));
    const deck = [];
    for (let c = 0; c < 52; c++) if (!dead.has(c)) deck.push(c);

    const live = hand.players.map((_, i) => i).filter((i) => !folded.has(i));
    const holes = live.map((i) => hand.players[i].cards.map((code, j) => (known(i, j) ? cardIndex(code) : null)));
    const unknownHoles = holes.flat().filter((c) => c == null).length;
    const missingBoard = 5 - board.length;
    const sevens = holes.map(() => [...Array(2).fill(0), ...board, ...Array(missingBoard).fill(0)]);
    const wins = new Float64Array(live.length);
    let trials = 0;

    // runout = the unknown hole cards in order, then the rest of the board.
    function showdown(runout) {
      let k = 0;
      holes.forEach((h, p) => h.forEach((c, j) => (sevens[p][j] = c ?? runout[k++])));
      for (let b = 0; b < missingBoard; b++) for (const s7 of sevens) s7[2 + board.length + b] = runout[k + b];
      let best = -1, winners = [];
      sevens.forEach((s7, p) => {
        const v = score7(s7);
        if (v > best) (best = v), (winners = [p]);
        else if (v === best) winners.push(p);
      });
      for (const p of winners) wins[p] += 1 / winners.length;
      trials++;
    }

    if (unknownHoles === 0 && missingBoard <= 2) {
      // Few enough runouts to check every one.
      if (missingBoard === 0) showdown([]);
      else if (missingBoard === 1) deck.forEach((c) => showdown([c]));
      else for (let a = 0; a < deck.length; a++) for (let b = a + 1; b < deck.length; b++) showdown([deck[a], deck[b]]);
    } else {
      let seed = streetIndex + 1;
      for (const ch of hand.id) seed = (Math.imul(seed, 31) + ch.charCodeAt(0)) | 0;
      const rand = seededRandom(seed);
      const need = unknownHoles + missingBoard;
      const pool = deck.slice();
      for (let t = 0; t < ITERATIONS; t++) {
        // Partial shuffle: the first `need` cards of the pool are a random draw.
        for (let k = 0; k < need; k++) {
          const r = k + Math.floor(rand() * (pool.length - k));
          [pool[k], pool[r]] = [pool[r], pool[k]];
        }
        showdown(pool);
      }
    }

    const result = {};
    live.forEach((i, p) => (result[i] = wins[p] / trials));
    equityCache.set(key, result);
    return result;
  }

  function equityText(x) {
    if (x > 0 && x < 0.005) return "<1%";
    if (x < 1 && x > 0.995) return ">99%";
    return Math.round(x * 100) + "%";
  }

  // ---------------------------------------------------------------------------
  // Rendering: cards
  function cardEl(code, extra) {
    const c = el("div", "card suit-" + suitOf(code) + (extra ? " " + extra : ""));
    c.append(el("span", "r", rankLabel(code)), el("span", "s", SUITS[suitOf(code)]));
    return c;
  }
  function backEl(extra) {
    const c = el("div", "card back" + (extra ? " " + extra : ""));
    c.append(el("span", "q", "?"));
    return c;
  }

  // ---------------------------------------------------------------------------
  // Rendering: header info
  function renderInfo() {
    const info = $("handInfo");
    info.innerHTML = "";
    info.append(
      el("div", "num", practice ? "Practice hand" : archive ? "Archive • #" + puzzleNumber + " • " + dateLabel(dayIndex) : "#" + puzzleNumber),
      el("div", "event", hand.event),
      el("div", "sub", [hand.stage, hand.blinds].filter(Boolean).join(" • "))
    );
  }

  // ---------------------------------------------------------------------------
  // Rendering: table (shows the street selected with the arrows)
  // Seats around the table in order. When the button folded preflop, an empty
  // seat holding the dealer chip is inserted so the button is always visible.
  const seatOrder = hand.players.map((_, i) => i);
  if (hand.dealer == null && hand.buttonSeat != null) seatOrder.splice(hand.buttonSeat, 0, "button");

  // Phones are too narrow for seats beside the board, so there the other
  // players sit in one row along the top rail, in clockwise order. These
  // seats are placed by the top of their cards (see .table.rows in the CSS)
  // so a row lines up even when only some seats have an action tag.
  const narrow = matchMedia("(max-width: 560px)");
  const TOP_ROW = { 1: [50], 2: [27, 73], 3: [17, 50, 83] };

  function seatPosition(seatIndex) {
    // Hidden player sits at the bottom; others continue clockwise.
    const n = seatOrder.length;
    const hiddenSeat = seatOrder.indexOf(hand.hidden);
    const step = (seatIndex - hiddenSeat + n) % n;
    if (narrow.matches && TOP_ROW[n - 1]) {
      return step === 0 ? { x: 50, y: 71 } : { x: TOP_ROW[n - 1][step - 1], y: -12 };
    }
    const angle = Math.PI / 2 + (step * 2 * Math.PI) / n;
    return { x: 50 + 44 * Math.cos(angle), y: 50 + 40 * Math.sin(angle) };
  }

  function renderButtonSeat(table) {
    const s = seatOrder.indexOf("button");
    if (s < 0) return;
    const pos = seatPosition(s);
    const seat = el("div", "seat empty-seat");
    seat.style.left = pos.x + "%";
    seat.style.top = pos.y + "%";
    const plate = el("div", "plate");
    plate.append(el("div", "name", "Button"), el("div", "pos", "folded"));
    seat.append(plate, el("div", "dealer-chip", "D"));
    table.append(seat);
  }

  function renderTable() {
    const table = $("table");
    table.querySelectorAll(".seat").forEach((n) => n.remove());
    table.classList.toggle("crowded", seatOrder.length > 2);
    table.classList.toggle("rows", narrow.matches && seatOrder.length <= 4);
    const done = state.status !== "playing";
    const street = STREETS[viewIndex];

    // Players who folded on or before the viewed street
    const folded = new Set();
    for (const s of STREETS.slice(0, viewIndex + 1)) {
      for (const act of hand.streets[s] || []) if (act.a === "fold") folded.add(act.p);
    }

    hand.players.forEach((player, i) => {
      const pos = seatPosition(seatOrder.indexOf(i));
      const seat = el("div", "seat" + (i === hand.hidden ? " hidden-seat" : "") + (folded.has(i) ? " folded" : ""));
      seat.style.left = pos.x + "%";
      seat.style.top = pos.y + "%";

      const cards = el("div", "seat-cards");
      player.cards.forEach((code, j) => {
        if (code === "??") {
          cards.append(backEl("mucked"));
        } else if (i !== hand.hidden || done || derived.found[j]) {
          cards.append(cardEl(code, i === hand.hidden ? "revealed" : ""));
        } else {
          cards.append(backEl());
        }
      });
      const plate = el("div", "plate");
      plate.dataset.player = i;
      const name = el("div", "name");
      name.title = player.name;
      name.append(el("span", "full-name", player.name), el("span", "short-name", shortName(player.name)));
      plate.append(name, el("div", "pos", player.position));
      seat.append(cards, plate);
      if (i === hand.dealer) seat.append(el("div", "dealer-chip", "D"));

      // This player's last action on the viewed street
      const acts = (hand.streets[street] || []).filter((a) => a.p === i);
      if (acts.length) {
        const last = acts[acts.length - 1];
        seat.append(el("div", "bet bet-" + last.a, actionText(last)));
      }
      table.append(seat);
    });

    renderButtonSeat(table);
    if (showEquity) renderEquity(table);

    const board = $("board");
    board.innerHTML = "";
    const count = BOARD_COUNT[street];
    for (let k = 0; k < 5; k++) {
      board.append(k < count ? cardEl(hand.board[k], "board-card") : el("div", "card slot"));
    }

    $("streetLabel").textContent = STREET_NAMES[street];
    $("prevStreet").disabled = viewIndex === 0;
    $("nextStreet").disabled = viewIndex >= reachedIndex();
    $("table").classList.toggle("viewing-past", viewIndex < reachedIndex());
  }

  function renderEquity(table) {
    if (STREETS[viewIndex] === "river") return; // the winner is already decided
    // A player who folds on the viewed street still gets odds for it (what
    // they gave up); only folds on earlier streets drop out.
    const out = new Set();
    for (const s of STREETS.slice(0, viewIndex)) {
      for (const act of hand.streets[s] || []) if (act.a === "fold") out.add(act.p);
    }
    const odds = equities(viewIndex, out);
    if (Object.keys(odds).length < 2) return; // everyone else folded
    for (const [i, x] of Object.entries(odds)) {
      const badge = el("div", "equity", equityText(x));
      table.querySelector('.plate[data-player="' + i + '"] .pos').append(badge);
    }
  }

  // One line under the table: the betting sequence on the viewed street.
  function renderStreetActions() {
    const box = $("streetActions");
    box.innerHTML = "";
    const street = STREETS[viewIndex];
    const acts = hand.streets[street] || [];
    box.append(el("span", "sa-label", STREET_NAMES[street] + ":"));
    if (!acts.length) {
      box.append(el("span", "sa-none", street === "preflop" ? "No action" : "No betting, players are all-in"));
      return;
    }
    acts.forEach((act, k) => {
      if (k > 0) box.append(el("span", "sa-sep", "›"));
      const item = el("span", "sa-item" + (act.p === hand.hidden ? " is-hidden" : ""));
      item.append(el("b", null, shortName(hand.players[act.p].name)), " ", el("span", "act-" + act.a, actionText(act)));
      box.append(item);
    });
  }

  function setView(index) {
    viewIndex = Math.max(0, Math.min(reachedIndex(), index));
    renderTable();
    renderStreetActions();
  }

  // ---------------------------------------------------------------------------
  // Rendering: guesses
  function noteTag(r) {
    // Tag color follows the rank only: green when it's right, neutral blue otherwise.
    const tag = el("div", "note-tag " + (r.note === "rank" ? "rank-right" : "rank-hint"));
    if (r.note === "rank") {
      tag.append(el("span", "note-icon", "✓"), el("span", "note-text", "Right rank"));
    } else {
      const up = r.note === "up";
      tag.append(el("span", "note-icon", up ? "▲" : "▼"), el("span", "note-text", up ? "Higher" : "Lower"));
    }
    return tag;
  }

  function feedbackCell(r) {
    const cell = el("div", "fb-cell");
    const card = cardEl(r.card, "fb " + r.kind);
    card.title = {
      exact: "Correct card",
      partial: "Right suit, wrong rank",
      miss: r.note === "rank" ? "Right rank, wrong suit" : "Wrong suit and wrong rank",
    }[r.kind];
    cell.append(card);
    if (r.kind !== "exact") cell.append(noteTag(r));
    return cell;
  }

  function renderGuesses() {
    const box = $("guesses");
    box.innerHTML = "";
    STREETS.forEach((s, i) => {
      const row = el("div", "guess-row" + (i === state.guesses.length && state.status === "playing" ? " active" : ""));
      row.append(el("span", "row-label", STREET_NAMES[s]));
      const cols = el("div", "row-cols");
      const fb = derived.feedback[i];
      [0, 1].forEach((col) => {
        const cell = el("div", "col");
        if (fb) cell.append(feedbackCell(fb[col]));
        else cell.append(el("div", "card slot small"));
        cols.append(cell);
      });
      row.append(cols);
      box.append(row);
    });
  }

  // ---------------------------------------------------------------------------
  // Rendering: input
  function knownCards() {
    // Cards the player can see, which can't be the hidden ones.
    const known = new Set();
    hand.players.forEach((p, i) => {
      if (i !== hand.hidden) p.cards.forEach((c) => c !== "??" && known.add(c));
    });
    hand.board.slice(0, BOARD_COUNT[STREETS[reachedIndex()]]).forEach((c) => known.add(c));
    return known;
  }

  function foundCard(col) {
    return derived.found[col] ? hidden[col] : null;
  }

  function renderInput() {
    const area = $("inputArea");
    if (state.status !== "playing") {
      area.hidden = true;
      return;
    }
    area.hidden = false;
    $("guessPrompt").textContent = STREET_NAMES[STREETS[reachedIndex()]] + " guess (" + (state.guesses.length + 1) + " of 4)";

    const slots = $("slots");
    slots.innerHTML = "";
    [0, 1].forEach((col) => {
      const locked = foundCard(col);
      let node;
      if (locked) {
        node = cardEl(locked, "fb exact locked");
        node.title = "Found";
      } else if (draft[col]) {
        node = cardEl(draft[col], "draft");
        node.title = "Click to clear";
        node.addEventListener("click", () => {
          draft[col] = null;
          renderInput();
        });
      } else {
        node = el("div", "card slot pick-me");
        node.append(el("span", "q", "?"));
      }
      slots.append(node);
    });

    $("submitBtn").disabled = ![0, 1].every((col) => foundCard(col) || draft[col]);

    const picker = $("picker");
    picker.innerHTML = "";
    const known = knownCards();
    const tried = new Set(state.guesses.flat());
    const inUse = new Set([draft[0], draft[1], foundCard(0), foundCard(1)].filter(Boolean));
    for (const s of SUIT_ORDER) {
      const row = el("div", "picker-row");
      for (const r of RANKS.split("").reverse()) {
        const code = r + s;
        const b = el("button", "pick suit-" + s);
        b.type = "button";
        b.dataset.card = code;
        b.append(el("span", "r", rankLabel(code)), el("span", "s", SUITS[s]));
        if (known.has(code)) {
          b.disabled = true;
          b.classList.add("known");
          b.title = "Visible on the table";
        } else if (inUse.has(code)) {
          b.disabled = true;
          b.classList.add("selected");
        } else if (tried.has(code)) {
          b.classList.add("tried");
          b.title = "Already guessed";
        }
        b.addEventListener("click", () => pick(code));
        row.append(b);
      }
      picker.append(row);
    }
  }

  function pick(code) {
    const open = [0, 1].filter((col) => !foundCard(col));
    const empty = open.find((col) => !draft[col]);
    if (empty != null) draft[empty] = code;
    else if (open.length) draft[open[open.length - 1]] = code;
    renderInput();
  }

  // ---------------------------------------------------------------------------
  // Submitting
  function submit() {
    if (state.status !== "playing") return;
    const guess = [0, 1].map((col) => foundCard(col) || draft[col]);
    if (guess.some((c) => !c) || guess[0] === guess[1]) return;

    state.guesses.push(guess);
    derived = replay(state.guesses);
    draft = [null, null];

    if (derived.found[0] && derived.found[1]) state.status = "won";
    else if (state.guesses.length >= STREETS.length) state.status = "lost";

    if (state.status !== "playing") recordResult();
    persist();
    viewIndex = reachedIndex();
    renderAll();
    if (state.status === "won") toast(["Unbelievable read!", "Soul read!", "Great read!", "Got there on the river!"][state.guesses.length - 1]);
    if (state.status !== "playing" && !practice) setTimeout(() => openModal("statsModal"), 1600);
  }

  // ---------------------------------------------------------------------------
  // Results, sharing and stats
  // A day counts toward the stats once, whether it was played on the day or
  // later from the archive. Only the daily hand affects the streak.
  function recordResult() {
    if (practice) return;
    const stats = loadStats();
    if (stats.days[dayIndex] != null) return;
    stats.played += 1;
    if (state.status === "won") {
      stats.won += 1;
      stats.dist[state.guesses.length - 1] += 1;
    }
    stats.days[dayIndex] = state.status === "won" ? state.guesses.length : 0;
    state.counted = true;
    if (archive) {
      save(STATS_KEY, stats);
      return;
    }
    if (state.status === "won" && !state.easy) {
      stats.streak = stats.lastWinDay === dayIndex - 1 ? stats.streak + 1 : 1;
      stats.maxStreak = Math.max(stats.maxStreak, stats.streak);
      stats.lastWinDay = dayIndex;
    } else {
      // A loss, or a hand played with Easy Mode, resets the streak.
      stats.streak = 0;
    }
    stats.lastDay = dayIndex;
    save(STATS_KEY, stats);
  }

  // days: day index -> guesses used to win, 0 for a loss, -1 for a day played
  // before results were kept per day.
  const EMPTY_STATS = { played: 0, won: 0, streak: 0, maxStreak: 0, dist: [0, 0, 0, 0], lastDay: null, lastWinDay: null, days: null };

  function loadStats() {
    const stats = { ...EMPTY_STATS, ...load(STATS_KEY, {}) };
    if (!stats.days) {
      // Older saves only remember the last day played and the current streak.
      stats.days = {};
      if (stats.lastWinDay != null) for (let d = stats.lastWinDay - stats.streak + 1; d <= stats.lastWinDay; d++) stats.days[d] = -1;
      if (stats.lastDay != null && stats.days[stats.lastDay] == null) stats.days[stats.lastDay] = -1;
    }
    return stats;
  }

  // The saved streak only counts if the last win was today or yesterday.
  function currentStreak(stats) {
    return stats.lastWinDay != null && stats.lastWinDay >= todayDay - 1 ? stats.streak : 0;
  }

  const SITE_URL = "pokerdle.net";
  // Green = right card, yellow = right suit or right rank, red = neither.
  const SHARE_ICON = { exact: "🟩", close: "🟨", miss: "🟥" };
  const SHARE_ICON_CB = { exact: "🟧", close: "🟦", miss: "⬛" };
  function shareIcon(r) {
    const icons = colorblind ? SHARE_ICON_CB : SHARE_ICON;
    if (r.kind === "exact") return icons.exact;
    return r.kind === "partial" || r.note === "rank" ? icons.close : icons.miss;
  }
  function shareText() {
    const score = state.status === "won" ? state.guesses.length + "/4" : "X/4";
    const rows = derived.feedback.map((row) => row.map(shareIcon).join(""));
    const title = "Pokerdle " + (practice ? "practice" : "#" + puzzleNumber + (archive ? " (archive)" : "")) + " " + score + (state.easy ? " (Easy Mode)" : "");
    return [title, ...rows, SITE_URL].join("\n");
  }

  async function share() {
    const text = shareText();
    // On phones, open the native share sheet (Messages, Messenger, etc.).
    if (navigator.share && matchMedia("(pointer: coarse)").matches) {
      try {
        await navigator.share({ text });
        return;
      } catch (err) {
        if (err.name === "AbortError") return; // closed the share sheet
      }
    }
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      document.body.append(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    toast("Copied results to clipboard");
  }

  function renderResult() {
    const box = $("result");
    if (state.status === "playing") {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    box.innerHTML = "";
    const won = state.status === "won";
    box.append(el("h2", won ? "win" : "lose", won ? "You read them!" : "Not this time"));
    if (archive) {
      const counted = state.counted ? "It was added to your stats." : "You'd already played this day, so your stats didn't change.";
      box.append(el("div", "streak-line easy", "Archive hands don't count toward your streak. " + counted));
    } else if (!practice) {
      const streak = currentStreak(loadStats());
      if (state.easy) {
        box.append(el("div", "streak-line easy", "Played with Easy Mode, so this hand doesn't count toward your streak."));
      } else {
        box.append(el("div", "streak-line", streak > 0 ? "🔥 " + streak + "-day streak" : "Streak reset. Start a new one tomorrow."));
      }
    }

    const reveal = el("div", "reveal");
    reveal.append(el("span", "reveal-label", hand.players[hand.hidden].name + " held"));
    const cards = el("div", "reveal-cards");
    hidden.forEach((c) => cards.append(cardEl(c)));
    reveal.append(cards);
    box.append(reveal);
    if (hand.story) box.append(el("p", "story", hand.story));

    const sources = hand.sources || [];
    if (sources.length) {
      const src = el("p", "sources");
      src.append("Source" + (sources.length > 1 ? "s" : "") + ": ");
      sources.forEach((url, i) => {
        const a = el("a", null, new URL(url).hostname.replace(/^www\./, ""));
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener";
        src.append(a);
        if (i < sources.length - 1) src.append(", ");
      });
      box.append(src);
    }

    const actions = el("div", "result-actions");
    const shareBtn = el("button", "submit", "Share");
    shareBtn.addEventListener("click", share);
    actions.append(shareBtn);
    if (archive) {
      const more = el("button", "ghost-btn", "More from the archive");
      more.addEventListener("click", () => openModal("archiveModal"));
      const today = el("a", "ghost-btn", "Today's hand");
      today.href = "./";
      actions.append(more, today);
    } else if (!practice) {
      const next = el("div", "countdown");
      actions.append(next);
      const tick = () => {
        const now = new Date();
        const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        const s = Math.max(0, Math.floor((midnight - now) / 1000));
        next.textContent = "Next hand in " + [s / 3600, (s % 3600) / 60, s % 60].map((v) => String(Math.floor(v)).padStart(2, "0")).join(":");
      };
      tick();
      clearInterval(renderResult.timer);
      renderResult.timer = setInterval(tick, 1000);
    }
    box.append(actions);
  }

  function renderStats() {
    const stats = loadStats();
    const body = $("statsBody");
    body.innerHTML = "";
    const grid = el("div", "stat-grid");
    [
      [stats.played, "Played"],
      [stats.played ? Math.round((stats.won / stats.played) * 100) : 0, "Win %"],
      [currentStreak(stats), "Streak"],
      [stats.maxStreak, "Best"],
    ].forEach(([v, l]) => {
      const s = el("div", "stat");
      s.append(el("div", "v", String(v)), el("div", "l", l));
      grid.append(s);
    });
    body.append(grid, el("h3", null, "Solved on"));
    const max = Math.max(1, ...stats.dist);
    stats.dist.forEach((n, i) => {
      const row = el("div", "dist-row");
      const today = !practice && state.status === "won" && state.guesses.length - 1 === i;
      const bar = el("div", "dist-bar" + (today ? " today" : ""), String(n));
      bar.style.width = Math.max(8, (n / max) * 100) + "%";
      const track = el("div", "dist-track");
      track.append(bar);
      row.append(el("span", "dist-label", STREET_NAMES[STREETS[i]]), track);
      body.append(row);
    });
    if (!stats.played) body.append(el("p", "fine", "Play today's hand to start your streak. Stats are saved in this browser."));
    if (state.status !== "playing") {
      const shareBtn = el("button", "submit stats-share", "Share");
      shareBtn.addEventListener("click", share);
      body.append(shareBtn);
    }
  }

  // Today plus the last ARCHIVE_DAYS days, newest first, with how each one went.
  function renderArchive() {
    const body = $("archiveBody");
    body.innerHTML = "";
    const stats = loadStats();
    const states = load(ARCHIVE_KEY, {});
    const daily = load(STATE_KEY, null);
    const list = el("div", "archive-list");
    const row = (href, num, date, status, cls, current) => {
      const a = el("a", "archive-row" + (current ? " current" : ""));
      a.href = href;
      a.append(el("span", "archive-num", num), el("span", "archive-date", date), el("span", "archive-status " + cls, status));
      list.append(a);
    };
    const describe = (r, s) => {
      if (r > 0) return ["Solved " + r + "/4", "won"];
      if (r === 0) return ["Missed", "lost"];
      if (r === -1) return ["Played", "done"];
      if (s && s.guesses.length) return ["In progress", "progress"];
      return ["Not played", "new"];
    };
    const [todayStatus, todayCls] = describe(stats.days[todayDay], daily && daily.day === todayDay ? daily : null);
    row("./", "#" + (todayDay + 1), "Today", todayStatus, todayCls, !archive && !practice);
    for (let d = todayDay - 1; d >= Math.max(0, todayDay - ARCHIVE_DAYS); d--) {
      const [status, cls] = describe(stats.days[d], states[d] || (daily && daily.day === d ? daily : null));
      row("?day=" + (d + 1), "#" + (d + 1), dateLabel(d), status, cls, archive && d === dayIndex);
    }
    body.append(el("p", "fine", "Play any hand from the last " + ARCHIVE_DAYS + " days. Archive hands never count toward your streak, but a day you missed is added to your stats the first time you finish it."), list);
    if (todayDay === 0) body.append(el("p", "fine", "Past hands show up here starting tomorrow."));
  }

  // ---------------------------------------------------------------------------
  // UI plumbing
  let toastTimer;
  function toast(text) {
    const t = $("toast");
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 2200);
  }

  function openModal(id) {
    document.querySelectorAll(".modal").forEach((m) => (m.hidden = true));
    if (id === "statsModal") renderStats();
    if (id === "archiveModal") renderArchive();
    $(id).hidden = false;
  }
  document.querySelectorAll(".modal").forEach((m) => {
    m.addEventListener("click", (e) => {
      if (e.target === m || e.target.hasAttribute("data-close")) m.hidden = true;
    });
  });
  // Colorblind mode swaps green / yellow / red for orange / blue / gray
  // (see html.colorblind in the CSS). Remembered in this browser.
  const COLORBLIND_KEY = "pokerdle-colorblind";
  let colorblind = load(COLORBLIND_KEY, false);
  function applyColorblind() {
    document.documentElement.classList.toggle("colorblind", colorblind);
  }
  applyColorblind();

  $("helpBtn").addEventListener("click", () => openModal("helpModal"));
  $("statsBtn").addEventListener("click", () => openModal("statsModal"));
  $("archiveBtn").addEventListener("click", () => openModal("archiveModal"));
  $("submitBtn").addEventListener("click", submit);
  // Easy Mode (win percentages). Turning it on during an unfinished daily
  // hand marks the hand as Easy Mode, so it asks first.
  function setEasy(on) {
    showEquity = on;
    $("equityToggle").checked = on;
    if (on && state.status === "playing" && !state.easy) {
      state.easy = true;
      persist();
    }
    renderTable();
  }
  $("equityToggle").checked = false;
  $("equityToggle").addEventListener("change", (e) => {
    const needsWarning = e.target.checked && !practice && !archive && state.status === "playing" && !state.easy;
    if (needsWarning) {
      e.target.checked = false;
      openModal("easyModal");
      return;
    }
    setEasy(e.target.checked);
  });
  $("easyConfirm").addEventListener("click", () => {
    $("easyModal").hidden = true;
    setEasy(true);
  });

  // "?" tooltip: hover on desktop, tap to open/close on touch screens
  const easyTip = $("easyInfo");
  $("easyInfoBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    const open = !easyTip.classList.contains("open");
    easyTip.classList.toggle("open", open);
    $("easyInfoBtn").setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("click", () => {
    easyTip.classList.remove("open");
    $("easyInfoBtn").setAttribute("aria-expanded", "false");
  });
  $("colorblindToggle").checked = colorblind;
  $("colorblindToggle").addEventListener("change", (e) => {
    colorblind = e.target.checked;
    save(COLORBLIND_KEY, colorblind);
    applyColorblind();
  });
  narrow.addEventListener("change", renderTable);
  $("prevStreet").addEventListener("click", () => setView(viewIndex - 1));
  $("nextStreet").addEventListener("click", () => setView(viewIndex + 1));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") document.querySelectorAll(".modal").forEach((m) => (m.hidden = true));
    if (e.key === "Enter" && !$("submitBtn").disabled) submit();
    if (e.key === "ArrowLeft") setView(viewIndex - 1);
    if (e.key === "ArrowRight") setView(viewIndex + 1);
  });

  function renderAll() {
    renderInfo();
    renderTable();
    renderStreetActions();
    renderGuesses();
    renderInput();
    renderResult();
  }

  renderAll();
  if (!practice && state.guesses.length === 0 && !load("pokerdle-seen-help", false)) {
    openModal("helpModal");
    save("pokerdle-seen-help", true);
  }
})();
