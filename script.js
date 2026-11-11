/* ==========================================================================
   MailCraft AI - frontend logic
   1 Helpers   2 State + storage   3 Toasts + dialog   4 Navigation (router, sidebar)
   5 Writer    6 Dashboard         7 History            8 Settings   9 Startup
   ========================================================================== */
(() => {
  "use strict";

  /* ------------------------------------------------------------------------
     1. Helpers
     ------------------------------------------------------------------------ */
  const SVG_NS = "http://www.w3.org/2000/svg";
  const $ = (id) => document.getElementById(id);
  const list = (v) => (Array.isArray(v) ? v : []);

  /** Build a DOM element. Text is always inserted as text, never as HTML (prevents XSS). */
  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value === null || value === undefined || value === false) continue;
      if (key === "class") el.className = value;
      else if (key === "text") el.textContent = value;
      else if (key === "style" && typeof value === "object") Object.assign(el.style, value);
      else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2), value);
      else el.setAttribute(key, value === true ? "" : value);
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      el.append(child.nodeType ? child : document.createTextNode(String(child)));
    }
    return el;
  }

  /** An <svg> pointing at a symbol in the sprite inside index.html. */
  function icon(name) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "ico");
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS(SVG_NS, "use");
    use.setAttribute("href", `#i-${name}`);
    svg.appendChild(use);
    return svg;
  }

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const wordCount = (t) => (t.trim() ? t.trim().split(/\s+/).length : 0);

  function timeAgo(ts) {
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return "Just now";
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
    return new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  }

  /* ------------------------------------------------------------------------
     2. State + storage (localStorage can be blocked, so every call is guarded)
     ------------------------------------------------------------------------ */
  const KEYS = { settings: "mailcraft.settings.v1", history: "mailcraft.history.v1", collapsed: "mailcraft.collapsed" };
  const HISTORY_LIMIT = 30;

  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }
  function save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {
      /* storage full or blocked: the app keeps working for this visit */
    }
  }

  const state = {
    config: null,
    keyMissing: false,
    busy: false,
    mode: "compose",
    tone: "professional",
    length: "medium",
    settings: { name: "", role: "", tone: "", language: "", length: "", model: "" },
    history: [],
    current: null, // the result currently shown in the writer
    lastRequest: null, // the payload used for it (for Regenerate)
  };

  const modeOf = (id) => state.config.modes.find((m) => m.id === id) || state.config.modes[0];
  const toneLabel = (id) => (state.config.tones.find((t) => t.id === id) || {}).label || id;
  const lengthLabel = (id) => (state.config.lengths.find((l) => l.id === id) || {}).label || id;

  /* ------------------------------------------------------------------------
     3. Toasts + confirm dialog
     ------------------------------------------------------------------------ */
  function toast(type, title, text) {
    const region = $("toastRegion");
    const iconName = type === "success" ? "check-circle" : type === "error" ? "x-circle" : "info";
    const el = h("div", { class: `toast toast-${type}`, role: type === "error" ? "alert" : "status" });
    const close = h("button", { class: "toast-close", type: "button", "aria-label": "Dismiss" }, icon("x"));
    el.append(icon(iconName), h("div", { class: "toast-text" }, h("strong", { text: title }), text && h("span", { text })), close);

    const remove = () => {
      el.classList.add("is-leaving");
      setTimeout(() => el.remove(), 250);
    };
    close.addEventListener("click", remove);
    region.append(el);
    while (region.children.length > 4) region.firstElementChild.remove();
    setTimeout(remove, type === "error" ? 6000 : 3200);
  }

  function confirmDialog(title, message, okLabel) {
    const dlg = $("confirmDialog");
    if (typeof dlg.showModal !== "function") return Promise.resolve(window.confirm(`${title}\n${message}`));
    $("dlgTitle").textContent = title;
    $("dlgMessage").textContent = message;
    $("dlgOk").textContent = okLabel || "Confirm";
    dlg.returnValue = "";
    return new Promise((resolve) => {
      dlg.addEventListener("close", () => resolve(dlg.returnValue === "ok"), { once: true });
      dlg.showModal();
    });
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      const ta = h("textarea", { style: { position: "fixed", opacity: "0" } }); // fallback for older browsers
      ta.value = text;
      document.body.append(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch (_) {
        ok = false;
      }
      ta.remove();
      return ok;
    }
  }

  /** Copy text, flash the button label and show a toast. */
  async function copyWithFeedback(btn, text, what = "Copied to clipboard") {
    const ok = await copyText(text);
    if (!ok) return toast("error", "Copy failed", "Select the text and copy it manually.");
    toast("success", what);
    const label = btn && btn.querySelector("span");
    if (!label) return;
    const original = label.textContent;
    label.textContent = "Copied";
    btn.classList.add("is-done");
    setTimeout(() => {
      label.textContent = original;
      btn.classList.remove("is-done");
    }, 1400);
  }

  /* ------------------------------------------------------------------------
     4. Navigation: hash router, sidebar collapse, mobile drawer
     ------------------------------------------------------------------------ */
  const VIEWS = { dashboard: "Dashboard", writer: "Email Writer", history: "History", settings: "Settings" };

  function route() {
    if (!state.config) return; // settings not loaded yet
    const name = VIEWS[location.hash.slice(1)] ? location.hash.slice(1) : "dashboard";
    Object.keys(VIEWS).forEach((v) => ($(`view-${v}`).hidden = v !== name));
    document.querySelectorAll(".nav-link").forEach((a) => {
      const active = a.dataset.view === name;
      a.classList.toggle("is-active", active);
      if (active) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    $("pageTitle").textContent = VIEWS[name];
    document.title = `${VIEWS[name]} | ${state.config ? state.config.app.name : "MailCraft AI"}`;
    closeDrawer();
    window.scrollTo({ top: 0 });

    if (name === "dashboard") renderDashboard();
    if (name === "history") renderHistory();
    if (name === "settings") fillSettingsForm();
  }

  function setCollapsed(collapsed) {
    document.body.classList.toggle("is-collapsed", collapsed);
    const btn = $("collapseBtn");
    btn.setAttribute("aria-pressed", String(collapsed));
    btn.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
    btn.title = collapsed ? "Expand sidebar" : "Collapse sidebar";
    save(KEYS.collapsed, collapsed);
  }

  function openDrawer() {
    $("sidebar").classList.add("is-open");
    $("scrim").hidden = false;
    $("menuBtn").setAttribute("aria-expanded", "true");
  }
  function closeDrawer() {
    $("sidebar").classList.remove("is-open");
    $("scrim").hidden = true;
    $("menuBtn").setAttribute("aria-expanded", "false");
  }

  function initNavigation() {
    window.addEventListener("hashchange", route);
    $("collapseBtn").addEventListener("click", () => setCollapsed(!document.body.classList.contains("is-collapsed")));
    $("menuBtn").addEventListener("click", openDrawer);
    $("closeNavBtn").addEventListener("click", closeDrawer);
    $("scrim").addEventListener("click", closeDrawer);
    document.addEventListener("keydown", (e) => e.key === "Escape" && closeDrawer());
    setCollapsed(Boolean(load(KEYS.collapsed, false)));

    // "New email" buttons: go to the writer and focus the editor.
    document.querySelectorAll("[data-new-email]").forEach((a) =>
      a.addEventListener("click", () => setTimeout(() => $("prompt").focus({ preventScroll: true }), 50))
    );
  }

  /* ------------------------------------------------------------------------
     5. Email writer
     ------------------------------------------------------------------------ */

  /** Accessible radio group made of buttons (arrow keys move the selection). */
  function radioGroup(container, items, className, onChange, { withIcon = false } = {}) {
    container.replaceChildren();
    const buttons = items.map((item) => {
      const btn = h("button", { class: className, type: "button", role: "radio", "aria-checked": "false", tabindex: "-1", "data-value": item.value, title: item.title || null });
      if (withIcon && item.icon) btn.append(icon(item.icon));
      btn.append(h("span", { text: item.label }));
      container.append(btn);
      return btn;
    });

    const set = (value, notify = true) => {
      buttons.forEach((b) => {
        const on = b.dataset.value === value;
        b.setAttribute("aria-checked", String(on));
        b.tabIndex = on ? 0 : -1;
      });
      if (notify) onChange(value);
    };

    buttons.forEach((btn, i) => {
      btn.addEventListener("click", () => set(btn.dataset.value));
      btn.addEventListener("keydown", (e) => {
        const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
        if (!step) return;
        e.preventDefault();
        const next = buttons[(i + step + buttons.length) % buttons.length];
        set(next.dataset.value);
        next.focus();
      });
    });
    return { set };
  }

  let modeGroup, toneGroup, lengthGroup;

  function buildWriterControls() {
    const cfg = state.config;
    modeGroup = radioGroup($("modeTabs"), cfg.modes.map((m) => ({ value: m.id, label: m.label, icon: m.icon })), "mode-tab", setMode, { withIcon: true });
    toneGroup = radioGroup($("toneGroup"), cfg.tones.map((t) => ({ value: t.id, label: t.label })), "chip-btn", (v) => (state.tone = v));
    lengthGroup = radioGroup($("lengthGroup"), cfg.lengths.map((l) => ({ value: l.id, label: l.label, title: l.words })), "seg-btn", (v) => (state.length = v));
    $("language").replaceChildren(...cfg.languages.map((l) => h("option", { value: l, text: l })));
  }

  function applyDefaultsToWriter() {
    const s = state.settings;
    state.tone = s.tone;
    state.length = s.length;
    toneGroup.set(s.tone, false);
    lengthGroup.set(s.length, false);
    $("language").value = s.language;
  }

  function setMode(id) {
    const mode = modeOf(id);
    state.mode = mode.id;
    modeGroup.set(mode.id, false);
    $("mainLabel").textContent = mode.main_label;
    $("prompt").placeholder = mode.main_placeholder;
    $("modeDescription").textContent = mode.description;
    $("originalField").hidden = !mode.original_label;
    if (mode.original_label) $("originalLabel").textContent = mode.original_label;
    $("generateLabel").textContent = mode.id === "subjects" ? "Generate subject lines" : "Generate email";
    clearFieldErrors();
  }

  function clearFieldErrors() {
    ["prompt", "original"].forEach((id) => {
      $(`${id}Error`).textContent = "";
      $(id).classList.remove("has-error");
    });
  }

  function updateCounters() {
    const max = state.config.limits.max_prompt_chars;
    const n = $("prompt").value.length;
    $("promptMeta").textContent = `${n} / ${max} characters`;
    const o = $("original").value.length;
    $("originalMeta").textContent = o ? `${o} / ${state.config.limits.max_original_chars} characters` : "";
    if (n >= state.config.limits.min_prompt_chars) {
      $("promptError").textContent = "";
      $("prompt").classList.remove("has-error");
    }
    if (o >= 10) {
      $("originalError").textContent = "";
      $("original").classList.remove("has-error");
    }
  }

  /** Read the form and build the payload for /api/generate. */
  function readPayload() {
    const s = state.settings;
    return {
      mode: state.mode,
      prompt: $("prompt").value.trim(),
      original: $("originalField").hidden ? "" : $("original").value.trim(),
      recipient: $("recipient").value.trim(),
      tone: state.tone,
      length: state.length,
      language: $("language").value,
      model: s.model,
      sender_name: s.name,
      sender_role: s.role,
    };
  }

  function validate(payload) {
    const { limits } = state.config;
    const mode = modeOf(payload.mode);
    clearFieldErrors();
    let firstBad = null;

    const fail = (id, message) => {
      $(`${id}Error`).textContent = message;
      $(id).classList.add("has-error");
      firstBad = firstBad || $(id);
    };

    if (payload.prompt.length < limits.min_prompt_chars) fail("prompt", `Write at least ${limits.min_prompt_chars} characters.`);
    else if (payload.prompt.length > limits.max_prompt_chars) fail("prompt", `Too long. The limit is ${limits.max_prompt_chars} characters.`);

    if (mode.original_label) {
      if (mode.original_required && payload.original.length < 10) fail("original", `Fill in "${mode.original_label}".`);
      else if (payload.original.length > limits.max_original_chars) fail("original", `Too long. The limit is ${limits.max_original_chars} characters.`);
    }
    if (firstBad) firstBad.focus();
    return !firstBad;
  }

  /** POST JSON to the backend and return its `data`. Throws an Error with a readable message. */
  async function postJSON(url, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 150000);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
      let payload = null;
      try {
        payload = await res.json();
      } catch (_) {
        /* body was not JSON */
      }
      if (!res.ok || !payload || payload.ok === false) {
        const err = new Error((payload && payload.error && payload.error.message) || `The server returned an error (${res.status}).`);
        err.code = payload && payload.error && payload.error.code;
        throw err;
      }
      return payload.data;
    } catch (err) {
      if (err.name === "AbortError") throw new Error("This took too long. Try again or choose a faster model in Settings.");
      if (err instanceof TypeError) throw new Error("Could not reach the server. Check that the Flask app is running and you are online.");
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /* ---- Output panel states ---- */
  function showEmpty() {
    $("outputBody").replaceChildren(
      h("div", { class: "state" }, h("span", { class: "empty-icon" }, icon("inbox")), h("h4", { text: "Your email will appear here" }), h("p", { text: "Add a few notes on the left, choose a tone and select Generate." }))
    );
  }

  let loadingTimer = null;
  const LOADING_STEPS = ["Reading your notes", "Choosing the right tone", "Drafting your email", "Polishing the wording"];

  function showLoading() {
    const status = h("span", { text: LOADING_STEPS[0] });
    let step = 0;
    clearInterval(loadingTimer);
    loadingTimer = setInterval(() => {
      step = (step + 1) % LOADING_STEPS.length;
      status.textContent = LOADING_STEPS[step];
    }, 2200);

    $("outputBody").replaceChildren(
      h(
        "div",
        { role: "status", "aria-label": "Generating" },
        h("div", { class: "loading-status" }, h("span", { class: "dots" }, h("i"), h("i"), h("i")), status),
        h(
          "div",
          { class: "email-card" },
          h("div", { class: "skeleton-card" }, h("div", { class: "sk w60" }), h("div", { class: "sk w95 gap" }), h("div", { class: "sk w80" }), h("div", { class: "sk w95" }), h("div", { class: "sk w40" }), h("div", { class: "sk w95 gap" }), h("div", { class: "sk w80" }), h("div", { class: "sk w60" }))
        )
      )
    );
  }

  function showError(message) {
    clearInterval(loadingTimer);
    const retry = state.lastRequest ? h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => generate(true) }, icon("refresh"), h("span", { text: "Try again" })) : null;
    $("outputBody").replaceChildren(h("div", { class: "error-box", role: "alert" }, icon("alert"), h("p", { text: message }), retry));
  }

  function resultToText(r) {
    if (list(r.subjects).length) return r.subjects.map((s, i) => `${i + 1}. ${s.text}`).join("\n");
    return r.subject ? `Subject: ${r.subject}\n\n${r.body}` : r.body;
  }

  function showResult(r) {
    clearInterval(loadingTimer);
    const isSubjects = list(r.subjects).length > 0;
    const foot = h(
      "div",
      { class: "email-foot" },
      h("span", { class: "badge", text: modeOf(r.mode).label }),
      h("span", { class: "badge badge-plain", text: toneLabel(r.tone) }),
      h("span", { class: "badge badge-plain", text: r.language }),
      !isSubjects && h("span", { class: "count", text: `${wordCount(r.body)} words` })
    );

    let card;
    if (isSubjects) {
      card = h(
        "div",
        { class: "email-card" },
        h(
          "div",
          { class: "subject-list" },
          r.subjects.map((s, i) => {
            const btn = h("button", { class: "btn btn-ghost btn-sm", type: "button", "aria-label": `Copy subject ${i + 1}` }, icon("copy"), h("span", { text: "Copy" }));
            btn.addEventListener("click", () => copyWithFeedback(btn, s.text, "Subject line copied"));
            return h("div", { class: "subject-item" }, h("span", { class: "subject-num", text: String(i + 1) }), h("div", { class: "subject-main" }, h("div", { class: "subject-text", text: s.text }), s.note && h("div", { class: "subject-note", text: s.note })), btn);
          })
        ),
        foot
      );
    } else {
      const subjectBtn = h("button", { class: "btn btn-ghost btn-sm email-copy", type: "button", "aria-label": "Copy subject" }, icon("copy"), h("span", { text: "Copy" }));
      subjectBtn.addEventListener("click", () => copyWithFeedback(subjectBtn, r.subject, "Subject copied"));
      const bodyBtn = h("button", { class: "btn btn-ghost btn-sm email-copy", type: "button" }, icon("copy"), h("span", { text: "Copy body" }));
      bodyBtn.addEventListener("click", () => copyWithFeedback(bodyBtn, r.body, "Email body copied"));
      foot.append(bodyBtn);
      card = h("div", { class: "email-card" }, r.subject && h("div", { class: "email-row" }, h("span", { class: "email-key", text: "Subject" }), h("div", { class: "email-subject", text: r.subject }), subjectBtn), h("div", { class: "email-body", text: r.body }), foot);
    }
    $("outputBody").replaceChildren(card);
  }

  function updateToolbar() {
    const has = Boolean(state.current);
    $("regenBtn").disabled = !state.lastRequest || state.busy;
    $("copyBtn").disabled = !has || state.busy;
    $("downloadBtn").disabled = !has || state.busy;
    $("clearBtn").disabled = state.busy;
  }

  function setBusy(busy) {
    state.busy = busy;
    const btn = $("generateBtn");
    btn.classList.toggle("is-loading", busy);
    btn.disabled = busy || state.keyMissing;
    btn.title = state.keyMissing ? "Add OPENROUTER_API_KEY on the server first" : "";
    $("generateLabel").textContent = busy ? "Writing..." : modeOf(state.mode).id === "subjects" ? "Generate subject lines" : "Generate email";
    updateToolbar();
  }

  /** Generate (or regenerate with the same inputs). */
  async function generate(regenerate = false) {
    if (state.busy || state.keyMissing) return;
    const payload = regenerate && state.lastRequest ? state.lastRequest : readPayload();
    if (!regenerate && !validate(payload)) return;

    setBusy(true);
    showLoading();
    try {
      const data = await postJSON("/api/generate", payload);
      state.lastRequest = payload;
      state.current = { id: uid(), created: Date.now(), mode: payload.mode, tone: payload.tone, length: payload.length, language: payload.language, prompt: payload.prompt, original: payload.original, recipient: payload.recipient, subject: data.subject || "", body: data.body || "", subjects: data.subjects || [] };
      addToHistory(state.current);
      showResult(state.current);
      toast("success", payload.mode === "subjects" ? "Subject lines ready" : "Email ready", "Saved to your history.");
    } catch (err) {
      if (err.code === "missing_api_key") {
        state.keyMissing = true;
        $("keyBanner").hidden = false;
      }
      showError(err.message);
      toast("error", "Could not generate", err.message);
    } finally {
      setBusy(false);
    }
  }

  function slugify(text) {
    return (text || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 50);
  }

  function downloadText(filename, content) {
    const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
    const a = h("a", { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadCurrent(item) {
    const r = item || state.current;
    if (!r) return;
    const name = r.subjects && r.subjects.length ? "subject-lines" : slugify(r.subject) || "email";
    downloadText(`mailcraft-${name}.txt`, resultToText(r));
    toast("success", "Download started");
  }

  function clearWriter() {
    if (state.busy) return;
    $("prompt").value = "";
    $("original").value = "";
    $("recipient").value = "";
    state.current = null;
    state.lastRequest = null;
    clearFieldErrors();
    updateCounters();
    showEmpty();
    updateToolbar();
    $("prompt").focus();
    toast("info", "Workspace cleared");
  }

  /** Load a saved history item back into the writer. */
  function openInWriter(item) {
    setMode(item.mode);
    $("prompt").value = item.prompt || "";
    $("original").value = item.original || "";
    $("recipient").value = item.recipient || "";
    state.tone = item.tone;
    state.length = item.length;
    toneGroup.set(item.tone, false);
    lengthGroup.set(item.length, false);
    if (state.config.languages.includes(item.language)) $("language").value = item.language;
    updateCounters();

    state.current = item;
    state.lastRequest = { mode: item.mode, prompt: item.prompt, original: item.original || "", recipient: item.recipient || "", tone: item.tone, length: item.length, language: item.language, model: state.settings.model, sender_name: state.settings.name, sender_role: state.settings.role };
    showResult(item);
    updateToolbar();
    location.hash = "#writer";
  }

  function openWriterWithMode(modeId) {
    setMode(modeId);
    if (location.hash !== "#writer") location.hash = "#writer";
    setTimeout(() => $("prompt").focus({ preventScroll: true }), 80);
  }

  function initWriter() {
    buildWriterControls();
    applyDefaultsToWriter();
    setMode("compose");
    showEmpty();
    updateCounters();
    updateToolbar();

    $("prompt").addEventListener("input", updateCounters);
    $("original").addEventListener("input", updateCounters);
    $("writerForm").addEventListener("submit", (e) => {
      e.preventDefault();
      generate(false);
    });
    $("writerForm").addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        generate(false);
      }
    });
    $("regenBtn").addEventListener("click", () => generate(true));
    $("copyBtn").addEventListener("click", () => state.current && copyWithFeedback($("copyBtn"), resultToText(state.current)));
    $("downloadBtn").addEventListener("click", () => downloadCurrent());
    $("clearBtn").addEventListener("click", clearWriter);
  }

  /* ------------------------------------------------------------------------
     6. Dashboard
     ------------------------------------------------------------------------ */
  function greeting() {
    const hour = new Date().getHours();
    const part = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    const first = state.settings.name.trim().split(/\s+/)[0];
    return first ? `${part}, ${first}` : part;
  }

  function statCard(iconName, tint, value, label) {
    return h("div", { class: "card stat" }, h("span", { class: `stat-icon ${tint}` }, icon(iconName)), h("div", null, h("div", { class: "stat-num", text: String(value) }), h("div", { class: "stat-label", text: label })));
  }

  function renderDashboard() {
    $("welcomeTitle").textContent = greeting();

    const weekAgo = Date.now() - 7 * 86400000;
    const thisWeek = state.history.filter((i) => i.created >= weekAgo).length;
    const counts = {};
    state.history.forEach((i) => (counts[i.tone] = (counts[i.tone] || 0) + 1));
    const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    $("stats").replaceChildren(statCard("inbox", "", state.history.length, "Emails in history"), statCard("calendar", "green", thisWeek, "Created this week"), statCard("mic", "violet", top ? toneLabel(top) : "None yet", "Most used tone"));

    $("featureGrid").replaceChildren(
      ...state.config.modes.map((m, i) =>
        h("button", { class: "feature-card", type: "button", style: { "--i": String(i) }, onclick: () => openWriterWithMode(m.id) }, h("span", { class: "feature-icon" }, icon(m.icon)), h("h4", { text: m.label }), h("p", { text: m.description }), h("span", { class: "feature-go" }, "Start", icon("arrow")))
      )
    );

    const recent = state.history.slice(0, 5);
    if (!recent.length) {
      $("recentCard").replaceChildren(
        h("div", { class: "empty" }, h("span", { class: "empty-icon" }, icon("inbox")), h("h4", { text: "No emails yet" }), h("p", { text: "Your generated emails show up here so you can reopen, copy or download them later." }), h("a", { class: "btn btn-primary btn-sm", href: "#writer" }, icon("pen"), h("span", { text: "Write your first email" })))
      );
      return;
    }
    $("recentCard").replaceChildren(
      h(
        "ul",
        { class: "activity" },
        recent.map((item) =>
          h(
            "li",
            null,
            h(
              "div",
              { class: "activity-row" },
              h("span", { class: "activity-icon" }, icon(modeOf(item.mode).icon)),
              h("div", { class: "activity-main" }, h("div", { class: "activity-title", text: itemTitle(item) }), h("div", { class: "activity-meta", text: `${modeOf(item.mode).label} · ${toneLabel(item.tone)} · ${timeAgo(item.created)}` })),
              h("button", { class: "btn btn-ghost btn-sm", type: "button", "aria-label": `Open ${itemTitle(item)}`, onclick: () => openInWriter(item) }, icon("arrow"), h("span", { text: "Open" }))
            )
          )
        )
      )
    );
  }

  /* ------------------------------------------------------------------------
     7. History
     ------------------------------------------------------------------------ */
  const itemTitle = (item) => item.subject || (item.subjects && item.subjects[0] && item.subjects[0].text) || item.prompt.slice(0, 70);

  function addToHistory(item) {
    state.history.unshift(item);
    state.history = state.history.slice(0, HISTORY_LIMIT);
    save(KEYS.history, state.history);
    updateNavCount();
  }

  function updateNavCount() {
    const n = state.history.length;
    $("navCount").textContent = String(n);
    $("navCount").hidden = n === 0;
  }

  function renderHistory() {
    const q = $("historySearch").value.trim().toLowerCase();
    const items = state.history.filter((i) => !q || [i.subject, i.prompt, i.body, ...list(i.subjects).map((s) => s.text)].join(" ").toLowerCase().includes(q));
    $("clearHistoryBtn").disabled = state.history.length === 0;

    if (!items.length) {
      const none = state.history.length === 0;
      $("historyList").replaceChildren(
        h("div", { class: "card history-empty" }, h("div", { class: "empty" }, h("span", { class: "empty-icon" }, icon(none ? "history" : "search")), h("h4", { text: none ? "Nothing here yet" : "No matches" }), h("p", { text: none ? "Emails you generate are saved here automatically." : "Try a different word or clear the search box." }), none && h("a", { class: "btn btn-primary btn-sm", href: "#writer" }, icon("pen"), h("span", { text: "Write an email" }))))
      );
      return;
    }

    $("historyList").replaceChildren(
      ...items.map((item, i) => {
        const preview = item.subjects && item.subjects.length ? item.subjects.map((s) => s.text).join(" · ") : item.body;
        const copyBtn = h("button", { class: "btn btn-ghost btn-sm", type: "button" }, icon("copy"), h("span", { text: "Copy" }));
        copyBtn.addEventListener("click", () => copyWithFeedback(copyBtn, resultToText(item)));
        return h(
          "article",
          { class: "history-item", style: { animationDelay: `${Math.min(i, 8) * 40}ms` } },
          h("div", { class: "history-top" }, h("span", { class: "badge", text: modeOf(item.mode).label }), h("span", { class: "badge badge-plain", text: toneLabel(item.tone) }), h("span", { class: "history-time", text: timeAgo(item.created) })),
          h("h4", { class: "history-subject", text: itemTitle(item) }),
          h("p", { class: "history-preview", text: preview }),
          h(
            "div",
            { class: "history-actions" },
            h("button", { class: "btn btn-primary btn-sm", type: "button", onclick: () => openInWriter(item) }, icon("pen"), h("span", { text: "Open" })),
            copyBtn,
            h("button", { class: "btn btn-ghost btn-sm", type: "button", "aria-label": "Download", onclick: () => downloadCurrent(item) }, icon("download")),
            h("button", { class: "btn btn-ghost btn-sm btn-danger", type: "button", "aria-label": "Delete", onclick: () => deleteHistory(item.id) }, icon("trash"))
          )
        );
      })
    );
  }

  function deleteHistory(id) {
    state.history = state.history.filter((i) => i.id !== id);
    save(KEYS.history, state.history);
    updateNavCount();
    renderHistory();
    toast("info", "Email deleted");
  }

  async function clearHistory() {
    if (!state.history.length) return;
    const ok = await confirmDialog("Clear all history?", `This removes ${state.history.length} saved email(s) from this browser. It cannot be undone.`, "Clear all");
    if (!ok) return;
    state.history = [];
    save(KEYS.history, []);
    updateNavCount();
    renderHistory();
    toast("success", "History cleared");
  }

  /* ------------------------------------------------------------------------
     8. Settings + profile
     ------------------------------------------------------------------------ */
  function updateProfile() {
    const name = state.settings.name.trim();
    $("profileName").textContent = name || "Guest";
    $("profileRole").textContent = state.settings.role.trim() || "Set up your profile";
    $("avatar").textContent = (name ? name[0] : "G").toUpperCase();
  }

  function fillSelect(select, items) {
    select.replaceChildren(...items.map((i) => h("option", { value: i.value, text: i.label })));
  }

  function initSettings() {
    const cfg = state.config;
    fillSelect($("setTone"), cfg.tones.map((t) => ({ value: t.id, label: t.label })));
    fillSelect($("setLanguage"), cfg.languages.map((l) => ({ value: l, label: l })));
    fillSelect($("setLength"), cfg.lengths.map((l) => ({ value: l.id, label: `${l.label} (${l.words})` })));
    fillSelect($("setModel"), cfg.models.map((m) => ({ value: m.id, label: m.label })));

    $("settingsForm").addEventListener("submit", (e) => {
      e.preventDefault();
      state.settings = {
        name: $("setName").value.trim(),
        role: $("setRole").value.trim(),
        tone: $("setTone").value,
        language: $("setLanguage").value,
        length: $("setLength").value,
        model: $("setModel").value,
      };
      save(KEYS.settings, state.settings);
      updateProfile();
      applyDefaultsToWriter();
      toast("success", "Settings saved");
    });
  }

  function fillSettingsForm() {
    const s = state.settings;
    $("setName").value = s.name;
    $("setRole").value = s.role;
    $("setTone").value = s.tone;
    $("setLanguage").value = s.language;
    $("setLength").value = s.length;
    $("setModel").value = s.model;
  }

  /* ------------------------------------------------------------------------
     9. Startup
     ------------------------------------------------------------------------ */
  async function init() {
    initNavigation();

    try {
      const res = await fetch("/api/config");
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error();
      state.config = body.data;
    } catch (_) {
      $("keyBanner").hidden = false;
      $("keyBanner").querySelector("div").textContent = "Could not load settings from the server. Start the app with python app.py and reload this page.";
      $("generateBtn").disabled = true;
      return;
    }

    const cfg = state.config;
    document.querySelectorAll(".brand-name").forEach((el) => (el.innerHTML = ""));
    document.querySelectorAll(".brand-name").forEach((el) => {
      const parts = cfg.app.name.split(" ");
      const last = parts.pop();
      el.append(parts.join(" ") + " ", h("b", { text: last }));
    });

    // Merge saved settings over the defaults from config.json (ignore values that no longer exist).
    const saved = load(KEYS.settings, {});
    state.settings = {
      name: String(saved.name || ""),
      role: String(saved.role || ""),
      tone: cfg.tones.some((t) => t.id === saved.tone) ? saved.tone : cfg.defaults.tone,
      language: cfg.languages.includes(saved.language) ? saved.language : cfg.defaults.language,
      length: cfg.lengths.some((l) => l.id === saved.length) ? saved.length : cfg.defaults.length,
      model: cfg.models.some((m) => m.id === saved.model) ? saved.model : cfg.default_model,
    };
    state.history = list(load(KEYS.history, [])).filter((i) => i && i.id && i.mode && i.prompt !== undefined).slice(0, HISTORY_LIMIT);

    initSettings();
    initWriter();
    updateProfile();
    updateNavCount();

    $("historySearch").addEventListener("input", renderHistory);
    $("clearHistoryBtn").addEventListener("click", clearHistory);

    route();

    // Warn early if the server has no API key.
    try {
      const health = await (await fetch("/api/health")).json();
      if (!health.api_key_configured) {
        state.keyMissing = true;
        $("keyBanner").hidden = false;
        setBusy(false);
      }
    } catch (_) {
      /* the first real request will show any connection problem */
    }
  }

  init();
})();
