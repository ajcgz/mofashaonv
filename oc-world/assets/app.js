/* ============================================================
   OC 世界觀站 · app.js
   讀取層：Spherse 內用 spherse.data.entries，靜態站用 fetch
   寫入層：Spherse 內用 spherse.data.mutate（$manifest 入口）
           靜態站（GitHub Pages）自動切唯讀
   ============================================================ */
"use strict";

/* ── 常數 ─────────────────────────────────── */
var DATA_FILE = "oc-world/data/world.data.json";  /* Spherse 專案內路徑（SDK 用） */
var DATA_URL = "data/world.data.json";            /* 相對 HTML（fetch 用） */
var MEDIA_DIR = "oc-world/media";            /* uploadFile 目標目錄 */
var SITE_PREFIX = "oc-world/";               /* 專案路徑 → 站內相對路徑 */

var REL_TYPES = ["親屬", "摯友", "戀人", "師徒", "同盟", "敵對", "隸屬", "其他"];
var REL_COLORS = {
  "親屬": "#c2703f", "摯友": "#3f8f6f", "戀人": "#c2506f", "師徒": "#7a6fbf",
  "同盟": "#4f7fbf", "敵對": "#b4453a", "隸屬": "#8a8f4f", "其他": "#8d949a"
};
var FACTION_COLORS = ["#5d7180", "#b06a3f", "#4f8a6a", "#8a5aa0", "#c25a6a", "#7a7a3f", "#3f7a9a", "#a06a8a"];
var NS = "http://www.w3.org/2000/svg";
var GRAPH_W = 900, GRAPH_H = 560;

/* ── 狀態 ─────────────────────────────────── */
var S = { world: {}, map: {}, characters: [], relations: [], stories: [], places: [], events: [], gallery: [] };
var sdk = null;
var editMode = false;
var readOnly = false;
var uploadHandler = null;

/* ── 小工具 ───────────────────────────────── */
function el(id) { return document.getElementById(id); }

function h(tag, props) {
  var node = document.createElement(tag);
  if (props) {
    Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v === null || v === undefined || v === false) return;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k === "html") node.innerHTML = v;
      else if (k.indexOf("on") === 0 && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
      else node.setAttribute(k, v === true ? "" : v);
    });
  }
  for (var i = 2; i < arguments.length; i++) {
    var kid = arguments[i];
    if (kid === null || kid === undefined || kid === false) continue;
    if (Array.isArray(kid)) {
      kid.forEach(function (k2) { if (k2) node.appendChild(k2); });
    } else {
      node.appendChild(typeof kid === "string" ? document.createTextNode(kid) : kid);
    }
  }
  return node;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
  });
}

function inlineMd(s) {
  var t = escapeHtml(s);
  t = t.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  t = t.replace(/\n/g, "<br>");
  return t;
}

/* 空行分段 + 粗體/斜體 + > 引用 */
function richText(text, extraClass) {
  var wrap = h("div", { class: "prose" + (extraClass ? " " + extraClass : "") });
  var blocks = String(text || "").split(/\n{2,}/);
  blocks.forEach(function (block) {
    var body = block.trim();
    if (!body) return;
    if (body.charAt(0) === ">") {
      wrap.appendChild(h("blockquote", { html: inlineMd(body.replace(/^>\s?/gm, "")) }));
    } else {
      wrap.appendChild(h("p", { html: inlineMd(body) }));
    }
  });
  return wrap;
}

function byId(list, id) {
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
}

function sortByOrder(a, b) {
  var d = (a.order || 0) - (b.order || 0);
  if (d !== 0) return d;
  return String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
}

function csv(str) {
  return String(str || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
}

function imageSrc(value) {
  var v = String(value || "").trim();
  return v;
}

function stripPrefix(p) {
  var s = String(p || "");
  return s.indexOf(SITE_PREFIX) === 0 ? s.slice(SITE_PREFIX.length) : s;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function uniqueFactions() {
  var counts = {};
  S.characters.forEach(function (c) {
    var f = String(c.faction || "").trim();
    if (f) counts[f] = (counts[f] || 0) + 1;
  });
  return Object.keys(counts).sort(function (a, b) {
    return counts[b] - counts[a] || a.localeCompare(b);
  });
}

function factionCount(f) {
  return S.characters.filter(function (c) { return String(c.faction || "").trim() === f; }).length;
}

function factionColor(f) {
  var name = String(f || "").trim();
  if (!name) return "#8d949a";
  var list = uniqueFactions();
  var i = list.indexOf(name);
  if (i < 0) i = 0;
  return FACTION_COLORS[i % FACTION_COLORS.length];
}

function relationDegree(id) {
  return S.relations.filter(function (r) { return r.fromId === id || r.toId === id; }).length;
}

var toastTimer = null;
function toast(msg, isError) {
  var t = el("toast");
  t.textContent = msg;
  t.classList.toggle("error", !!isError);
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2400);
}

function reportErr(err) {
  toast("操作失敗：" + String((err && err.message) || err), true);
}

/* ── SDK / 資料存取 ───────────────────────── */
function getSdk() {
  return (typeof window.spherse !== "undefined" && window.spherse && window.spherse.data)
    ? window.spherse : null;
}

function detectSdk() {
  return new Promise(function (resolve) {
    var tries = 0;
    (function poll() {
      var s = getSdk();
      if (s) return resolve(s);
      if (tries++ > 10) return resolve(null);
      setTimeout(poll, 50);
    })();
  });
}

function readData() {
  if (sdk) return sdk.data.entries({ file: DATA_FILE });
  return fetch(DATA_URL, { cache: "no-store" }).then(function (res) {
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  });
}

function mutate(name, args) {
  if (!sdk) return Promise.reject(new Error("唯讀模式無法寫入"));
  return sdk.data.mutate({ file: DATA_FILE, name: name, args: args });
}

function load() {
  return readData().then(function (all) {
    S.world = (all && all.world) || {};
    S.map = (all && all.map) || {};
    S.characters = ((all && all.characters) || []).slice().sort(sortByOrder);
    S.relations = ((all && all.relations) || []).slice().sort(sortByOrder);
    S.stories = ((all && all.stories) || []).slice().sort(sortByOrder);
    S.places = ((all && all.places) || []).slice().sort(sortByOrder);
    S.events = ((all && all.events) || []).slice().sort(sortByOrder);
    S.gallery = ((all && all.gallery) || []).slice().sort(sortByOrder);
    render();
  });
}

/* ── 路由 ─────────────────────────────────── */
function parseRoute() {
  var raw = (location.hash || "#/").replace(/^#\/?/, "");
  var parts = raw.split("/").filter(Boolean);
  return { view: parts[0] || "home", id: parts[1] || "" };
}

function render() {
  var route = parseRoute();
  var accent = String(S.world.accent || "");
  if (/^#[0-9a-f]{6}$/i.test(accent)) {
    document.documentElement.style.setProperty("--accent", accent);
  } else {
    document.documentElement.style.removeProperty("--accent");
  }
  document.title = S.world.name ? S.world.name + " · OC 世界觀" : "OC 世界觀";
  el("brandName").textContent = S.world.name || "OC 世界觀";
  document.body.classList.toggle("editing", editMode);

  var links = document.querySelectorAll("#nav a");
  for (var i = 0; i < links.length; i++) {
    links[i].classList.toggle("active", links[i].getAttribute("data-view") === route.view);
  }

  var host = el("view");
  host.innerHTML = "";
  var page;
  if (route.view === "characters") page = route.id ? characterPage(route.id) : charactersPage();
  else if (route.view === "graph") page = graphPage();
  else if (route.view === "timeline") page = timelinePage();
  else if (route.view === "map") page = mapPage();
  else if (route.view === "gallery") page = galleryPage();
  else if (route.view === "stories") page = route.id ? storyPage(route.id) : storiesPage();
  else page = homePage();
  host.appendChild(page);
  decoratePage(page);
  updateHud();
}

/* ── 宿命層：殘影、進場、HUD ─────────────── */
var revealObserver = null;

function decoratePage(page) {
  /* 名字殘影（既視感） */
  var names = page.querySelectorAll(".char-name, .char-hero h1");
  for (var i = 0; i < names.length; i++) {
    names[i].setAttribute("data-echo", names[i].textContent || "");
  }

  /* 逐段進場 */
  if (!revealObserver && typeof IntersectionObserver !== "undefined") {
    revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          en.target.classList.add("in");
          revealObserver.unobserve(en.target);
        }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.06 });
  }
  var blocks = page.querySelectorAll(".section, .stats, .card, .tl-item, .gallery-cell, .article");
  for (var j = 0; j < blocks.length; j++) {
    var node = blocks[j];
    if (node.classList.contains("reveal")) continue;
    node.classList.add("reveal");
    if (revealObserver) revealObserver.observe(node);
    else node.classList.add("in");
  }
}

function updateHud() {
  var hud = el("hud");
  if (!hud) return;
  hud.innerHTML = "";
  function add(label, value, cls) {
    var s = h("span", cls ? { class: cls } : null);
    s.appendChild(document.createTextNode(label + " "));
    s.appendChild(h("b", { text: String(value) }));
    hud.appendChild(s);
  }
  if (S.world.era) hud.appendChild(h("span", { class: "hud-era", text: S.world.era }));
  add("人物", S.characters.length);
  add("關係", S.relations.length);
  add("節點", S.events.length);
  add("地點", S.places.length);
}

/* ── 共用元件 ─────────────────────────────── */
function avatar(c, extraClass) {
  var node = h("div", { class: "avatar" + (extraClass ? " " + extraClass : "") });
  var src = imageSrc(c && c.image);
  if (src) node.appendChild(h("img", { src: src, alt: (c && c.name) || "" }));
  else node.textContent = ((c && c.name) || "?").slice(0, 1);
  return node;
}

function backLink(href, text) {
  return h("a", { class: "back", href: href, text: text });
}

function sectionBlock(title, countText, bodyNode, rightNodes) {
  var wrap = h("div", { class: "section" });
  var head = h("div", { class: "section-head" }, h("h2", { text: title }));
  if (countText) head.appendChild(h("span", { class: "count", text: countText }));
  if (rightNodes && rightNodes.length) {
    var tools = h("div", { class: "tools" });
    rightNodes.forEach(function (n) { if (n) tools.appendChild(n); });
    head.appendChild(tools);
  }
  wrap.appendChild(head);
  wrap.appendChild(bodyNode);
  return wrap;
}

function editButton(label, onClick) {
  var b = h("button", { class: "btn small only-edit", text: label });
  b.addEventListener("click", onClick);
  return b;
}

/* ── 首頁 ─────────────────────────────────── */
function homePage() {
  var w = S.world;
  var page = h("div", { class: "page" });

  var hero = h("div", { class: "hero" });
  if (w.era) hero.appendChild(h("span", { class: "hero-era", text: w.era }));
  hero.appendChild(h("h1", { text: w.name || "未命名世界" }));
  if (w.tagline) hero.appendChild(h("p", { class: "tagline", text: w.tagline }));
  if (w.intro) hero.appendChild(richText(w.intro, "intro"));

  var actions = h("div", { class: "hero-actions" });
  actions.appendChild(editButton("編輯世界觀", function () { editWorld(); }));
  actions.appendChild(h("a", { class: "btn", href: "#/graph", text: "關係圖" }));
  actions.appendChild(h("a", { class: "btn", href: "#/timeline", text: "時間綫" }));
  actions.appendChild(h("a", { class: "btn", href: "#/map", text: "地圖" }));
  actions.appendChild(h("a", { class: "btn", href: "#/gallery", text: "畫廊" }));
  hero.appendChild(actions);
  hero.appendChild(h("div", { class: "hero-seal" },
    h("span", { text: "重考" }),
    h("small", { text: "DSE 2020" })
  ));
  page.appendChild(hero);

  var stats = h("div", { class: "stats" },
    h("div", { class: "stat" }, h("b", { text: String(S.characters.length) }), h("span", { text: "人物" })),
    h("div", { class: "stat" }, h("b", { text: String(S.relations.length) }), h("span", { text: "人物關係" })),
    h("div", { class: "stat" }, h("b", { text: String(S.events.length) }), h("span", { text: "時間綫節點" })),
    h("div", { class: "stat" }, h("b", { text: String(S.places.length) }), h("span", { text: "地圖地點" })),
    h("div", { class: "stat" }, h("b", { text: String(S.gallery.length) }), h("span", { text: "畫廊圖片" })),
    h("div", { class: "stat" }, h("b", { text: String(S.stories.length) }), h("span", { text: "背景故事" }))
  );
  page.appendChild(stats);

  /* 陣營 */
  var factions = uniqueFactions();
  if (factions.length) {
    var facBody = h("div", { class: "chips" });
    factions.forEach(function (f) {
      var chip = h("span", { class: "chip faction", text: f + " · " + factionCount(f) });
      chip.style.background = "color-mix(in srgb, " + factionColor(f) + " 14%, #fff)";
      chip.style.color = factionColor(f);
      facBody.appendChild(chip);
    });
    page.appendChild(h("div", { class: "section" },
      h("div", { class: "section-head" }, h("h2", { text: "陣營" })),
      facBody));
  }

  /* 人物 */
  var charBody = S.characters.length
    ? h("div", { class: "grid" }, S.characters.slice(0, 6).map(characterCard))
    : h("div", { class: "empty", text: editMode ? "還沒有任何人物，到「人物」頁新增。" : "這個世界還沒有填人物。" });
  page.appendChild(sectionBlock("主要人物", S.characters.length + " 位", charBody,
    [h("a", { class: "btn small", href: "#/characters", text: "全部 →" })]));

  /* 故事 */
  if (S.stories.length) {
    page.appendChild(sectionBlock("背景故事", S.stories.length + " 篇",
      h("div", { class: "grid two" }, S.stories.slice(0, 2).map(storyCard)),
      [h("a", { class: "btn small", href: "#/stories", text: "全部 →" })]));
  }

  if (w.footer) page.appendChild(h("p", { class: "page-sub", text: w.footer, style: "margin-top:40px" }));
  return page;
}

/* ── 人物列表 ─────────────────────────────── */
function charactersPage() {
  var page = h("div", { class: "page" });

  var head = h("div", { class: "page-head" });
  head.appendChild(h("h1", { text: "人物" }));
  head.appendChild(editButton("＋ 新增人物", function () { editCharacter(null); }));
  head.appendChild(h("span", {
    class: "page-sub",
    text: S.characters.length + " 位人物 · " + S.relations.length + " 條關係"
  }));
  page.appendChild(head);

  var filters = h("div", { class: "filters" });
  var search = h("input", { class: "input", type: "search", placeholder: "搜尋名字、別名、標籤、簡介…" });
  filters.appendChild(search);
  var sel = null;
  var factions = uniqueFactions();
  if (factions.length > 1) {
    sel = h("select", { class: "input" }, h("option", { value: "", text: "全部陣營" }));
    factions.forEach(function (f) { sel.appendChild(h("option", { value: f, text: f + "（" + factionCount(f) + "）" })); });
    filters.appendChild(sel);
    sel.addEventListener("change", draw);
  }
  page.appendChild(filters);

  var listHost = h("div", { class: "grid" });
  page.appendChild(listHost);

  function draw() {
    var q = String(search.value || "").trim().toLowerCase();
    var fac = sel ? sel.value : "";
    var items = S.characters.filter(function (c) {
      if (fac && String(c.faction || "").trim() !== fac) return false;
      if (!q) return true;
      var hay = [c.name, c.alias, c.role, c.faction, c.tags, c.summary].join(" ").toLowerCase();
      return hay.indexOf(q) >= 0;
    });
    listHost.innerHTML = "";
    if (!items.length) {
      listHost.appendChild(h("div", { class: "empty", text: "沒有符合條件的人物。" }));
      return;
    }
    items.forEach(function (c) { listHost.appendChild(characterCard(c)); });
  }

  search.addEventListener("input", draw);
  draw();
  return page;
}

function characterCard(c) {
  var card = h("a", { class: "card", href: "#/characters/" + c.id });
  var top = h("div", { class: "char-top" });
  top.appendChild(avatar(c, ""));
  var meta = [];
  if (c.alias) meta.push("「" + c.alias + "」");
  if (c.role) meta.push(c.role);
  top.appendChild(h("div", null,
    h("div", { class: "char-name", text: c.name || "未命名" }),
    h("div", { class: "char-meta", text: meta.join(" · ") })
  ));
  card.appendChild(top);
  if (c.summary) card.appendChild(h("p", { class: "summary", text: c.summary }));

  var chips = h("div", { class: "chips" });
  if (c.faction) chips.appendChild(h("span", { class: "chip faction", text: c.faction }));
  csv(c.tags).slice(0, 3).forEach(function (t) { chips.appendChild(h("span", { class: "chip", text: t })); });
  var deg = relationDegree(c.id);
  if (deg) chips.appendChild(h("span", { class: "chip", text: deg + " 條關係" }));
  card.appendChild(chips);
  return card;
}

/* ── 人物詳情 ─────────────────────────────── */
function characterPage(id) {
  var page = h("div", { class: "page" });
  page.appendChild(backLink("#/characters", "← 回到人物列表"));
  var c = byId(S.characters, id);
  if (!c) {
    page.appendChild(h("div", { class: "empty", text: "找不到這位人物，可能已經被刪除。" }));
    return page;
  }

  var hero = h("div", { class: "char-hero" });
  hero.appendChild(avatar(c, "big"));
  var main = h("div", { class: "char-hero-main" });
  main.appendChild(h("h1", { text: c.name || "未命名" }));
  var sub = [];
  if (c.alias) sub.push("「" + c.alias + "」");
  if (c.role) sub.push(c.role);
  if (sub.length) main.appendChild(h("div", { class: "alias", text: sub.join(" · ") }));
  if (c.summary) main.appendChild(h("p", { class: "summary", text: c.summary }));
  var actions = h("div", { class: "hero-actions" });
  actions.appendChild(editButton("編輯人物資料", function () { editCharacter(id); }));
  main.appendChild(actions);
  hero.appendChild(main);
  page.appendChild(hero);

  var profileGroups = [
    { t: "基本資料", rows: [
      ["生日", c.birthday], ["身高", c.height], ["血型", c.bloodType],
      ["陣營 / 所屬", c.faction], ["定位", c.role], ["年齡 / 存在時間", c.age],
      ["關係數", relationDegree(id) + " 條"]
    ]},
    { t: "外貌與形象", rows: [
      ["髮型／髮色", c.hair], ["眼睛", c.eyes], ["平常穿著", c.outfit],
      ["特徵／小動作", c.habit], ["隨身物品", c.keepsake],
      ["代表色", c.color], ["變身／戰鬥外觀", c.transformLook]
    ]},
    { t: "性格", rows: [
      ["形容詞", c.personality], ["口頭禪", c.catchphrase], ["強項", c.strengths], ["缺點", c.flaw],
      ["地雷", c.petPeeve], ["害怕", c.fear], ["壓力大時", c.coping],
      ["第一印象", c.firstImpression]
    ]},
    { t: "劇情", rows: [
      ["最想要的", c.want], ["最怕失去的", c.loseFear], ["不能說的秘密", c.secret]
    ]},
    { t: "能力", rows: [
      ["變身型態", c.transformName], ["能力效果", c.ability],
      ["限制", c.abilityLimit], ["代價", c.cost], ["弱點", c.weakPoint]
    ]},
    { t: "背景與人際", rows: [
      ["家人", c.family], ["倒流前（上一輪）", c.pastLife]
    ]}
  ];

  profileGroups.forEach(function (g) {
    var rows = g.rows.filter(function (r) { return String(r[1] || "").trim() !== ""; });
    if (!rows.length) return;
    var box = h("div", { class: "facts tall" });
    rows.forEach(function (r) {
      box.appendChild(h("div", { class: "fact" }, h("span", { text: r[0] }), h("b", { text: String(r[1]) })));
    });
    page.appendChild(sectionBlock(g.t, "", box));
  });

  var tagChips = h("div", { class: "chips" });
  csv(c.tags).forEach(function (t) { tagChips.appendChild(h("span", { class: "chip", text: t })); });
  if (csv(c.tags).length) page.appendChild(tagChips);

  /* 背景故事 */
  var storyBody = c.story ? richText(c.story) : h("div", { class: "empty", text: editMode ? "還沒寫背景故事，點上方「編輯人物資料」補上。" : "尚未填寫背景故事。" });
  page.appendChild(sectionBlock("背景故事", "", storyBody));

  /* 關係 */
  var rels = S.relations.filter(function (r) { return r.fromId === id || r.toId === id; });
  var relBody = rels.length
    ? h("div", { class: "rel-list" }, rels.map(function (r) { return relationRow(r, id); }))
    : h("div", { class: "empty", text: "還沒有記錄任何關係。" });
  var addRel = editButton("＋ 新增關係", function () { editRelation(null, id); });
  page.appendChild(sectionBlock("人物關係", rels.length + " 條", relBody, [addRel]));

  /* 出場故事 */
  var inStories = S.stories.filter(function (s) { return csv(s.characters).indexOf(id) >= 0; });
  if (inStories.length) {
    page.appendChild(sectionBlock("出場故事", inStories.length + " 篇",
      h("div", { class: "grid two" }, inStories.map(storyCard))));
  }

  /* 個人畫廊 */
  var myGallery = S.gallery.filter(function (g) { return csv(g.characters).indexOf(id) >= 0; });
  if (myGallery.length) {
    var gGrid = h("div", { class: "gallery-grid small" });
    myGallery.forEach(function (g) {
      var cell = h("figure", { class: "gallery-cell" });
      var frame = h("div", { class: "gallery-frame" });
      frame.appendChild(h("img", { src: g.image, alt: g.title || "", loading: "lazy" }));
      frame.addEventListener("click", function () { openLightbox(g); });
      cell.appendChild(frame);
      if (g.title) cell.appendChild(h("figcaption", { class: "gallery-title", text: g.title }));
      gGrid.appendChild(cell);
    });
    var addPhoto = editButton("＋ 加入圖片", function () { editGallery(null, id); });
    page.appendChild(sectionBlock("畫廊", myGallery.length + " 張", gGrid, [addPhoto]));
  } else if (editMode) {
    var addFirst = editButton("＋ 為她加入圖片", function () { editGallery(null, id); });
    page.appendChild(sectionBlock("畫廊", "0 張",
      h("div", { class: "empty", text: "這個人物還沒有圖片。" }), [addFirst]));
  }

  return page;
}

function relationRow(r, perspectiveId) {
  var otherId = r.fromId === perspectiveId ? r.toId : r.fromId;
  var other = byId(S.characters, otherId);
  var row = h("div", { class: "rel-row" });
  var dot = h("span", { class: "rel-dot" });
  dot.style.background = REL_COLORS[r.type] || "#8d949a";
  row.appendChild(dot);
  row.appendChild(h("span", { class: "arrow", text: r.fromId === perspectiveId ? "→" : "←" }));
  row.appendChild(h("a", {
    class: "who",
    href: "#/characters/" + otherId,
    text: other ? (other.name || "未命名") : "（已刪除的人物）"
  }));
  row.appendChild(h("span", { class: "chip rel", text: r.type }));
  var act = h("div", { class: "row-actions" });
  if (editMode) {
    act.appendChild(h("button", { class: "btn small", text: "編輯", onclick: function () { editRelation(r.id); } }));
    act.appendChild(h("button", { class: "btn small danger", text: "刪除", onclick: function () { deleteRelation(r.id); } }));
  }
  row.appendChild(act);
  if (r.note) row.appendChild(h("span", { class: "note", text: r.note }));
  return row;
}

/* ── 關係圖 ───────────────────────────────── */
var graphLinking = false;
var graphPick = null;

function graphPage() {
  var page = h("div", { class: "page" });
  var head = h("div", { class: "page-head" });
  head.appendChild(h("h1", { text: "人物關係圖" }));
  head.appendChild(editButton("＋ 新增關係", function () { editRelation(null); }));
  var linkBtn = h("button", {
    class: "btn small only-edit" + (graphLinking ? " on" : ""),
    text: graphLinking ? "結束連結" : "連結模式"
  });
  linkBtn.addEventListener("click", function () {
    graphLinking = !graphLinking;
    graphPick = null;
    render();
    toast(graphLinking ? "連結模式：點兩個人物即可建立關係" : "已離開連結模式");
  });
  head.appendChild(linkBtn);
  head.appendChild(h("span", {
    class: "page-sub",
    text: S.characters.length + " 人 · " + S.relations.length + " 條關係（可拖動節點）"
  }));
  page.appendChild(head);

  if (!S.characters.length) {
    page.appendChild(h("div", { class: "empty", text: "還沒有人物，先到「人物」頁新增。" }));
    return page;
  }

  if (graphLinking) {
    page.appendChild(h("div", {
      class: "empty",
      text: graphPick
        ? "已選「" + ((byId(S.characters, graphPick) || {}).name || "") + "」，再點另一個人物完成連結。"
        : "點一個人物作為起點，再點另一個人物。"
    }));
  }

  var wrap = h("div", { class: "graph-wrap" });
  page.appendChild(wrap);
  mountGraph(wrap);

  var used = {};
  S.relations.forEach(function (r) { used[r.type] = true; });
  if (S.relations.length) {
    var legend = h("div", { class: "legend" });
    REL_TYPES.filter(function (t) { return used[t]; }).forEach(function (t) {
      var i = h("i");
      i.style.background = REL_COLORS[t] || "#8d949a";
      legend.appendChild(h("span", null, i, h("span", { text: t })));
    });
    page.appendChild(legend);
  }

  if (!S.relations.length) {
    page.appendChild(h("div", {
      class: "empty",
      text: editMode
        ? "目前還沒有關係。按「連結模式」，點兩個人就能連起來。"
        : "這個世界還沒有記錄人物關係。"
    }));
    return page;
  }

  var listBody = h("div", { class: "rel-list" }, S.relations.map(function (r) {
    var a = byId(S.characters, r.fromId), b = byId(S.characters, r.toId);
    var row = h("div", { class: "rel-row" });
    var dot = h("span", { class: "rel-dot" });
    dot.style.background = REL_COLORS[r.type] || "#8d949a";
    row.appendChild(dot);
    row.appendChild(h("a", { class: "who", href: "#/characters/" + r.fromId, text: a ? (a.name || "未命名") : "（已刪除）" }));
    row.appendChild(h("span", { class: "arrow", text: "→" }));
    row.appendChild(h("a", { class: "who", href: "#/characters/" + r.toId, text: b ? (b.name || "未命名") : "（已刪除）" }));
    row.appendChild(h("span", { class: "chip rel", text: r.type }));
    var act = h("div", { class: "row-actions" });
    if (editMode) {
      act.appendChild(h("button", { class: "btn small", text: "編輯", onclick: function () { editRelation(r.id); } }));
      act.appendChild(h("button", { class: "btn small danger", text: "刪除", onclick: function () { deleteRelation(r.id); } }));
    }
    row.appendChild(act);
    if (r.note) row.appendChild(h("span", { class: "note", text: r.note }));
    return row;
  }));
  page.appendChild(sectionBlock("關係清單", S.relations.length + " 條", listBody));

  return page;
}

function layoutGraph(nodes, edges) {
  var n = nodes.length;
  var radius = Math.min(GRAPH_W, GRAPH_H) * 0.3;
  nodes.forEach(function (node, i) {
    var ang = (i / Math.max(1, n)) * Math.PI * 2 - Math.PI / 2;
    node.x = GRAPH_W / 2 + Math.cos(ang) * radius;
    node.y = GRAPH_H / 2 + Math.sin(ang) * radius;
  });

  var iterations = 420;
  for (var it = 0; it < iterations; it++) {
    var cool = 1 - it / iterations;

    for (var i = 0; i < n; i++) {
      for (var j = i + 1; j < n; j++) {
        var a = nodes[i], b = nodes[j];
        var dx = b.x - a.x, dy = b.y - a.y;
        var d2 = dx * dx + dy * dy || 0.01;
        var d = Math.sqrt(d2) || 0.01;
        var rep = Math.min(14000 / d2, 6);
        var fx = (dx / d) * rep, fy = (dy / d) * rep;
        a.x -= fx * cool * 0.5; a.y -= fy * cool * 0.5;
        b.x += fx * cool * 0.5; b.y += fy * cool * 0.5;
      }
    }

    edges.forEach(function (e) {
      var dx = e.b.x - e.a.x, dy = e.b.y - e.a.y;
      var d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      var f = (d - 175) * 0.012 * cool;
      var fx = (dx / d) * f, fy = (dy / d) * f;
      e.a.x += fx; e.a.y += fy;
      e.b.x -= fx; e.b.y -= fy;
    });

    nodes.forEach(function (node) {
      node.x += (GRAPH_W / 2 - node.x) * 0.004 * cool;
      node.y += (GRAPH_H / 2 - node.y) * 0.004 * cool;
      node.x = clamp(node.x, 60, GRAPH_W - 60);
      node.y = clamp(node.y, 60, GRAPH_H - 60);
    });
  }
}

function svgPoint(svg, ev) {
  var pt = svg.createSVGPoint();
  pt.x = ev.clientX;
  pt.y = ev.clientY;
  var m = svg.getScreenCTM();
  if (!m) return { x: 0, y: 0 };
  var loc = pt.matrixTransform(m.inverse());
  return { x: loc.x, y: loc.y };
}

function mountGraph(host) {
  var nodes = S.characters.map(function (c) {
    return { id: c.id, name: c.name || "?", c: c, degree: 0, x: null, y: null, moved: false };
  });
  var byNodeId = {};
  nodes.forEach(function (n) { byNodeId[n.id] = n; });

  var edges = [];
  S.relations.forEach(function (r) {
    var a = byNodeId[r.fromId], b = byNodeId[r.toId];
    if (!a || !b || a === b) return;
    a.degree++;
    b.degree++;
    edges.push({ r: r, a: a, b: b });
  });

  layoutGraph(nodes, edges);

  var svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "graph-svg");
  svg.setAttribute("viewBox", "0 0 " + GRAPH_W + " " + GRAPH_H);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

  /* 邊 */
  edges.forEach(function (e) {
    var line = document.createElementNS(NS, "line");
    line.setAttribute("class", "edge");
    line.style.stroke = REL_COLORS[e.r.type] || "#8d949a";
    svg.appendChild(line);
    e.line = line;

    var label = document.createElementNS(NS, "text");
    label.setAttribute("class", "edge-label");
    label.textContent = e.r.type;
    svg.appendChild(label);
    e.label = label;
  });

  /* 節點 */
  nodes.forEach(function (n) {
    var g = document.createElementNS(NS, "g");
    g.setAttribute("class", "node" + (graphPick === n.id ? " picked" : ""));

    var circle = document.createElementNS(NS, "circle");
    var r = 17 + Math.min(n.degree * 2.6, 13);
    circle.setAttribute("r", String(r));
    circle.style.fill = factionColor(n.c.faction);
    circle.style.cursor = "grab";
    g.appendChild(circle);

    var name = document.createElementNS(NS, "text");
    name.setAttribute("class", "node-label");
    name.setAttribute("y", String(r + 15));
    name.textContent = n.name;
    g.appendChild(name);

    var title = document.createElementNS(NS, "title");
    title.textContent = n.name + (n.c.faction ? "（" + n.c.faction + "）" : "");
    g.appendChild(title);

    g.addEventListener("click", function () {
      if (n.moved) { n.moved = false; return; }
      if (editMode && graphLinking) {
        if (!graphPick) {
          graphPick = n.id;
          toast("已選「" + n.name + "」，再點另一個人物");
          render();
          return;
        }
        if (graphPick === n.id) {
          graphPick = null;
          render();
          return;
        }
        var from = graphPick;
        graphPick = null;
        editRelation(null, from, n.id);
        return;
      }
      location.hash = "#/characters/" + n.id;
    });
    g.addEventListener("pointerenter", function () { highlight(n); });
    g.addEventListener("pointerleave", clearHighlight);

    g.style.touchAction = "none";
    g.addEventListener("pointerdown", function (ev) { startDrag(ev, n, g, svg, draw); });

    svg.appendChild(g);
    n.g = g;
  });

  function highlight(n) {
    var keep = {};
    keep[n.id] = true;
    edges.forEach(function (e) {
      if (e.a.id === n.id) keep[e.b.id] = true;
      if (e.b.id === n.id) keep[e.a.id] = true;
    });
    nodes.forEach(function (m) { m.g.classList.toggle("dim", !keep[m.id]); });
    edges.forEach(function (e) {
      var related = e.a.id === n.id || e.b.id === n.id;
      e.line.classList.toggle("dim", !related);
      e.label.classList.toggle("dim", !related);
    });
  }

  function clearHighlight() {
    nodes.forEach(function (m) { m.g.classList.remove("dim"); });
    edges.forEach(function (e) {
      e.line.classList.remove("dim");
      e.label.classList.remove("dim");
    });
  }

  function draw() {
    edges.forEach(function (e) {
      e.line.setAttribute("x1", e.a.x);
      e.line.setAttribute("y1", e.a.y);
      e.line.setAttribute("x2", e.b.x);
      e.line.setAttribute("y2", e.b.y);
      e.label.setAttribute("x", (e.a.x + e.b.x) / 2);
      e.label.setAttribute("y", (e.a.y + e.b.y) / 2 - 5);
    });
    nodes.forEach(function (n) {
      n.g.setAttribute("transform", "translate(" + n.x.toFixed(1) + "," + n.y.toFixed(1) + ")");
    });
  }

  draw();
  host.appendChild(svg);
}

function startDrag(ev, n, g, svg, draw) {
  ev.preventDefault();
  var start = svgPoint(svg, ev);
  n.moved = false;
  try { g.setPointerCapture(ev.pointerId); } catch (e) { /* 忽略 */ }

  function onMove(e) {
    var p = svgPoint(svg, e);
    if (Math.abs(p.x - start.x) + Math.abs(p.y - start.y) > 4) n.moved = true;
    n.x = clamp(p.x, 30, GRAPH_W - 30);
    n.y = clamp(p.y, 30, GRAPH_H - 30);
    draw();
  }
  function onUp() {
    try { g.releasePointerCapture(ev.pointerId); } catch (err) { /* 忽略 */ }
    g.removeEventListener("pointermove", onMove);
    g.removeEventListener("pointerup", onUp);
    g.removeEventListener("pointercancel", onUp);
  }
  g.addEventListener("pointermove", onMove);
  g.addEventListener("pointerup", onUp);
  g.addEventListener("pointercancel", onUp);
}

/* ── 人物連結小卡 ─────────────────────────── */
function characterChips(csvIds) {
  var ids = csv(csvIds);
  var box = h("div", { class: "chips" });
  ids.forEach(function (id) {
    var c = byId(S.characters, id);
    if (!c) return;
    box.appendChild(h("a", { class: "chip faction", href: "#/characters/" + c.id, text: c.name }));
  });
  return box;
}

/* ── 時間綫節點選項 ───────────────────────── */
function eventOptions() {
  return S.events.map(function (e) {
    return { value: e.id, label: (e.date ? e.date + " · " : "") + (e.title || "未命名節點") };
  });
}

/* ── 地圖 ─────────────────────────────────── */
var selectedPlace = null;

function mapPage() {
  var page = h("div", { class: "page" });
  var head = h("div", { class: "page-head" });
  head.appendChild(h("h1", { text: "地圖" }));
  var uploadBtn = h("button", { class: "btn small only-edit", text: S.map.image ? "換地圖底圖" : "上傳地圖底圖" });
  uploadBtn.addEventListener("click", function () {
    uploadImage(function (relPath) {
      mutate("updateMap", { image: relPath }).then(function () {
        toast("地圖已更新");
        return load();
      }).catch(reportErr);
    });
  });
  head.appendChild(uploadBtn);
  head.appendChild(h("span", {
    class: "page-sub",
    text: S.places.length + " 個地點" + (editMode ? " · 點空白處新增標點，拖動標點移動位置" : " · 點標點看詳情")
  }));
  page.appendChild(head);

  var wrap = h("div", { class: "map-wrap" + (S.map.image ? "" : " blank") });
  if (S.map.image) {
    var img = h("img", { class: "map-bg", src: S.map.image, alt: "地圖" });
    wrap.appendChild(img);
  } else {
    wrap.appendChild(h("div", { class: "map-blank" },
      h("div", { class: "map-blank-ico", text: "◎" }),
      h("div", { text: editMode ? "還沒有底圖。點上方「上傳地圖底圖」，或直接點空白處先標記地點。" : "還沒有設定地圖底圖。" })
    ));
  }

  wrap.addEventListener("click", function (e) {
    if (!editMode) return;
    if (e.target !== wrap && !e.target.classList.contains("map-blank") && !e.target.classList.contains("map-bg") && !e.target.classList.contains("map-blank-ico")) return;
    var rect = wrap.getBoundingClientRect();
    var x = Math.round(((e.clientX - rect.left) / rect.width) * 100);
    var y = Math.round(((e.clientY - rect.top) / rect.height) * 100);
    editPlace(null, clamp(x, 2, 98), clamp(y, 2, 98));
  });
  page.appendChild(wrap);

  S.places.forEach(function (p) {
    wrap.appendChild(placePin(p, wrap));
  });

  if (S.map.note) page.appendChild(h("p", { class: "page-sub", text: S.map.note, style: "margin-top:12px" }));

  /* 選中地點詳情 */
  var sel = byId(S.places, selectedPlace);
  if (sel) {
    var card = h("div", { class: "card place-detail" });
    var top = h("div", { class: "char-top" });
    top.appendChild(h("div", { class: "place-badge", text: (sel.category || "地點").slice(0, 2) }));
    top.appendChild(h("div", null,
      h("div", { class: "char-name", text: sel.name }),
      h("div", { class: "char-meta", text: sel.category || "地點" })
    ));
    card.appendChild(top);
    if (sel.note) card.appendChild(richText(sel.note));
    if (csv(sel.characters).length) card.appendChild(characterChips(sel.characters));
    page.appendChild(card);
  }

  if (S.places.length) {
    var listBody = h("div", { class: "rel-list" }, S.places.map(function (p) {
      var row = h("div", { class: "rel-row" });
      var dot = h("span", { class: "rel-dot" });
      dot.style.background = "var(--accent)";
      row.appendChild(dot);
      var link = h("a", { class: "who", href: "javascript:void(0)", text: p.name });
      link.addEventListener("click", function (e) {
        e.preventDefault();
        selectedPlace = p.id;
        render();
      });
      row.appendChild(link);
      if (p.category) row.appendChild(h("span", { class: "chip rel", text: p.category }));
      var act = h("div", { class: "row-actions" });
      if (editMode) {
        act.appendChild(h("button", { class: "btn small", text: "編輯", onclick: function () { editPlace(p.id); } }));
        act.appendChild(h("button", { class: "btn small danger", text: "刪除", onclick: function () { deletePlace(p.id); } }));
      }
      row.appendChild(act);
      if (p.note) row.appendChild(h("span", { class: "note", text: String(p.note).replace(/\n+/g, " ").slice(0, 90) }));
      return row;
    }));
    page.appendChild(sectionBlock("地點清單", S.places.length + " 個", listBody));
  } else {
    page.appendChild(h("div", {
      class: "empty",
      text: editMode ? "還沒有標點。點上面的地圖空白處，就能在那個位置加一個地點。" : "這張地圖還沒有任何標點。"
    }));
  }

  return page;
}

function placePin(p, wrap) {
  var pin = h("div", { class: "map-pin" + (selectedPlace === p.id ? " active" : "") });
  pin.style.left = p.x + "%";
  pin.style.top = p.y + "%";
  pin.appendChild(h("span", { class: "pin-dot" }));
  pin.appendChild(h("span", { class: "pin-label", text: p.name }));
  if (p.category) pin.appendChild(h("span", { class: "pin-cat", text: p.category }));

  pin.addEventListener("click", function (e) {
    e.stopPropagation();
    if (pin.dataset.dragged === "1") { pin.dataset.dragged = "0"; return; }
    if (editMode) { editPlace(p.id); return; }
    selectedPlace = selectedPlace === p.id ? null : p.id;
    render();
  });

  if (editMode) dragPin(pin, p, wrap);
  return pin;
}

function dragPin(pin, place, wrap) {
  pin.addEventListener("pointerdown", function (ev) {
    ev.preventDefault();
    ev.stopPropagation();
    pin.dataset.dragged = "0";
    var rect = wrap.getBoundingClientRect();
    var moved = false;
    try { pin.setPointerCapture(ev.pointerId); } catch (e) { /* 忽略 */ }

    function onMove(e) {
      var x = clamp(((e.clientX - rect.left) / rect.width) * 100, 1, 99);
      var y = clamp(((e.clientY - rect.top) / rect.height) * 100, 1, 99);
      if (Math.abs(x - place.x) + Math.abs(y - place.y) > 0.8) moved = true;
      pin.style.left = x + "%";
      pin.style.top = y + "%";
      place._nx = Math.round(x);
      place._ny = Math.round(y);
    }
    function onUp() {
      try { pin.releasePointerCapture(ev.pointerId); } catch (e) { /* 忽略 */ }
      pin.removeEventListener("pointermove", onMove);
      pin.removeEventListener("pointerup", onUp);
      pin.removeEventListener("pointercancel", onUp);
      if (!moved) return;
      pin.dataset.dragged = "1";
      mutate("updatePlace", { id: place.id, x: place._nx, y: place._ny })
        .then(function () { toast("位置已更新"); return load(); })
        .catch(reportErr);
    }
    pin.addEventListener("pointermove", onMove);
    pin.addEventListener("pointerup", onUp);
    pin.addEventListener("pointercancel", onUp);
  });
}

/* ── 時間綫 ───────────────────────────────── */
function timelinePage() {
  var page = h("div", { class: "page" });
  var head = h("div", { class: "page-head" });
  head.appendChild(h("h1", { text: "時間綫" }));
  head.appendChild(editButton("＋ 新增節點", function () { editEvent(null); }));
  head.appendChild(h("span", { class: "page-sub", text: S.events.length + " 個節點" }));
  page.appendChild(head);

  if (!S.events.length) {
    page.appendChild(h("div", {
      class: "empty",
      text: editMode ? "還沒有節點，點右上「＋ 新增節點」。" : "這條時間綫還是空的。"
    }));
    return page;
  }

  var line = h("div", { class: "timeline" });
  S.events.forEach(function (ev, i) {
    var item = h("div", { class: "tl-item" });
    var marker = h("div", { class: "tl-marker" });
    marker.appendChild(h("span", { class: "tl-dot" }));
    item.appendChild(marker);

    var body = h("div", { class: "tl-body" });
    var topRow = h("div", { class: "tl-top" });
    if (ev.date) topRow.appendChild(h("span", { class: "tl-date", text: ev.date }));
    topRow.appendChild(h("h3", { class: "tl-title", text: ev.title || "未命名節點" }));

    var act = h("div", { class: "row-actions" });
    if (editMode) {
      if (i > 0) act.appendChild(h("button", { class: "btn small", text: "↑", title: "上移", onclick: function () { moveEvent(ev.id, -1); } }));
      if (i < S.events.length - 1) act.appendChild(h("button", { class: "btn small", text: "↓", title: "下移", onclick: function () { moveEvent(ev.id, 1); } }));
      act.appendChild(h("button", { class: "btn small", text: "編輯", onclick: function () { editEvent(ev.id); } }));
      act.appendChild(h("button", { class: "btn small danger", text: "刪除", onclick: function () { deleteEvent(ev.id); } }));
    }
    topRow.appendChild(act);
    body.appendChild(topRow);

    if (ev.body) body.appendChild(richText(ev.body, "tl-text"));
    if (csv(ev.characters).length) body.appendChild(characterChips(ev.characters));

    /* 綁定在這個節點上的故事與圖片 */
    var boundStories = S.stories.filter(function (s) { return s.eventId === ev.id; });
    var boundGallery = S.gallery.filter(function (g) { return g.eventId === ev.id; });
    if (boundStories.length || boundGallery.length) {
      var links = h("div", { class: "tl-links" });
      boundStories.forEach(function (s) {
        links.appendChild(h("a", { class: "tl-link", href: "#/stories/" + s.id, text: "▤ " + (s.title || "未命名故事") }));
      });
      boundGallery.forEach(function (g) {
        var thumb = h("a", { class: "tl-thumb", href: "javascript:void(0)", title: g.title || g.caption || "" });
        thumb.appendChild(h("img", { src: g.image, alt: g.title || "", loading: "lazy" }));
        thumb.addEventListener("click", function (e) { e.preventDefault(); openLightbox(g); });
        links.appendChild(thumb);
      });
      body.appendChild(links);
    }

    item.appendChild(body);
    line.appendChild(item);
  });
  page.appendChild(line);
  return page;
}

/* ── 畫廊 ─────────────────────────────────── */
function galleryPage() {
  var page = h("div", { class: "page" });
  var head = h("div", { class: "page-head" });
  head.appendChild(h("h1", { text: "畫廊" }));
  head.appendChild(editButton("＋ 新增圖片", function () { editGallery(null); }));
  head.appendChild(h("span", { class: "page-sub", text: S.gallery.length + " 張" }));
  page.appendChild(head);

  if (!S.gallery.length) {
    page.appendChild(h("div", {
      class: "empty",
      text: editMode ? "還沒有圖片，點右上「＋ 新增圖片」上傳。" : "畫廊還是空的。"
    }));
    return page;
  }

  var grid = h("div", { class: "gallery-grid" });
  S.gallery.forEach(function (g) {
    var cell = h("figure", { class: "gallery-cell" });
    var frame = h("div", { class: "gallery-frame" });
    frame.appendChild(h("img", { src: g.image, alt: g.title || "", loading: "lazy" }));
    if (editMode) {
      var tools = h("div", { class: "tools show" });
      tools.appendChild(h("button", { class: "btn small", text: "編輯", onclick: function (e) { e.stopPropagation(); editGallery(g.id); } }));
      tools.appendChild(h("button", { class: "btn small danger", text: "刪除", onclick: function (e) { e.stopPropagation(); deleteGallery(g.id); } }));
      frame.appendChild(tools);
    }
    frame.addEventListener("click", function () { if (editMode) return; openLightbox(g); });
    cell.appendChild(frame);

    if (g.title || g.caption) {
      var cap = h("figcaption");
      if (g.title) cap.appendChild(h("div", { class: "gallery-title", text: g.title }));
      if (g.caption) cap.appendChild(h("div", { class: "gallery-cap", text: g.caption }));
      cell.appendChild(cap);
    }
    if (csv(g.characters).length) cell.appendChild(characterChips(g.characters));
    grid.appendChild(cell);
  });
  page.appendChild(grid);
  return page;
}

function openLightbox(g) {
  var host = el("modalHost");
  host.innerHTML = "";
  var box = h("div", { class: "lightbox" },
    h("img", { src: g.image, alt: g.title || "" })
  );
  if (g.title || g.caption) {
    box.appendChild(h("div", { class: "lightbox-cap" },
      g.title ? h("b", { text: g.title }) : null,
      g.caption ? h("span", { text: g.caption }) : null
    ));
  }
  var overlay = h("div", { class: "modal-overlay lightbox-overlay" }, box);
  overlay.addEventListener("click", function () { host.innerHTML = ""; });
  host.appendChild(overlay);
}

/* ── 故事 ─────────────────────────────────── */
function storiesPage() {
  var page = h("div", { class: "page" });
  var head = h("div", { class: "page-head" });
  head.appendChild(h("h1", { text: "背景故事" }));
  head.appendChild(editButton("＋ 新增故事", function () { editStory(null); }));
  head.appendChild(h("span", { class: "page-sub", text: S.stories.length + " 篇" }));
  page.appendChild(head);

  if (!S.stories.length) {
    page.appendChild(h("div", {
      class: "empty",
      text: editMode ? "還沒有故事，點右上「＋ 新增故事」。" : "這個世界還沒有寫下任何故事。"
    }));
    return page;
  }
  page.appendChild(h("div", { class: "grid two" }, S.stories.map(storyCard)));
  return page;
}

function storyCard(s) {
  var card = h("a", { class: "card story-card", href: "#/stories/" + s.id });
  card.appendChild(h("h3", { text: s.title || "未命名故事" }));
  var who = csv(s.characters).map(function (id) {
    var c = byId(S.characters, id);
    return c ? c.name : null;
  }).filter(Boolean);
  var meta = [];
  if (who.length) meta.push(who.join("、"));
  csv(s.tags).forEach(function (t) { meta.push("#" + t); });
  card.appendChild(h("div", { class: "meta", text: meta.join(" · ") }));
  var plain = String(s.body || "").replace(/[*>#]/g, "").replace(/\s+/g, " ").trim();
  if (plain) card.appendChild(h("p", { class: "excerpt", text: plain }));
  return card;
}

function storyPage(id) {
  var page = h("div", { class: "page" });
  var s = byId(S.stories, id);
  page.appendChild(backLink("#/stories", "← 回到故事列表"));
  if (!s) {
    page.appendChild(h("div", { class: "empty", text: "找不到這篇故事。" }));
    return page;
  }

  var article = h("div", { class: "article" });
  article.appendChild(h("h1", { text: s.title || "未命名故事" }));
  var meta = [];
  var tags = csv(s.tags);
  if (tags.length) meta.push(tags.map(function (t) { return "#" + t; }).join("  "));
  article.appendChild(h("div", { class: "meta", text: meta.join(" · ") }));
  var boundEv = byId(S.events, s.eventId);
  if (boundEv) {
    article.appendChild(h("a", {
      class: "chip rel event-chip",
      href: "#/timeline",
      text: "◷ " + (boundEv.date ? boundEv.date + " · " : "") + (boundEv.title || "時間綫節點")
    }));
  }
  article.appendChild(editButton("編輯這篇故事", function () { editStory(id); }));
  article.appendChild(richText(s.body || ""));

  var who = csv(s.characters).map(function (cid) { return byId(S.characters, cid); }).filter(Boolean);
  if (who.length) {
    var row = h("div", { class: "who-row" });
    who.forEach(function (c) {
      row.appendChild(h("a", { class: "chip faction", href: "#/characters/" + c.id, text: c.name }));
    });
    article.appendChild(row);
  }
  page.appendChild(article);
  return page;
}

/* ── 表單定義 ─────────────────────────────── */
function characterFields() {
  return [
    { group: "基本資料", k: "name", label: "名字", required: true, ph: "例：角色名字" },
    { k: "alias", label: "別名 / 稱號", ph: "例：英文名、外號" },
    { k: "role", label: "定位", ph: "主角 / 反派 / 旁觀者…" },
    { k: "faction", label: "陣營 / 所屬", type: "datalist", ph: "例：魔法少女" },
    { k: "age", label: "年齡 / 存在時間", ph: "例：重生前 24／重生後 16" },
    { k: "birthday", label: "生日", ph: "例：4月22日" },
    { k: "height", label: "身高", ph: "例：170cm" },
    { k: "bloodType", label: "血型", ph: "例：A" },
    { k: "tags", label: "標籤", ph: "逗號分隔，例：耳機,怕熱" },
    { k: "summary", label: "一句話介紹", type: "textarea", rows: 2, wide: true },

    { group: "外貌與形象", k: "hair", label: "髮型／髮色", ph: "變身前後可分開寫" },
    { k: "eyes", label: "眼睛", ph: "" },
    { k: "outfit", label: "平常穿著", ph: "" },
    { k: "habit", label: "特徵／小動作", ph: "" },
    { k: "keepsake", label: "隨身物品／代表物", ph: "" },
    { k: "color", label: "代表色", ph: "" },
    { k: "transformLook", label: "變身／戰鬥外觀", wide: true, ph: "" },

    { group: "性格", k: "personality", label: "三個形容詞", wide: true, ph: "例：獨立、避世、孤單" },
    { k: "catchphrase", label: "口頭禪", ph: "例：我草" },
    { k: "firstImpression", label: "第一印象", ph: "別人第一眼怎麼看她" },
    { k: "strengths", label: "強項", ph: "" },
    { k: "flaw", label: "缺點", ph: "" },
    { k: "petPeeve", label: "地雷", type: "textarea", rows: 2, wide: true, ph: "踩到會怎樣" },
    { k: "fear", label: "害怕的東西", ph: "" },
    { k: "coping", label: "壓力大時", ph: "" },

    { group: "劇情", k: "want", label: "最想要的", type: "textarea", rows: 2, wide: true, ph: "" },
    { k: "loseFear", label: "最怕失去的", type: "textarea", rows: 2, wide: true, ph: "" },
    { k: "secret", label: "不能說的秘密", type: "textarea", rows: 2, wide: true, ph: "" },

    { group: "能力", k: "transformName", label: "變身型態名稱", ph: "例：白雨" },
    { k: "cost", label: "代價", ph: "例：過度嗜睡" },
    { k: "weakPoint", label: "弱點", ph: "例：怕熱" },
    { k: "ability", label: "能力效果", type: "textarea", rows: 2, wide: true, ph: "" },
    { k: "abilityLimit", label: "限制", type: "textarea", rows: 2, wide: true, ph: "不能做什麼" },

    { group: "背景", k: "family", label: "家人", type: "textarea", rows: 2, wide: true, ph: "" },
    { k: "pastLife", label: "倒流前（上一輪）", type: "textarea", rows: 3, wide: true, ph: "這段日子怎麼過的" },
    { k: "story", label: "背景故事", type: "textarea", rows: 8, wide: true, ph: "空行分段；支援 **粗體**、*斜體*、> 引用" },
    { k: "image", label: "角色圖", type: "image", wide: true }
  ];
}

function relationFields(defaultFrom, defaultTo) {
  var opts = S.characters.map(function (c) { return { value: c.id, label: c.name || "未命名" }; });
  return [
    { group: "關係", k: "fromId", label: "起點人物", type: "select", options: opts, required: true, default: defaultFrom || "" },
    { k: "toId", label: "終點人物", type: "select", options: opts, required: true, default: defaultTo || "" },
    { k: "type", label: "關係類型", type: "select", options: REL_TYPES.map(function (t) { return { value: t, label: t }; }), required: true },
    { k: "note", label: "關係說明", type: "textarea", rows: 3, wide: true, ph: "這段關係的來由、張力、秘密…" }
  ];
}

function storyFields() {
  return [
    { group: "故事", k: "title", label: "標題", required: true, wide: true },
    { k: "tags", label: "標籤", ph: "逗號分隔" },
    { k: "eventId", label: "綁定時間綫節點", type: "select", options: eventOptions() },
    { k: "characters", label: "涉及人物", type: "multi", options: S.characters.map(function (c) { return { value: c.id, label: c.name || "未命名" }; }), wide: true },
    { k: "body", label: "內容", type: "textarea", rows: 12, wide: true, ph: "空行分段；支援 **粗體**、*斜體*、> 引用" }
  ];
}

function worldFields() {
  return [
    { k: "name", label: "世界名稱", required: true },
    { k: "era", label: "紀元 / 時間", ph: "例：王曆 312 年" },
    { k: "tagline", label: "一句話標語", wide: true },
    { k: "intro", label: "世界簡介", type: "textarea", rows: 6, wide: true, ph: "空行分段；支援 **粗體**、> 引用" },
    { k: "accent", label: "主色", ph: "#5d7180" },
    { k: "footer", label: "頁尾文字" }
  ];
}

function placeFields() {
  return [
    { group: "地點", k: "name", label: "地點名稱", required: true, wide: true, ph: "例：學校天台" },
    { k: "category", label: "類型", ph: "例：學校／住宅／戰場" },
    { k: "note", label: "說明", type: "textarea", rows: 4, wide: true, ph: "在這裡發生過什麼；支援 **粗體**、> 引用" },
    { k: "characters", label: "相關人物", type: "multi", options: S.characters.map(function (c) { return { value: c.id, label: c.name || "未命名" }; }), wide: true }
  ];
}

function eventFields() {
  return [
    { group: "時間綫節點", k: "title", label: "節點標題", required: true, wide: true, ph: "例：第一次變身" },
    { k: "date", label: "時間標記", ph: "例：2017 年 9 月／中四上學期" },
    { k: "body", label: "內容", type: "textarea", rows: 5, wide: true, ph: "空行分段；支援 **粗體**、> 引用" },
    { k: "characters", label: "涉及人物", type: "multi", options: S.characters.map(function (c) { return { value: c.id, label: c.name || "未命名" }; }), wide: true }
  ];
}

function galleryFields() {
  return [
    { group: "畫廊圖片", k: "image", label: "圖片", type: "image", wide: true, required: true },
    { k: "title", label: "標題", wide: true, ph: "例：白雨・設定圖" },
    { k: "caption", label: "說明", type: "textarea", rows: 2, wide: true, ph: "" },
    { k: "characters", label: "相關人物", type: "multi", options: S.characters.map(function (c) { return { value: c.id, label: c.name || "未命名" }; }), wide: true },
    { k: "eventId", label: "綁定時間綫節點", type: "select", options: eventOptions(), wide: true }
  ];
}

/* ── 表單建構 ─────────────────────────────── */
function val(item, k) {
  var v = item ? item[k] : "";
  return v === null || v === undefined ? "" : String(v);
}

function collectForm(form, fields) {
  var out = {};
  fields.forEach(function (f) {
    if (f.type === "multi") {
      var box = form.querySelector('[data-multi="' + f.k + '"]');
      var checked = box ? box.querySelectorAll("input:checked") : [];
      var ids = [];
      for (var i = 0; i < checked.length; i++) ids.push(checked[i].value);
      out[f.k] = ids.join(",");
    } else {
      var node = form.querySelector('[name="' + f.k + '"]');
      out[f.k] = node ? String(node.value).trim() : "";
    }
  });
  return out;
}

function buildForm(fields, item) {
  var form = h("form", { class: "form" });

  if (fields.some(function (f) { return f.type === "datalist"; })) {
    var dl = h("datalist", { id: "factionList" });
    uniqueFactions().forEach(function (f) { dl.appendChild(h("option", { value: f })); });
    form.appendChild(dl);
  }

  var lastGroup = "";
  fields.forEach(function (f) {
    if (f.group && f.group !== lastGroup) {
      form.appendChild(h("div", { class: "form-group-title", text: f.group }));
      lastGroup = f.group;
    }
    var wrap = h("div", { class: "field" + (f.wide ? " wide" : "") });
    wrap.appendChild(h("span", { class: "field-label", text: f.label + (f.required ? " *" : "") }));
    var control;

    if (f.type === "textarea") {
      control = h("textarea", { name: f.k, rows: String(f.rows || 4), placeholder: f.ph || "" });
      control.value = val(item, f.k);
    } else if (f.type === "select") {
      control = h("select", { name: f.k });
      if (!f.required) control.appendChild(h("option", { value: "", text: "（未選）" }));
      (f.options || []).forEach(function (o) {
        control.appendChild(h("option", { value: o.value, text: o.label }));
      });
      control.value = val(item, f.k) || f.default || "";
    } else if (f.type === "multi") {
      var box = h("div", { class: "multi", "data-multi": f.k });
      var current = csv(val(item, f.k));
      var options = f.options || [];
      if (!options.length) box.appendChild(h("span", { class: "hint", text: "先新增人物，才能標註涉及人物。" }));
      options.forEach(function (o) {
        var id = "m_" + f.k + "_" + o.value;
        var cb = h("input", { type: "checkbox", id: id, value: o.value });
        cb.checked = current.indexOf(o.value) >= 0;
        box.appendChild(h("label", { for: id }, cb, h("span", { text: o.label })));
      });
      control = box;
    } else if (f.type === "image") {
      var row = h("div", { class: "image-field" });
      var text = h("input", { type: "text", name: f.k, placeholder: "media/xxx.png 或圖片網址" });
      text.value = val(item, f.k);
      var preview = h("img", { class: "image-preview", alt: "" });
      var src0 = imageSrc(text.value);
      if (src0) preview.src = src0; else preview.style.visibility = "hidden";
      var upBtn = h("button", { type: "button", class: "btn small", text: "上傳" });
      upBtn.addEventListener("click", function () { pickUpload(text, preview); });
      text.addEventListener("input", function () {
        var src = imageSrc(text.value);
        if (src) { preview.src = src; preview.style.visibility = "visible"; }
        else { preview.style.visibility = "hidden"; }
      });
      row.appendChild(text);
      row.appendChild(preview);
      row.appendChild(upBtn);
      control = row;
    } else {
      control = h("input", { type: "text", name: f.k, placeholder: f.ph || "" });
      control.value = val(item, f.k);
      if (f.type === "datalist") control.setAttribute("list", "factionList");
    }

    wrap.appendChild(control);
    if (f.hint) wrap.appendChild(h("span", { class: "hint", text: f.hint }));
    form.appendChild(wrap);
  });

  return form;
}

function openFormModal(opts) {
  var host = el("modalHost");
  host.innerHTML = "";

  var form = buildForm(opts.fields, opts.item || {});
  var actions = h("div", { class: "modal-actions" });

  if (opts.onDelete) {
    var del = h("button", { type: "button", class: "btn small danger left", text: "刪除" });
    del.addEventListener("click", function () { close(); opts.onDelete(); });
    actions.appendChild(del);
  }
  var cancel = h("button", { type: "button", class: "btn", text: "取消" });
  cancel.addEventListener("click", close);
  var save = h("button", { type: "submit", class: "btn primary", text: "儲存" });
  actions.appendChild(cancel);
  actions.appendChild(save);
  form.appendChild(actions);

  var modal = h("div", { class: "modal" }, h("h2", { text: opts.title }));
  if (opts.hint) modal.appendChild(h("p", { class: "modal-hint", text: opts.hint }));
  modal.appendChild(form);
  var overlay = h("div", { class: "modal-overlay" }, modal);
  overlay.addEventListener("click", function (e) { if (e.target === overlay) close(); });

  function close() {
    host.innerHTML = "";
    document.removeEventListener("keydown", onKey);
  }
  function onKey(e) { if (e.key === "Escape") close(); }
  document.addEventListener("keydown", onKey);

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var values = collectForm(form, opts.fields);
    var missing = opts.fields.filter(function (f) {
      return f.required && !String(values[f.k] || "").trim();
    });
    if (missing.length) {
      toast("請填寫：" + missing.map(function (f) { return f.label; }).join("、"), true);
      return;
    }
    save.disabled = true;
    save.textContent = "儲存中…";
    opts.onSubmit(values, close, function resetSave() {
      save.disabled = false;
      save.textContent = "儲存";
    });
  });

  host.appendChild(overlay);
  var first = form.querySelector("input:not([type=checkbox]),textarea,select");
  if (first) setTimeout(function () { first.focus(); }, 40);
}

/* ── 圖片上傳 ─────────────────────────────── */
function uploadImage(onDone) {
  if (!sdk) { toast("唯讀模式無法上傳圖片", true); return; }
  uploadHandler = onDone;
  el("fileInput").click();
}

function pickUpload(textInput, preview) {
  uploadImage(function (relPath) {
    textInput.value = relPath;
    var src = imageSrc(relPath);
    if (src) { preview.src = src; preview.style.visibility = "visible"; }
    toast("圖片已上傳");
  });
}

function initUpload() {
  el("fileInput").addEventListener("change", function () {
    var input = el("fileInput");
    var file = input.files && input.files[0];
    input.value = "";
    if (!file || !uploadHandler) return;
    var cb = uploadHandler;
    uploadHandler = null;
    sdk.uploadFile({ dirPath: MEDIA_DIR, data: file }).then(function (res) {
      cb(stripPrefix(res.path));
    }).catch(function (err) {
      toast("圖片上傳失敗：" + String((err && err.message) || err), true);
    });
  });
}

/* ── 增刪改 ───────────────────────────────── */
var KINDS = {
  character: { add: "addCharacter", update: "updateCharacter", list: function () { return S.characters; } },
  relation: { add: "addRelation", update: "updateRelation", list: function () { return S.relations; } },
  story: { add: "addStory", update: "updateStory", list: function () { return S.stories; } },
  place: { add: "addPlace", update: "updatePlace", list: function () { return S.places; } },
  event: { add: "addEvent", update: "updateEvent", list: function () { return S.events; } },
  gallery: { add: "addGallery", update: "updateGallery", list: function () { return S.gallery; } }
};

function nextOrder(list) {
  return list.reduce(function (max, x) { return Math.max(max, (x.order || 0) + 1); }, 0);
}

function saveEntity(kind, values, id, extra) {
  var def = KINDS[kind];
  var args = {};
  Object.keys(values).forEach(function (k) { args[k] = values[k]; });
  if (extra) Object.keys(extra).forEach(function (k) { args[k] = extra[k]; });
  var promise;
  if (!id) {
    args.order = nextOrder(def.list());
    promise = mutate(def.add, args);
  } else {
    args.id = id;
    promise = mutate(def.update, args);
  }
  return promise.then(function () {
    toast(id ? "已更新" : "已新增");
    return load();
  }).catch(function (err) {
    reportErr(err);
    throw err;
  });
}

function editCharacter(id) {
  if (!sdk) { toast("唯讀模式無法編輯", true); return; }
  var item = id ? byId(S.characters, id) : null;
  openFormModal({
    title: item ? "編輯人物：" + (item.name || "") : "新增人物",
    fields: characterFields(),
    item: item || {},
    onSubmit: function (values, close, resetSave) {
      saveEntity("character", values, id).then(close, resetSave);
    },
    onDelete: item ? function () { deleteCharacter(id); } : null
  });
}

function editRelation(id, presetFrom, presetTo) {
  if (!sdk) { toast("唯讀模式無法編輯", true); return; }
  if (S.characters.length < 2) { toast("先新增至少兩位人物", true); return; }
  var item = id ? byId(S.relations, id) : null;
  var fields = relationFields(presetFrom, presetTo);
  openFormModal({
    title: item ? "編輯關係" : "新增關係",
    fields: fields,
    item: item || {},
    onSubmit: function (values, close, resetSave) {
      if (values.fromId === values.toId) { toast("起點與終點不能是同一位人物", true); resetSave(); return; }
      saveEntity("relation", values, id).then(close, resetSave);
    },
    onDelete: item ? function () { deleteRelation(id); } : null
  });
}

function editStory(id) {
  if (!sdk) { toast("唯讀模式無法編輯", true); return; }
  var item = id ? byId(S.stories, id) : null;
  openFormModal({
    title: item ? "編輯故事" : "新增故事",
    fields: storyFields(),
    item: item || {},
    onSubmit: function (values, close, resetSave) {
      saveEntity("story", values, id).then(close, resetSave);
    },
    onDelete: item ? function () { deleteStory(id); } : null
  });
}

function editWorld() {
  if (!sdk) { toast("唯讀模式無法編輯", true); return; }
  openFormModal({
    title: "世界設定",
    fields: worldFields(),
    item: S.world,
    onSubmit: function (values, close, resetSave) {
      mutate("updateWorld", values).then(function () {
        toast("已更新世界設定");
        return load();
      }).then(close, resetSave);
    }
  });
}

function editPlace(id, x, y) {
  if (!sdk) { toast("唯讀模式無法編輯", true); return; }
  var item = id ? byId(S.places, id) : null;
  var isNew = !item;
  openFormModal({
    title: isNew ? "新增地點" : "編輯地點：" + (item.name || ""),
    hint: isNew ? "位置：" + x + "%, " + y + "%（建立後可在地圖上拖動）" : "可在地圖上直接拖動標點調整位置。",
    fields: placeFields(),
    item: item || {},
    onSubmit: function (values, close, resetSave) {
      var extra = isNew ? { x: x, y: y } : null;
      saveEntity("place", values, id, extra).then(close, resetSave);
    },
    onDelete: item ? function () { deletePlace(id); } : null
  });
}

function deletePlace(id) {
  var p = byId(S.places, id);
  if (!p) return;
  if (!window.confirm("刪除地點「" + (p.name || "未命名") + "」？")) return;
  if (selectedPlace === id) selectedPlace = null;
  mutate("removePlace", { id: id }).then(function () {
    toast("已刪除地點");
    return load();
  }).catch(reportErr);
}

function editEvent(id) {
  if (!sdk) { toast("唯讀模式無法編輯", true); return; }
  var item = id ? byId(S.events, id) : null;
  openFormModal({
    title: item ? "編輯節點" : "新增時間綫節點",
    fields: eventFields(),
    item: item || {},
    onSubmit: function (values, close, resetSave) {
      saveEntity("event", values, id).then(close, resetSave);
    },
    onDelete: item ? function () { deleteEvent(id); } : null
  });
}

function deleteEvent(id) {
  var ev = byId(S.events, id);
  if (!ev) return;
  if (!window.confirm("刪除節點「" + (ev.title || "未命名") + "」？")) return;
  mutate("removeEvent", { id: id }).then(function () {
    toast("已刪除節點");
    return load();
  }).catch(reportErr);
}

function moveEvent(id, dir) {
  var ids = S.events.map(function (e) { return e.id; });
  var i = ids.indexOf(id);
  var j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return;
  ids.splice(j, 0, ids.splice(i, 1)[0]);
  var chain = Promise.resolve();
  ids.forEach(function (eid, index) {
    var ev = byId(S.events, eid);
    if (!ev || ev.order === index) return;
    chain = chain.then(function () { return mutate("updateEvent", { id: eid, order: index }); });
  });
  chain.then(load).catch(reportErr);
}

function editGallery(id, presetChar) {
  if (!sdk) { toast("唯讀模式無法編輯", true); return; }
  var item = id ? byId(S.gallery, id) : null;
  openFormModal({
    title: item ? "編輯圖片" : "新增畫廊圖片",
    fields: galleryFields(),
    item: item || { characters: presetChar || "" },
    onSubmit: function (values, close, resetSave) {
      saveEntity("gallery", values, id).then(close, resetSave);
    },
    onDelete: item ? function () { deleteGallery(id); } : null
  });
}

function deleteGallery(id) {
  var g = byId(S.gallery, id);
  if (!g) return;
  if (!window.confirm("刪除這張圖片？")) return;
  mutate("removeGallery", { id: id }).then(function () {
    toast("已刪除圖片");
    return load();
  }).catch(reportErr);
}

function deleteRelation(id) {
  var r = byId(S.relations, id);
  if (!r) return;
  var a = byId(S.characters, r.fromId), b = byId(S.characters, r.toId);
  if (!window.confirm("刪除關係：" + (a ? a.name : "?") + " → " + (b ? b.name : "?") + "（" + r.type + "）？")) return;
  mutate("removeRelation", { id: id }).then(function () {
    toast("已刪除關係");
    return load();
  }).catch(reportErr);
}

function deleteStory(id) {
  var s = byId(S.stories, id);
  if (!s) return;
  if (!window.confirm("刪除故事「" + (s.title || "未命名") + "」？")) return;
  mutate("removeStory", { id: id }).then(function () {
    toast("已刪除故事");
    return load();
  }).catch(reportErr);
}

function deleteCharacter(id) {
  var c = byId(S.characters, id);
  if (!c) return;
  var rels = S.relations.filter(function (r) { return r.fromId === id || r.toId === id; });
  var inStories = S.stories.filter(function (s) { return csv(s.characters).indexOf(id) >= 0; });

  var msg = "刪除人物「" + (c.name || "未命名") + "」？";
  if (rels.length) msg += "\n相關的 " + rels.length + " 條關係會一併刪除。";
  if (inStories.length) msg += "\n" + inStories.length + " 篇故事中的標註會被移除。";
  if (!window.confirm(msg)) return;

  var chain = Promise.resolve();
  rels.forEach(function (r) {
    chain = chain.then(function () { return mutate("removeRelation", { id: r.id }); });
  });
  inStories.forEach(function (s) {
    chain = chain.then(function () {
      var rest = csv(s.characters).filter(function (x) { return x !== id; }).join(",");
      return mutate("updateStory", { id: s.id, characters: rest });
    });
  });
  chain.then(function () { return mutate("removeCharacter", { id: id }); })
    .then(function () { toast("已刪除人物"); return load(); })
    .catch(reportErr);
}

/* ── 啟動 ─────────────────────────────────── */
function init() {
  initUpload();

  el("editToggle").addEventListener("click", function () {
    if (!sdk) return;
    editMode = !editMode;
    el("editToggle").classList.toggle("on", editMode);
    el("editToggle").textContent = editMode ? "完成編輯" : "編輯模式";
    el("modalHost").innerHTML = "";
    render();
    toast(editMode ? "編輯模式：可以新增與修改內容" : "已離開編輯模式");
  });

  window.addEventListener("hashchange", function () {
    render();
    window.scrollTo(0, 0);
  });

  detectSdk().then(function (found) {
    sdk = found;
    readOnly = !sdk;
    el("editToggle").hidden = !sdk;
    el("roTag").hidden = !readOnly;

    if (sdk && sdk.events && sdk.events.on) {
      sdk.events.on("file:update", { path: DATA_FILE }, function () {
        if (document.querySelector(".modal-overlay")) return;
        if (document.activeElement && document.activeElement.tagName === "TEXTAREA") return;
        load().catch(function () { /* 忽略 */ });
      });
    }

    return load().then(function () {
      var curtain = el("curtain");
      if (curtain) setTimeout(function () { curtain.classList.add("gone"); }, 260);
    });
  }).catch(function (err) {
    el("view").innerHTML = "";
    el("view").appendChild(h("div", {
      class: "empty",
      text: "資料讀取失敗：" + String((err && err.message) || err)
    }));
    var curtain = el("curtain");
    if (curtain) curtain.classList.add("gone");
  });
}

init();
