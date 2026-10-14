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
  const dayIndex = todayIndex();
  const puzzleNumber = dayIndex + 1;
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
  let state = practice ? null : load(STATE_KEY, null);
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
    if (!practice) save(STATE_KEY, state);
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
      el("div", "num", practice ? "Practice hand" : "#" + puzzleNumber),
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

  function seatPosition(seatIndex) {
    // Hidden player sits at the bottom; others continue clockwise.
    const n = seatOrder.length;
    const hiddenSeat = seatOrder.indexOf(hand.hidden);
    const angle = Math.PI / 2 + ((seatIndex - hiddenSeat) * 2 * Math.PI) / n;
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
      plate.append(el("div", "name", player.name), el("div", "pos", player.position));
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
  function recordResult() {
    if (practice) return;
    const stats = loadStats();
    if (stats.lastDay === dayIndex) return;
    stats.played += 1;
    if (state.status === "won") {
      stats.won += 1;
      stats.streak = stats.lastWinDay === dayIndex - 1 ? stats.streak + 1 : 1;
      stats.maxStreak = Math.max(stats.maxStreak, stats.streak);
      stats.dist[state.guesses.length - 1] += 1;
      stats.lastWinDay = dayIndex;
    } else {
      stats.streak = 0;
    }
    stats.lastDay = dayIndex;
    save(STATS_KEY, stats);
  }

  const EMPTY_STATS = { played: 0, won: 0, streak: 0, maxStreak: 0, dist: [0, 0, 0, 0], lastDay: null, lastWinDay: null };

  function loadStats() {
    return { ...EMPTY_STATS, ...load(STATS_KEY, {}) };
  }

  // The saved streak only counts if the last win was today or yesterday.
  function currentStreak(stats) {
    return stats.lastWinDay != null && stats.lastWinDay >= dayIndex - 1 ? stats.streak : 0;
  }

  const SITE_URL = "pokerdle.net";
  const SHARE_ICON = { exact: "🟩", partial: "🟨", miss: "🟥" };
  function shareText() {
    const score = state.status === "won" ? state.guesses.length + "/4" : "X/4";
    const rows = derived.feedback.map((row) => row.map((r) => SHARE_ICON[r.kind]).join(""));
    return ["Pokerdle " + (practice ? "practice" : "#" + puzzleNumber) + " " + score, ...rows, SITE_URL].join("\n");
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
    if (!practice) {
      const streak = currentStreak(loadStats());
      box.append(el("div", "streak-line", streak > 0 ? "🔥 " + streak + "-day streak" : "Streak reset. Start a new one tomorrow."));
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
    if (!practice) {
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
    $(id).hidden = false;
  }
  document.querySelectorAll(".modal").forEach((m) => {
    m.addEventListener("click", (e) => {
      if (e.target === m || e.target.hasAttribute("data-close")) m.hidden = true;
    });
  });
  $("helpBtn").addEventListener("click", () => openModal("helpModal"));
  $("statsBtn").addEventListener("click", () => openModal("statsModal"));
  $("submitBtn").addEventListener("click", submit);
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
