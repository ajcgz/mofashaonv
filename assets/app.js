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
var S = { world: {}, map: {}, characters: [], relations: [], stories: [], places: [], events: [], gallery: [], entries: [], music: [] };
var sdk = null;
var editMode = false;
var readOnly = false;
var uploadHandler = null;
var audioHandler = null;

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

/* ── 角色配色 ─────────────────────────────── */
var COLOR_MAP = {
  "水藍": "#3f8fbf", "藍綠色": "#2f8f8f", "藍綠": "#2f8f8f", "藍": "#2f6f9e", "青": "#2f8f8f", "綠": "#3f8f5f", "紫": "#7a4fa3",
  "紅": "#b4443a", "粉": "#c2506f", "橙": "#d9762f", "黃": "#c9a227", "金": "#b8912f",
  "白": "#8f9aa1", "黑": "#3a3f44", "灰": "#7b8b96", "棕": "#8d5a3a", "銀": "#8fa0aa"
};

function resolveCharColor(c) {
  var v = String((c && c.color) || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v;
  if (v && COLOR_MAP[v]) return COLOR_MAP[v];
  for (var k in COLOR_MAP) {
    if (v && v.indexOf(k) >= 0) return COLOR_MAP[k];
  }
  var seed = String((c && (c.id || c.name)) || "x");
  var hash = 0;
  for (var i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  var palette = ["#2f6f9e", "#7a4fa3", "#3f8f5f", "#b4443a", "#d9762f", "#8d5a3a"];
  return palette[hash % palette.length];
}

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
  var text = msg;
  if (msg && typeof msg === "object") {
    text = msg.message || "";
    if (msg.description) text += " · " + msg.description;
    isError = msg.variant === "error";
  }
  t.textContent = text;
  t.classList.toggle("error", !!isError);
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2800);
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
  var cfg = ghConfig();
  if (cfg && !(S.raw && Date.now() < ghSkipFetchUntil)) {
    var url = "https://raw.githubusercontent.com/" + cfg.owner + "/" + cfg.repo +
      "/" + encodeURIComponent(cfg.branch) + "/" + GH_PATH + "?v=" + Date.now();
    return fetch(url, { cache: "no-store" }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    });
  }
  return fetch(DATA_URL, { cache: "no-store" }).then(function (res) {
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  });
}

function applyDoc(doc) {
  S.raw = doc || {};
  S.world = (doc && doc.world) || {};
  S.map = (doc && doc.map) || {};
  S.characters = ((doc && doc.characters) || []).slice().sort(sortByOrder);
  S.relations = ((doc && doc.relations) || []).slice().sort(sortByOrder);
  S.stories = ((doc && doc.stories) || []).slice().sort(sortByOrder);
  S.places = ((doc && doc.places) || []).slice().sort(sortByOrder);
  S.events = ((doc && doc.events) || []).slice().sort(sortByOrder);
  S.gallery = ((doc && doc.gallery) || []).slice().sort(sortByOrder);
  S.entries = ((doc && doc.entries) || []).slice().sort(sortByOrder);
  S.music = ((doc && doc.music) || []).slice().sort(sortByOrder);
}

function mutate(name, args) {
  if (sdk) return sdk.data.mutate({ file: DATA_FILE, name: name, args: args });
  if (ghConfig()) return ghMutate(name, args);
  return Promise.reject(new Error("唯讀模式無法寫入"));
}

function load() {
  if (!sdk && S.raw && Date.now() < ghSkipFetchUntil) {
    render();
    return Promise.resolve();
  }
  return readData().then(function (all) {
    applyDoc(all);
    render();
  });
}

/* ── GitHub 直寫：讓發佈版也能編輯 ─────────── */
var GH_KEY = "oc-world:github";
var GH_PATH = "data/world.data.json";   /* repo 根目錄相對路徑 */
var GH_MEDIA = "media";
var ghSkipFetchUntil = 0;

function ghConfig() {
  /* 雲端寫入（GitHub Token）已停用：只在 Spherse 內直接寫入資料檔 */
  return null;
}
function ghSaveConfig(cfg) { localStorage.setItem(GH_KEY, JSON.stringify(cfg)); }
function ghClearConfig() { localStorage.removeItem(GH_KEY); }

function ghHeaders(cfg) {
  return {
    "Authorization": "Bearer " + cfg.token,
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json"
  };
}

function b64encode(str) {
  var bytes = new TextEncoder().encode(str);
  var bin = "";
  for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function ghContentsUrl(cfg, path) {
  var seg = path.split("/").map(encodeURIComponent).join("/");
  return "https://api.github.com/repos/" + cfg.owner + "/" + cfg.repo + "/contents/" + seg;
}

function ghGetSha(cfg, path) {
  return fetch(ghContentsUrl(cfg, path) + "?ref=" + encodeURIComponent(cfg.branch), { headers: ghHeaders(cfg) })
    .then(function (res) {
      if (res.status === 404) return null;
      return res.json().then(function (data) {
        if (!res.ok) throw new Error(data.message || ("讀取失敗 " + res.status));
        return data.sha;
      });
    });
}

function ghPutFile(cfg, path, content, message, alreadyBase64) {
  return ghGetSha(cfg, path).then(function (sha) {
    var body = {
      message: message,
      content: alreadyBase64 ? content : b64encode(content),
      branch: cfg.branch
    };
    if (sha) body.sha = sha;
    return fetch(ghContentsUrl(cfg, path), {
      method: "PUT",
      headers: ghHeaders(cfg),
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) throw new Error(data.message || ("寫入失敗 " + res.status));
        return data;
      });
    });
  });
}

/* 本機端 mutation 引擎：與 $manifest 同名同語義 */
var CHAR_FIELDS = ["name", "alias", "role", "faction", "age", "birthday", "height", "bloodType",
  "tags", "summary", "story", "image", "hair", "eyes", "outfit", "habit", "keepsake", "color",
  "transformName", "transformLook", "ability", "abilityLimit", "cost", "weakPoint", "personality",
  "strengths", "flaw", "petPeeve", "fear", "coping", "firstImpression", "family", "pastLife",
  "catchphrase", "want", "loseFear", "secret", "status", "trivia", "quotes", "bgm",
  "voiceActor", "imprintSong", "stats", "outfits", "forms", "order"];

var STORY_FIELDS = ["eventId", "title", "body", "characters", "tags", "pov", "form", "order"];

var OPS = {
  updateWorld: { op: "set", path: "world", fields: ["name", "tagline", "intro", "era", "accent", "footer"] },
  updateMap: { op: "set", path: "map", fields: ["image", "note"] },
  addCharacter: { op: "append", path: "characters", fields: CHAR_FIELDS, auto: true },
  updateCharacter: { op: "update", path: "characters", fields: CHAR_FIELDS },
  removeCharacter: { op: "remove", path: "characters" },
  addRelation: { op: "append", path: "relations", fields: ["fromId", "toId", "type", "note", "order"], auto: true },
  updateRelation: { op: "update", path: "relations", fields: ["fromId", "toId", "type", "note", "order"] },
  removeRelation: { op: "remove", path: "relations" },
  addStory: { op: "append", path: "stories", fields: STORY_FIELDS, auto: true },
  updateStory: { op: "update", path: "stories", fields: STORY_FIELDS },
  removeStory: { op: "remove", path: "stories" },
  addPlace: { op: "append", path: "places", fields: ["name", "category", "note", "characters", "x", "y", "order"], auto: true },
  updatePlace: { op: "update", path: "places", fields: ["name", "category", "note", "characters", "x", "y", "order"] },
  removePlace: { op: "remove", path: "places" },
  addEvent: { op: "append", path: "events", fields: ["title", "date", "body", "characters", "order"], auto: true },
  updateEvent: { op: "update", path: "events", fields: ["title", "date", "body", "characters", "order"] },
  removeEvent: { op: "remove", path: "events" },
  addGallery: { op: "append", path: "gallery", fields: ["eventId", "title", "image", "caption", "characters", "order"], auto: true },
  updateGallery: { op: "update", path: "gallery", fields: ["eventId", "title", "image", "caption", "characters", "order"] },
  removeGallery: { op: "remove", path: "gallery" },
  addEntry: { op: "append", path: "entries", fields: ["title", "category", "summary", "body", "related", "order"], auto: true },
  updateEntry: { op: "update", path: "entries", fields: ["title", "category", "summary", "body", "related", "order"] },
  removeEntry: { op: "remove", path: "entries" },
  addMusic: { op: "append", path: "music", fields: ["title", "src", "page", "order"], auto: true },
  updateMusic: { op: "update", path: "music", fields: ["title", "src", "page", "order"] },
  removeMusic: { op: "remove", path: "music" }
};

function pickFields(args, fields) {
  var out = {};
  fields.forEach(function (k) { if (args[k] !== undefined) out[k] = args[k]; });
  return out;
}

function newId() {
  if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
  return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

function applyLocalMutation(doc, name, args) {
  var spec = OPS[name];
  if (!spec) throw new Error("未支援的操作：" + name);
  args = args || {};

  if (spec.op === "set") {
    var target = Object.assign({}, doc[spec.path] || {}, pickFields(args, spec.fields));
    doc[spec.path] = target;
    return JSON.parse(JSON.stringify(target));
  }

  if (!doc[spec.path]) doc[spec.path] = [];
  var list = doc[spec.path];

  if (spec.op === "append") {
    var item = pickFields(args, spec.fields);
    if (spec.auto) {
      item.id = newId();
      item.createdAt = new Date().toISOString();
    }
    list.push(item);
    return JSON.parse(JSON.stringify(item));
  }

  var idx = -1;
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === args.id) { idx = i; break; }
  }
  if (idx < 0) throw new Error("找不到項目：" + args.id);

  if (spec.op === "update") {
    var patch = pickFields(args, spec.fields);
    Object.keys(patch).forEach(function (k) { list[idx][k] = patch[k]; });
    return JSON.parse(JSON.stringify(list[idx]));
  }
  if (spec.op === "remove") {
    var removed = list.splice(idx, 1)[0];
    return JSON.parse(JSON.stringify(removed));
  }
  throw new Error("未知的操作類型");
}

function ghMutate(name, args) {
  var cfg = ghConfig();
  if (!cfg) return Promise.reject(new Error("尚未設定 GitHub"));

  var backup = S.raw;
  var draft = JSON.parse(JSON.stringify(S.raw || {}));
  var result;
  try {
    result = applyLocalMutation(draft, name, args);
  } catch (e) {
    return Promise.reject(e);
  }

  var text = JSON.stringify(draft, null, 2) + "\n";
  var stamp = new Date().toLocaleString("zh-HK", { hour12: false });
  return ghPutFile(cfg, GH_PATH, text, "更新：" + name + "（" + stamp + "）")
    .then(function () {
      applyDoc(draft);
      ghSkipFetchUntil = Date.now() + 90000;
      render();
      return result;
    })
    .catch(function (err) {
      S.raw = backup;
      throw err;
    });
}

function ghUpload(file) {
  var cfg = ghConfig();
  if (!cfg) return Promise.reject(new Error("尚未設定 GitHub"));
  var ext = (file.name.match(/\.[A-Za-z0-9]+$/) || [""])[0].toLowerCase();
  var base = (file.name.replace(/\.[^.]+$/, "") || "image")
    .replace(/[^\w\u4e00-\u9fa5-]+/g, "-").slice(0, 40);
  var name = base + "-" + Date.now().toString(36) + ext;
  var path = GH_MEDIA + "/" + name;
  return new Promise(function (resolve, reject) {
    var fr = new FileReader();
    fr.onload = function () {
      var dataUrl = String(fr.result);
      var b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
      ghPutFile(cfg, path, b64, "上傳圖片：" + name, true)
        .then(function () { resolve("media/" + name); })
        .catch(reject);
    };
    fr.onerror = function () { reject(new Error("讀取檔案失敗")); };
    fr.readAsDataURL(file);
  });
}

/* ── GitHub 設定視窗（已停用：ghConfig() 永遠回傳 null，這個彈窗不會被打開） ── */
function openGhSettings() {
  var host = el("modalHost");
  host.innerHTML = "";
  var cfg = ghConfig() || { owner: "", repo: "", branch: "main", token: "" };

  function makeField(label, key, ph, type) {
    var wrap = h("div", { class: "field" + (type === "textarea" ? " wide" : "") });
    wrap.appendChild(h("span", { class: "field-label", text: label }));
    var input = h("input", { type: "text", placeholder: ph || "" });
    input.value = cfg[key] || "";
    input.dataset.key = key;
    wrap.appendChild(input);
    return wrap;
  }

  var form = h("div", { class: "form" });
  form.appendChild(makeField("GitHub 帳號（owner）", "owner", "例：yourname"));
  form.appendChild(makeField("Repo 名稱", "repo", "例：oc-world"));
  form.appendChild(makeField("分支", "branch", "main"));
  form.appendChild(makeField("Token（只給這個 repo 的 Contents 讀寫）", "token", "github_pat_..."));

  var hint = h("div", { class: "modal-hint" },
    "Token 只存在這台裝置的瀏覽器（localStorage），不會寫進 repo。公用電腦請用完按「清除」。");
  form.appendChild(hint);

  var actions = h("div", { class: "modal-actions" });
  var clear = h("button", { type: "button", class: "btn small left", text: "清除設定" });
  var test = h("button", { type: "button", class: "btn", text: "測試連線" });
  var save = h("button", { type: "button", class: "btn primary", text: "儲存" });
  actions.appendChild(clear);
  actions.appendChild(test);
  actions.appendChild(save);
  form.appendChild(actions);

  var modal = h("div", { class: "modal" }, h("h2", { text: "雲端寫入設定" }), form);
  var overlay = h("div", { class: "modal-overlay" }, modal);
  overlay.addEventListener("click", function (e) { if (e.target === overlay) close(); });
  function close() { host.innerHTML = ""; }

  function readInputs() {
    var out = { branch: "main" };
    var inputs = form.querySelectorAll("input[data-key]");
    for (var i = 0; i < inputs.length; i++) out[inputs[i].dataset.key] = inputs[i].value.trim();
    if (!out.branch) out.branch = "main";
    return out;
  }

  test.addEventListener("click", function () {
    var c = readInputs();
    if (!c.owner || !c.repo || !c.token) { toast("三個欄位都要填", true); return; }
    test.disabled = true;
    test.textContent = "測試中…";
    fetch("https://api.github.com/repos/" + c.owner + "/" + c.repo, { headers: ghHeaders(c) })
      .then(function (res) { return res.json().then(function (d) { return { ok: res.ok, d: d }; }); })
      .then(function (r) {
        test.disabled = false;
        test.textContent = "測試連線";
        if (!r.ok) { toast("連線失敗：" + (r.d.message || "請檢查設定"), true); return; }
        toast({ variant: "success", message: "連線成功：" + r.d.full_name, description: "預設分支：" + (r.d.default_branch || "?") });
      })
      .catch(function () {
        test.disabled = false;
        test.textContent = "測試連線";
        toast("連線失敗，請檢查網絡或 token", true);
      });
  });

  save.addEventListener("click", function () {
    var c = readInputs();
    if (!c.owner || !c.repo || !c.token) { toast("三個欄位都要填", true); return; }
    ghSaveConfig(c);
    close();
    updateEditAvailability();
    toast({ variant: "success", message: "已啟用 GitHub 模式", description: "重新載入後可直接在網站上編輯" });
    load().catch(function () { /* 忽略 */ });
  });

  clear.addEventListener("click", function () {
    ghClearConfig();
    close();
    updateEditAvailability();
    if (editMode) { editMode = false; el("editToggle").classList.remove("on"); el("editToggle").textContent = "編輯模式"; }
    render();
    toast("已清除 GitHub 設定");
  });

  host.appendChild(overlay);
}

function canEdit() { return !!sdk; }

function updateEditAvailability() {
  var editable = !!sdk;
  el("editToggle").hidden = !editable;
  el("editToggle").classList.toggle("on", editMode);
  el("editToggle").textContent = editMode ? "完成編輯" : "編輯模式";
  var tag = el("roTag");
  if (tag) {
    if (sdk) { tag.hidden = true; }
    else { tag.hidden = false; tag.textContent = "唯讀發佈版"; }
  }
  if (!editable && editMode) {
    editMode = false;
    document.body.classList.remove("editing");
  }
}

/* ── 路由 ─────────────────────────────────── */
function parseRoute() {
  var raw = (location.hash || "#/").replace(/^#\/?/, "");
  var parts = raw.split("/").filter(Boolean);
  return {
    view: parts[0] || "home",
    id: parts[1] || "",
    sub: parts[2] === undefined ? "" : parts[2]
  };
}

function render() {
  if (homeRandomTimer) { clearInterval(homeRandomTimer); homeRandomTimer = null; }
  stopAtmosphere();
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
  else if (route.view === "wiki") page = route.id ? entryPage(route.id) : wikiPage();
  else if (route.view === "music") page = musicPage();
  else if (route.view === "stories") page = route.id ? storyPage(route.id, route.sub) : storiesPage();
  else page = homePage();
  host.appendChild(page);
  decoratePage(page);
  updateHud();
  var curChar = (route.view === "characters" && route.id) ? byId(S.characters, route.id) : null;
  updateMusicFor(route.view, curChar);
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

  if (c && c.id && editMode && canEdit()) {
    node.classList.add("editable");
    node.setAttribute("title", "點擊更換頭像");
    node.appendChild(h("span", { class: "avatar-edit", text: "⤒" }));
    node.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      changeAvatar(c.id);
    });
  }
  return node;
}

/* 更換頭像：上傳後直接寫回該人物的 image */
function changeAvatar(id) {
  var c = byId(S.characters, id);
  if (!c) return;
  uploadImage(function (relPath) {
    mutate("updateCharacter", { id: id, image: relPath }).then(function () {
      toast("頭像已更新");
      return load();
    }).catch(reportErr);
  });
}

/* 角色頁的專屬歌曲（可多首） */
function playCharacterSong(src) {
  if (!musicAudio) {
    toast("這是聊天卡片，不會播音樂；請在網站頁面試聽", true);
    return;
  }
  if (!src) return;
  if (musicSrcNow === src && !musicAudio.paused) {
    musicAudio.pause();
    setMusicState(false);
    return;
  }
  musicSrcNow = src;
  musicAudio.src = src;
  playFade(musicAudio, MUSIC_VOLUME);
  setMusicState(true);
}

function addCharacterSong(cid) {
  pickAudioFile(function (relPath) {
    var c = byId(S.characters, cid);
    var list = parseSongEntries(c && c.bgm);
    if (!list.some(function (e) { return e.src === relPath; })) {
      list.push({ name: relPath.split("/").pop(), src: relPath });
    }
    mutate("updateCharacter", { id: cid, bgm: songsText(list) }).then(function () {
      toast("已加入歌曲");
      return load();
    }).then(function () {
      renameCharacterSong(cid, relPath, true);
    }).catch(reportErr);
  });
}

function removeCharacterSong(cid, src) {
  var c = byId(S.characters, cid);
  if (!c) return;
  var list = parseSongEntries(c.bgm).filter(function (e) { return e.src !== src; });
  mutate("updateCharacter", { id: cid, bgm: songsText(list) }).then(function () {
    if (musicSrcNow === src && musicAudio) { fadeOutStop(musicAudio); musicSrcNow = ""; setMusicState(false); }
    toast("已移除");
    return load();
  }).catch(reportErr);
}

/* 為某一首歌改名（只改顯示名稱，不動檔案） */
function renameCharacterSong(cid, src, askFirst) {
  var c = byId(S.characters, cid);
  if (!c) return;
  var list = parseSongEntries(c.bgm);
  var target = null;
  list.forEach(function (e) { if (e.src === src) target = e; });
  if (!target) return;
  openFormModal({
    title: (askFirst ? "為歌曲命名" : "歌曲改名") + "：" + (c.name || ""),
    hint: "只改顯示名稱，不會動到檔案。留空就用檔名。",
    fields: [
      { group: "歌曲", k: "name", label: "名稱", wide: true, ph: src.split("/").pop() }
    ],
    item: { name: target.name || "" },
    onSubmit: function (values, close, resetSave) {
      list.forEach(function (e) {
        if (e.src === src) e.name = String(values.name || "").trim() || src.split("/").pop();
      });
      mutate("updateCharacter", { id: cid, bgm: songsText(list) })
        .then(function () { toast("已更新名稱"); return load(); })
        .then(close, resetSave)
        .catch(function (err) { reportErr(err); resetSave(); });
    }
  });
}

/* 一次編輯某位角色的整份歌曲清單 */
function editSongList(cid) {
  var c = byId(S.characters, cid);
  if (!c) return;
  openFormModal({
    title: "編輯「" + (c.name || "未命名") + "」的歌曲",
    hint: "一行一首：「名稱 | media/檔名.mp3」；只寫路徑也可以，會用檔名顯示。這些歌只會在這一頁播，不會影響其他人。",
    fields: [
      { group: "歌曲", k: "bgm", label: "歌曲清單", type: "songs", wide: true }
    ],
    item: { bgm: c.bgm || "" },
    onSubmit: function (values, close, resetSave) {
      mutate("updateCharacter", { id: cid, bgm: values.bgm || "" })
        .then(function () { toast("已更新歌曲清單"); return load(); })
        .then(close, resetSave)
        .catch(function (err) { reportErr(err); resetSave(); });
    }
  });
}

function charMusicBlock(c) {
  var entries = parseSongEntries(c.bgm);
  var box = h("div", { class: "char-music" });

  var head = h("div", { class: "char-music-head" });
  head.appendChild(h("span", { class: "char-music-label", text: "♫ " + (c.name || "角色") + " 的專屬歌曲" }));
  head.appendChild(h("span", { class: "char-music-scope", text: "只在這一頁播" }));
  if (entries.length) head.appendChild(h("span", { class: "char-music-count", text: entries.length + " 首" }));
  box.appendChild(head);

  if (entries.length) {
    var list = h("div", { class: "char-song-list" });
    entries.forEach(function (e, i) {
      var row = h("div", { class: "char-song" });
      row.appendChild(h("span", { class: "char-song-idx", text: String(i + 1) }));
      row.appendChild(h("span", { class: "char-song-name", text: e.name || e.src.split("/").pop(), title: e.src }));

      var play = h("button", { class: "btn small", text: "▶" });
      play.addEventListener("click", function () { playCharacterSong(e.src); });
      row.appendChild(play);

      if (canEdit()) {
        var ren = h("button", { class: "btn small", text: "✎", title: "改名" });
        ren.addEventListener("click", function () { renameCharacterSong(c.id, e.src); });
        row.appendChild(ren);

        var del = h("button", { class: "btn small danger", text: "✕" });
        del.addEventListener("click", function () { removeCharacterSong(c.id, e.src); });
        row.appendChild(del);
      }
      list.appendChild(row);
    });
    box.appendChild(list);
  } else {
    box.appendChild(h("span", { class: "char-music-src", text: "還沒有歌曲（每人各自一份）" }));
  }

  if (canEdit()) {
    var actions = h("div", { class: "char-music-actions" });
    actions.appendChild(h("button", {
      class: "btn small", text: "＋ 上傳歌曲",
      onclick: function () { addCharacterSong(c.id); }
    }));
    actions.appendChild(h("button", {
      class: "btn small", text: "編輯歌曲清單",
      onclick: function () { editSongList(c.id); }
    }));
    if (entries.length) {
      actions.appendChild(h("button", {
        class: "btn small danger", text: "全部清除",
        onclick: function () { clearCharacterSong(c.id); }
      }));
    }
    box.appendChild(actions);
  }
  return box;
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

  /* ── 全屏開卷首屏 ── */
  var hero = h("div", { class: "opening" });
  var hb = heroBackdrop();
  if (hb) hero.appendChild(hb);
  hero.appendChild(openingAtmosphere());

  var inner = h("div", { class: "opening-inner" });
  if (w.era) inner.appendChild(h("span", { class: "opening-era", text: w.era }));
  inner.appendChild(h("h1", { text: w.name || "未命名世界" }));
  if (w.tagline) inner.appendChild(h("p", { class: "opening-tagline", text: w.tagline }));

  var oStats = h("div", { class: "opening-stats" });
  [
    ["人物", S.characters.length],
    ["時間綫", S.events.length],
    ["百科", S.entries.length],
    ["畫廊", S.gallery.length]
  ].forEach(function (pair) {
    oStats.appendChild(h("span", null, h("b", { text: String(pair[1]) }), document.createTextNode(pair[0])));
  });
  inner.appendChild(oStats);

  var oActions = h("div", { class: "opening-actions" });
  oActions.appendChild(h("a", { class: "btn", href: "#/characters", text: "人物" }));
  oActions.appendChild(h("a", { class: "btn", href: "#/timeline", text: "時間綫" }));
  oActions.appendChild(h("a", { class: "btn", href: "#/map", text: "地圖" }));
  inner.appendChild(oActions);

  var hint = h("a", { class: "scroll-hint", href: "#/", title: "往下看世界觀" });
  hint.appendChild(h("span", { text: "往下" }));
  hint.appendChild(h("i"));
  hint.addEventListener("click", function (e) {
    e.preventDefault();
    window.scrollTo({ top: window.innerHeight * 0.92, behavior: "smooth" });
  });
  inner.appendChild(hint);
  hero.appendChild(inner);
  page.appendChild(hero);

  /* ── 世界觀（首屏之下） ── */
  if (w.intro || canEdit()) {
    var introBlock = h("div", { class: "opening-intro" });
    introBlock.appendChild(h("h2", { class: "tab-sub", text: "世界觀" }));
    if (w.intro) introBlock.appendChild(richText(w.intro, "intro"));
    introBlock.appendChild(h("div", { class: "hero-actions" },
      editButton("編輯世界觀", function () { editWorld(); }),
      h("a", { class: "btn", href: "#/graph", text: "關係圖" }),
      h("a", { class: "btn", href: "#/gallery", text: "畫廊" })
    ));
    page.appendChild(introBlock);
  }

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

  /* 時間綫速覽 */
  if (S.events.length) {
    var tlRows = h("div", { class: "home-tl" });
    S.events.slice(-3).reverse().forEach(function (ev) {
      var row = h("a", { class: "home-tl-row", href: "#/timeline" });
      row.appendChild(h("span", { class: "home-tl-date", text: ev.date || "—" }));
      row.appendChild(h("span", { class: "home-tl-title", text: ev.title || "未命名節點" }));
      row.appendChild(h("span", { class: "home-tl-teaser", text: teaserText(ev.body) }));
      tlRows.appendChild(row);
    });
    page.appendChild(sectionBlock("時間綫速覽", S.events.length + " 個節點", tlRows,
      [h("a", { class: "btn small", href: "#/timeline", text: "完整時間綫 →" })]));
  }

  /* 百科速覽 */
  if (S.entries.length) {
    var catCount = {};
    S.entries.forEach(function (e) {
      var cat = String(e.category || "").trim() || "未分類";
      catCount[cat] = (catCount[cat] || 0) + 1;
    });
    var catChips = h("div", { class: "chips" });
    Object.keys(catCount).forEach(function (cat) {
      catChips.appendChild(h("a", { class: "chip faction", href: "#/wiki", text: cat + " " + catCount[cat] }));
    });
    var wikiGrid = h("div", { class: "wiki-grid", style: "margin-top:14px" });
    S.entries.slice(-4).reverse().forEach(function (e) {
      var card = h("a", { class: "card wiki-card", href: "#/wiki/" + e.id });
      if (e.category) card.appendChild(h("span", { class: "wiki-cat", text: e.category }));
      card.appendChild(h("h3", { text: e.title || "未命名詞條" }));
      if (e.summary) card.appendChild(h("p", { class: "summary", text: e.summary }));
      wikiGrid.appendChild(card);
    });
    page.appendChild(sectionBlock("百科", S.entries.length + " 個詞條",
      h("div", null, catChips, wikiGrid),
      [h("a", { class: "btn small", href: "#/wiki", text: "全部詞條 →" })]));
  }

  /* 畫廊速覽 */
  if (S.gallery.length) {
    var gGrid = h("div", { class: "gallery-grid small" });
    S.gallery.slice(-4).reverse().forEach(function (g) {
      var cell = h("figure", { class: "gallery-cell" });
      var frame = h("div", { class: "gallery-frame" });
      frame.appendChild(h("img", { src: g.image, alt: g.title || "", loading: "lazy" }));
      frame.addEventListener("click", function () { openLightbox(g); });
      cell.appendChild(frame);
      gGrid.appendChild(cell);
    });
    page.appendChild(sectionBlock("畫廊", S.gallery.length + " 張", gGrid,
      [h("a", { class: "btn small", href: "#/gallery", text: "全部圖片 →" })]));
  }

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
  page.appendChild(filters);

  var chipWrap = h("div", { class: "filter-chips" });
  page.appendChild(chipWrap);

  var listHost = h("div", { class: "grid char-wall" });
  page.appendChild(listHost);

  var state = { key: "all", value: "" };

  var roles = [], statuses = [];
  S.characters.forEach(function (c) {
    var r = String(c.role || "").trim();
    if (r && roles.indexOf(r) < 0) roles.push(r);
    var s = String(c.status || "").trim();
    if (s && statuses.indexOf(s) < 0) statuses.push(s);
  });
  var factions = uniqueFactions();

  function chip(label, key, value) {
    var b = h("button", { class: "filter-chip", text: label });
    if (state.key === key && state.value === value) b.classList.add("on");
    b.addEventListener("click", function () {
      state.key = key;
      state.value = value;
      buildChips();
      draw();
    });
    return b;
  }

  function buildChips() {
    chipWrap.innerHTML = "";
    chipWrap.appendChild(chip("全部", "all", ""));
    roles.forEach(function (r) { chipWrap.appendChild(chip(r, "role", r)); });
    statuses.forEach(function (s) { chipWrap.appendChild(chip(s, "status", s)); });
    factions.forEach(function (f) { chipWrap.appendChild(chip(f, "faction", f)); });
  }

  function draw() {
    var q = String(search.value || "").trim().toLowerCase();
    var items = S.characters.filter(function (c) {
      if (state.key === "role" && String(c.role || "").trim() !== state.value) return false;
      if (state.key === "status" && String(c.status || "").trim() !== state.value) return false;
      if (state.key === "faction" && String(c.faction || "").trim() !== state.value) return false;
      if (!q) return true;
      var hay = [c.name, c.alias, c.role, c.faction, c.status, c.tags, c.summary].join(" ").toLowerCase();
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
  buildChips();
  draw();
  return page;
}

function characterCard(c) {
  var col = resolveCharColor(c);
  var card = h("a", { class: "card char-card", href: "#/characters/" + c.id });
  card.style.setProperty("--c", col);

  var inner = h("div", { class: "flip-inner" });

  /* 正面 */
  var front = h("div", { class: "flip-face front" });
  front.appendChild(h("div", { class: "card-glow" }));
  front.appendChild(avatar(c, ""));
  front.appendChild(h("div", { class: "char-name", text: c.name || "未命名" }));
  var meta = [];
  if (c.alias) meta.push("「" + c.alias + "」");
  if (c.role) meta.push(c.role);
  if (meta.length) front.appendChild(h("div", { class: "char-meta", text: meta.join(" · ") }));
  if (c.faction) front.appendChild(h("span", { class: "chip faction card-faction", text: c.faction }));

  /* 背面 */
  var back = h("div", { class: "flip-face back" });
  var chips = h("div", { class: "chips" });
  if (c.faction) chips.appendChild(h("span", { class: "chip faction", text: c.faction }));
  if (c.status) chips.appendChild(h("span", { class: "chip status", text: c.status }));
  csv(c.tags).slice(0, 4).forEach(function (t) { chips.appendChild(h("span", { class: "chip", text: t })); });
  back.appendChild(chips);
  if (c.summary) back.appendChild(h("p", { class: "summary", text: c.summary }));
  back.appendChild(h("span", { class: "flip-hint", text: "查看檔案 →" }));

  inner.appendChild(front);
  inner.appendChild(back);
  card.appendChild(inner);
  return card;
}

/* ── 人物詳情（遊戲角色面板） ──────────────── */
var charTab = "intro";
var charImgIndex = 0;
var formPickA = 0, formPickB = 1;

function characterPage(id) {
  var page = h("div", { class: "page char-page" });
  page.appendChild(backLink("#/characters", "← 回到人物列表"));
  var c = byId(S.characters, id);
  if (!c) {
    page.appendChild(h("div", { class: "empty", text: "找不到這位人物，可能已經被刪除。" }));
    return page;
  }
  var col = resolveCharColor(c);
  page.style.setProperty("--char-color", col);

  /* ── 立繪 + 多圖切換（只取畫廊圖，頭像不重複出現）── */
  var shots = [];
  S.gallery.filter(function (g) {
    return csv(g.characters).indexOf(id) >= 0 && String(g.image || "").trim() && g.image !== c.image;
  }).forEach(function (g) {
    shots.push({ src: g.image, title: g.title || "" });
  });
  var seenPic = {};
  shots = shots.filter(function (s) {
    if (!s.src || seenPic[s.src]) return false;
    seenPic[s.src] = 1;
    return true;
  });
  if (charImgIndex >= shots.length) charImgIndex = 0;

  var hero = h("div", { class: "char-hero-2" });

  var stage = h("div", { class: "viewer-stage" });
  var bigImg = h("img", { alt: c.name || "" });
  var emptyStage = h("div", { class: "viewer-empty" }, avatar(c, "big"));
  function paintStage() {
    stage.innerHTML = "";
    if (shots.length) {
      bigImg.src = shots[charImgIndex].src;
      stage.appendChild(bigImg);
      stage.classList.add("clickable");
    } else {
      stage.appendChild(emptyStage);
      stage.classList.remove("clickable");
    }
  }
  stage.addEventListener("click", function () {
    if (!shots.length) return;
    openLightbox({ image: shots[charImgIndex].src, title: shots[charImgIndex].title || c.name });
  });
  paintStage();
  hero.appendChild(stage);

  if (shots.length > 1) {
    var thumbs = h("div", { class: "viewer-thumbs" });
    shots.forEach(function (s, i) {
      var t = h("button", { class: "viewer-thumb" + (i === charImgIndex ? " on" : "") });
      t.appendChild(h("img", { src: s.src, alt: s.title || "", loading: "lazy" }));
      t.addEventListener("click", function (e) {
        e.stopPropagation();
        charImgIndex = i;
        render();
      });
      thumbs.appendChild(t);
    });
    hero.appendChild(thumbs);
  }

  /* ── 標題與基本資訊 ── */
  var info = h("div", { class: "char-info" });
  info.appendChild(h("h1", { text: c.name || "未命名" }));
  var sub = [];
  if (c.alias) sub.push("「" + c.alias + "」");
  if (c.role) sub.push(c.role);
  if (c.status) sub.push(c.status);
  if (sub.length) info.appendChild(h("div", { class: "alias", text: sub.join(" · ") }));
  if (c.summary) info.appendChild(h("p", { class: "summary", text: c.summary }));

  var badges = h("div", { class: "chips" });
  if (c.faction) badges.appendChild(h("span", { class: "chip faction", text: c.faction }));
  csv(c.tags).forEach(function (t) { badges.appendChild(h("span", { class: "chip", text: t })); });
  info.appendChild(badges);

  /* 一句台詞（取第一句） */
  var firstQuote = String(c.quotes || "").split("\n").map(function (s) { return s.trim(); }).filter(Boolean)[0];
  if (firstQuote) {
    info.appendChild(h("blockquote", {
      class: "char-line",
      text: "「" + firstQuote.split("|")[0].trim() + "」"
    }));
  }

  var actions = h("div", { class: "hero-actions" });
  actions.appendChild(editButton("編輯人物資料", function () { editCharacter(id); }));
  actions.appendChild(h("a", { class: "btn small", href: "#/music", text: "♫ 這一頁的歌 →" }));
  info.appendChild(actions);

  /* ── 檔案資訊（圖示＋文字）── */
  var factList = [
    ["🎂", "生日", c.birthday], ["📏", "身高", c.height], ["🩸", "血型", c.bloodType],
    ["🎭", "定位", c.role], ["🏳", "所屬", c.faction], ["⏳", "年齡", c.age],
    ["✨", "變身型態", c.transformName], ["🔥", "代價", c.cost], ["🕳", "弱點", c.weakPoint],
    ["📌", "狀態", c.status], ["🔗", "關係", relationDegree(id) ? relationDegree(id) + " 條" : ""]
  ].filter(function (r) { return String(r[2] || "").trim() !== ""; });

  if (factList.length) {
    var panel = h("div", { class: "stat-panel" });
    factList.forEach(function (r) {
      panel.appendChild(h("div", { class: "stat-cell" },
        h("span", { class: "stat-ico", text: r[0] }),
        h("span", { class: "stat-label", text: r[1] }),
        h("b", { class: "stat-value", text: String(r[2]) })
      ));
    });
    info.appendChild(panel);
  }

  hero.appendChild(info);
  page.appendChild(hero);

  /* ── 能力面板（雷達）＋ 印象資訊 ── */
  var stats = parseStats(c.stats);
  var forms = parseForms(c.forms);
  var outfits = parseOutfits(c.outfits);

  var metaRows = [];
  if (String(c.color || "").trim()) {
    metaRows.push({ k: "印象色", node: h("span", null,
      h("span", { class: "swatch", style: "background:" + resolveCharColor(c) + ";display:inline-block;vertical-align:middle;margin-right:8px" }),
      h("b", { text: String(c.color) })
    ) });
  }
  if (String(c.imprintSong || "").trim()) {
    var songVal = String(c.imprintSong).trim();
    var songNode = h("span", null, h("b", { text: /\.(mp3|wav|ogg|m4a|flac|aac)(\?|#|$)/i.test(songVal) ? songVal.split("/").pop() : songVal }));
    if (/\.(mp3|wav|ogg|m4a|flac|aac)(\?|#|$)/i.test(songVal)) {
      var sPlay = h("button", { class: "btn small", text: "▶", title: "播放印象曲" });
      sPlay.addEventListener("click", function () { playCharacterSong(songVal); });
      songNode.appendChild(document.createTextNode(" "));
      songNode.appendChild(sPlay);
    }
    metaRows.push({ k: "印象曲", node: songNode });
  }
  if (String(c.voiceActor || "").trim()) {
    metaRows.push({ k: "腦內聲優", node: h("b", { text: String(c.voiceActor) }) });
  }

  if (stats.length >= 3 || metaRows.length) {
    var row = h("div", { class: "panel-row" });

    if (stats.length >= 3) {
      var radar = radarChart(stats, col);
      if (radar) row.appendChild(h("div", { class: "radar-box" }, radar));
    } else {
      row.appendChild(h("div", { class: "empty", text: "在「編輯人物 → 能力數值」填至少 3 項（例：力量: 7），就會出現雷達圖。" }));
    }

    var listBox = h("div", { class: "imprint-list" });
    metaRows.forEach(function (r) {
      listBox.appendChild(h("div", { class: "imprint-row" },
        h("span", { class: "k", text: r.k }),
        h("span", { class: "v" }, r.node)
      ));
    });
    if (forms.length) {
      listBox.appendChild(h("div", { class: "imprint-row" },
        h("span", { class: "k", text: "形態" }),
        h("span", { class: "v", text: forms.length + " 個（見「形態」分頁）" })
      ));
    }
    if (outfits.length) {
      listBox.appendChild(h("div", { class: "imprint-row" },
        h("span", { class: "k", text: "圖鑑" }),
        h("span", { class: "v", text: outfits.length + " 套服裝／裝備" })
      ));
    }
    if (!metaRows.length && !forms.length && !outfits.length) {
      listBox.appendChild(h("div", { class: "empty", text: "還沒有印象色、印象曲、腦內聲優等資料。" }));
    }
    row.appendChild(listBox);
    page.appendChild(sectionBlock("角色面板", "", row));
  }

  /* ── 分頁 ── */
  var tabs = [
    { k: "intro", label: "簡介" },
    { k: "forms", label: "形態" },
    { k: "outfits", label: "圖鑑" },
    { k: "trivia", label: "軼事" },
    { k: "quotes", label: "台詞" },
    { k: "gallery", label: "畫廊" }
  ];
  var tabBar = h("div", { class: "tabs" });
  var tabBody = h("div", { class: "tab-body" });

  function paintTab() {
    tabBar.innerHTML = "";
    tabs.forEach(function (t) {
      var b = h("button", { class: "tab" + (charTab === t.k ? " on" : ""), text: t.label });
      b.addEventListener("click", function () { charTab = t.k; paintTab(); });
      tabBar.appendChild(b);
    });

    tabBody.innerHTML = "";
    if (charTab === "intro") {
      if (c.story) tabBody.appendChild(richText(c.story));
      else tabBody.appendChild(h("div", { class: "empty", text: "還沒寫簡介。" }));

      var groups = [
        ["性格", [["形容詞", c.personality], ["口頭禪", c.catchphrase], ["強項", c.strengths],
          ["缺點", c.flaw], ["地雷", c.petPeeve], ["害怕", c.fear], ["壓力大時", c.coping],
          ["第一印象", c.firstImpression]]],
        ["外貌", [["髮型髮色", c.hair], ["眼睛", c.eyes], ["平常穿著", c.outfit],
          ["小動作", c.habit], ["隨身物品", c.keepsake], ["代表色", c.color],
          ["變身外觀", c.transformLook]]],
        ["能力", [["型態", c.transformName], ["效果", c.ability], ["限制", c.abilityLimit],
          ["代價", c.cost], ["弱點", c.weakPoint]]],
        ["劇情", [["最想要", c.want], ["最怕失去", c.loseFear], ["秘密", c.secret]]],
        ["背景", [["家人", c.family], ["上一輪", c.pastLife]]]
      ];
      groups.forEach(function (g) {
        var rows = g[1].filter(function (r) { return String(r[1] || "").trim() !== ""; });
        if (!rows.length) return;
        var box = h("div", { class: "facts tall" });
        rows.forEach(function (r) {
          box.appendChild(h("div", { class: "fact" }, h("span", { text: r[0] }), h("b", { text: String(r[1]) })));
        });
        tabBody.appendChild(h("h3", { class: "tab-sub", text: g[0] }));
        tabBody.appendChild(box);
      });
    }

    if (charTab === "forms") {
      if (!forms.length) {
        tabBody.appendChild(h("div", {
          class: "empty",
          text: canEdit()
            ? "還沒有形態。編輯人物 →「形態變化（滑塊對比）」，一行一個：「名稱 | 圖片路徑 | 說明」。"
            : "還沒有形態資料。"
        }));
      } else {
        var canCompare = forms.length >= 2 && forms.every(function (f2) { return f2.image; });
        if (canCompare) {
          formPickA = clamp(formPickA, 0, forms.length - 1);
          formPickB = clamp(formPickB, 0, forms.length - 1);
          if (formPickA === formPickB) formPickB = (formPickA + 1) % forms.length;

          var picker = h("div", { class: "form-picker" });
          function mkPick(label, which) {
            var wrap = h("label", null, h("span", { text: label }));
            var sSel = h("select", {});
            forms.forEach(function (f2, i) {
              var o = h("option", { value: String(i), text: f2.name || ("形態 " + (i + 1)) });
              if ((which === "a" ? formPickA : formPickB) === i) o.selected = true;
              sSel.appendChild(o);
            });
            sSel.addEventListener("change", function () {
              if (which === "a") formPickA = parseInt(sSel.value, 10) || 0;
              else formPickB = parseInt(sSel.value, 10) || 0;
              paintTab();
            });
            wrap.appendChild(sSel);
            return wrap;
          }
          picker.appendChild(mkPick("左邊（起點）", "a"));
          picker.appendChild(mkPick("右邊（之後）", "b"));
          tabBody.appendChild(picker);

          tabBody.appendChild(compareSlider(forms[formPickA], forms[formPickB]));
          tabBody.appendChild(h("p", { class: "page-sub", text: "左右拖動中間的圓點，對比兩個時期的立繪。" }));
          if (forms[formPickB].desc) tabBody.appendChild(richText(forms[formPickB].desc));

          var strip = h("div", { class: "form-strip" });
          forms.forEach(function (f2, i) {
            var chip2 = h("button", { class: "form-chip" + (i === formPickB ? " on" : ""), type: "button" });
            if (f2.image) chip2.appendChild(h("img", { src: f2.image, alt: f2.name || "", loading: "lazy" }));
            chip2.appendChild(h("span", { text: f2.name || ("形態 " + (i + 1)) }));
            chip2.addEventListener("click", function () { formPickB = i; paintTab(); });
            strip.appendChild(chip2);
          });
          tabBody.appendChild(strip);
        } else {
          var fGrid = h("div", { class: "outfit-grid" });
          forms.forEach(function (f2) {
            fGrid.appendChild(mediaCard(f2, "形態", function () { openOutfitDetail(f2); }));
          });
          tabBody.appendChild(fGrid);
          tabBody.appendChild(h("p", {
            class: "page-sub",
            text: "兩個以上的形態都填了圖片，就會出現可拖動的對比滑塊。"
          }));
        }
      }
    }

    if (charTab === "outfits") {
      if (!outfits.length) {
        tabBody.appendChild(h("div", {
          class: "empty",
          text: canEdit()
            ? "還沒有服裝／裝備。編輯人物 →「服裝 / 裝備圖鑑」，一行一套：「名稱 | 類型 | 圖片路徑 | 說明」。"
            : "還沒有服裝／裝備資料。"
        }));
      } else {
        var oGrid = h("div", { class: "outfit-grid" });
        outfits.forEach(function (o) {
          oGrid.appendChild(mediaCard(o, o.type || "服裝", function () { openOutfitDetail(o); }));
        });
        tabBody.appendChild(oGrid);
      }
    }

    if ((charTab === "forms" || charTab === "outfits") && canEdit()) {
      tabBody.appendChild(h("div", { class: "field-btns" },
        editButton("編輯" + (charTab === "forms" ? "形態資料" : "服裝圖鑑"), function () { editCharacter(id); })
      ));
    }

    if (charTab === "trivia") {
      if (canEdit() && editMode) {
        var tTa = h("textarea", { class: "inline-ta", rows: "8", placeholder: "空行分段；支援 **粗體**、> 引用" });
        tTa.value = c.trivia || "";
        var tSave = h("button", { class: "btn small primary", text: "儲存軼事" });
        tSave.addEventListener("click", function () {
          mutate("updateCharacter", { id: c.id, trivia: tTa.value })
            .then(function () { toast("已更新軼事"); return load(); })
            .catch(reportErr);
        });
        tabBody.appendChild(tTa);
        tabBody.appendChild(h("div", { class: "field-btns" }, tSave));
      } else if (c.trivia) {
        tabBody.appendChild(richText(c.trivia));
      } else {
        tabBody.appendChild(h("div", { class: "empty", text: editMode ? "還沒有軼事。進入編輯模式即可直接在這裡寫。" : "還沒有軼事。" }));
      }
    }

    if (charTab === "quotes") {
      var qLines = String(c.quotes || "").split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
      var editable = canEdit() && editMode;

      function saveQ(next) {
        mutate("updateCharacter", { id: c.id, quotes: next.join("\n") })
          .then(function () { toast("已更新台詞"); return load(); })
          .catch(reportErr);
      }

      function makeBubble(text, audioSrc, index) {
        var bubble = h("div", { class: "quote-bubble" });
        bubble.appendChild(avatar(c, "quote-avatar"));
        var qbody = h("div", { class: "quote-body" });
        bubble.appendChild(qbody);

        function read() {
          qbody.innerHTML = "";
          if (text) qbody.appendChild(h("p", { class: "quote-text", text: "「" + text + "」" }));

          if (audioSrc) {
            var playBtn = h("button", { class: "quote-play", text: "▶ 播放" });
            playBtn.addEventListener("click", function () {
              if (isChatCard()) { toast("聊天卡片裡不播放聲音", true); return; }
              var a = registerAudio(new Audio(audioSrc));
              playFade(a, MUSIC_VOLUME);
              playBtn.textContent = "播放中…";
              a.addEventListener("ended", function () { playBtn.textContent = "▶ 播放"; });
              a.addEventListener("pause", function () { playBtn.textContent = "▶ 播放"; });
              a.addEventListener("error", function () {
                toast("無法播放音檔", true);
                playBtn.textContent = "▶ 播放";
              });
            });
            qbody.appendChild(playBtn);
          }

          if (editable) {
            var acts = h("div", { class: "quote-acts" });
            var bn = h("button", { class: "btn small", text: "✎ 修改" });
            bn.addEventListener("click", edit);
            acts.appendChild(bn);
            if (typeof index === "number") {
              var bd = h("button", { class: "btn small danger", text: "刪除" });
              bd.addEventListener("click", function () {
                var next = qLines.slice();
                next.splice(index, 1);
                saveQ(next);
              });
              acts.appendChild(bd);
            }
            qbody.appendChild(acts);
          }
        }

        function edit() {
          qbody.innerHTML = "";
          var ta = h("textarea", { class: "quote-input", rows: "2", placeholder: "台詞內容" });
          ta.value = text;
          var ai = h("input", { type: "text", class: "quote-audio", placeholder: "配音檔（可留空）：media/xxx.mp3" });
          ai.value = audioSrc;
          qbody.appendChild(ta);
          qbody.appendChild(ai);

          var row = h("div", { class: "quote-acts" });
          var ok = h("button", { class: "btn small primary", text: "儲存" });
          ok.addEventListener("click", function () {
            var nt = String(ta.value || "").trim();
            var na = String(ai.value || "").trim();
            if (!nt) { toast("台詞不能留空", true); ta.focus(); return; }
            var line = na ? (nt + " | " + na) : nt;
            var next = qLines.slice();
            if (typeof index === "number") next[index] = line;
            else next.push(line);
            saveQ(next);
          });
          var cancel = h("button", { class: "btn small", text: "取消" });
          cancel.addEventListener("click", function () {
            if (typeof index === "number") read();
            else bubble.remove();
          });
          row.appendChild(ok);
          row.appendChild(cancel);
          qbody.appendChild(row);
          ta.focus();
        }

        return { node: bubble, edit: edit, read: read };
      }

      var qList = h("div", { class: "quote-list" });
      qLines.forEach(function (line, qi) {
        var parts = line.split("|");
        var bub = makeBubble(parts[0].trim(), (parts[1] || "").trim(), qi);
        bub.read();
        qList.appendChild(bub.node);
      });

      if (!qLines.length && !editable) {
        tabBody.appendChild(h("div", { class: "empty", text: "還沒有台詞。" }));
      } else {
        tabBody.appendChild(qList);
      }

      if (editable) {
        var addQ = h("button", { class: "btn small quote-add", text: "＋ 新增台詞" });
        addQ.addEventListener("click", function () {
          var bub = makeBubble("", "", undefined);
          bub.edit();
          qList.appendChild(bub.node);
        });
        tabBody.appendChild(h("div", { class: "field-btns" }, addQ));
      }
    }

    if (charTab === "gallery") {
      var mine = S.gallery.filter(function (g) {
        return csv(g.characters).indexOf(id) >= 0 && g.image !== c.image;
      });
      if (!mine.length) {
        tabBody.appendChild(h("div", { class: "empty", text: editMode ? "還沒有圖片，按右邊「＋」加入。" : "還沒有圖片。" }));
      } else {
        var grid = h("div", { class: "gallery-grid small" });
        mine.forEach(function (g) {
          var cell = h("figure", { class: "gallery-cell" });
          var frame = h("div", { class: "gallery-frame" });
          frame.appendChild(h("img", { src: g.image, alt: g.title || "", loading: "lazy" }));
          frame.addEventListener("click", function () { openLightbox(g); });
          cell.appendChild(frame);
          if (g.title) cell.appendChild(h("figcaption", { class: "gallery-title", text: g.title }));
          grid.appendChild(cell);
        });
        tabBody.appendChild(grid);
      }
      if (editMode) tabBody.appendChild(editButton("＋ 加入圖片", function () { editGallery(null, id); }));
    }
  }

  page.appendChild(tabBar);
  page.appendChild(tabBody);
  paintTab();

  /* ── 關係速覽（小型節點圖）── */
  var rels = S.relations.filter(function (r) { return r.fromId === id || r.toId === id; });
  if (rels.length) page.appendChild(miniRelationGraph(c, rels));
  else if (editMode) {
    page.appendChild(sectionBlock("人物關係", "0 條",
      h("div", { class: "empty", text: "還沒有關係。" }),
      [editButton("＋ 新增關係", function () { editRelation(null, id); })]));
  }

  /* ── BGM 由全站音樂 dock 統一處理 ── */
  return page;
}

/* 小型關係圖：中心人物 + 周圍鄰居 */
function miniRelationGraph(c, rels) {
  var W = 640, H = 300, cx = W / 2, cy = H / 2;
  var nodes = [];
  rels.forEach(function (r) {
    var otherId = r.fromId === c.id ? r.toId : r.fromId;
    if (nodes.some(function (n) { return n.id === otherId; })) return;
    var oc = byId(S.characters, otherId);
    if (oc) nodes.push({ id: otherId, c: oc, rel: r });
  });
  nodes = nodes.slice(0, 8);

  var svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "mini-graph");
  svg.setAttribute("viewBox", "0 0 " + W + " " + H);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

  var defs = document.createElementNS(NS, "defs");
  svg.appendChild(defs);

  var R = 108;
  nodes.forEach(function (n, i) {
    var ang = (i / Math.max(1, nodes.length)) * Math.PI * 2 - Math.PI / 2;
    n.x = cx + Math.cos(ang) * R * 1.9;
    n.y = cy + Math.sin(ang) * R;
  });

  nodes.forEach(function (n) {
    var line = document.createElementNS(NS, "line");
    line.setAttribute("x1", cx); line.setAttribute("y1", cy);
    line.setAttribute("x2", n.x); line.setAttribute("y2", n.y);
    line.setAttribute("stroke", REL_COLORS[n.rel.type] || "#8d949a");
    line.setAttribute("stroke-width", "1.6");
    line.setAttribute("opacity", "0.55");
    svg.appendChild(line);

    var label = document.createElementNS(NS, "text");
    label.setAttribute("x", (cx + n.x) / 2);
    label.setAttribute("y", (cy + n.y) / 2 - 4);
    label.setAttribute("class", "mini-edge-label");
    label.textContent = n.rel.type;
    svg.appendChild(label);
  });

  function drawNode(node, isCenter) {
    var g = document.createElementNS(NS, "g");
    g.setAttribute("class", "mini-node" + (isCenter ? " center" : ""));
    var r = isCenter ? 30 : 22;
    var cir = document.createElementNS(NS, "circle");
    cir.setAttribute("cx", node.x); cir.setAttribute("cy", node.y);
    cir.setAttribute("r", String(r));
    cir.style.fill = resolveCharColor(node.c);
    g.appendChild(cir);

    var ch = node.c;
    if (String(ch.image || "").trim()) {
      var clipId = "mg-" + String(ch.id).replace(/[^A-Za-z0-9_-]/g, "");
      var cp = document.createElementNS(NS, "clipPath");
      cp.setAttribute("id", clipId);
      var cc = document.createElementNS(NS, "circle");
      cc.setAttribute("cx", node.x); cc.setAttribute("cy", node.y); cc.setAttribute("r", String(r));
      cp.appendChild(cc);
      defs.appendChild(cp);
      var im = document.createElementNS(NS, "image");
      im.setAttribute("href", ch.image);
      im.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", ch.image);
      im.setAttribute("x", String(node.x - r));
      im.setAttribute("y", String(node.y - r));
      im.setAttribute("width", String(r * 2));
      im.setAttribute("height", String(r * 2));
      im.setAttribute("preserveAspectRatio", "xMidYMid slice");
      im.setAttribute("clip-path", "url(#" + clipId + ")");
      g.appendChild(im);
    }

    var t = document.createElementNS(NS, "text");
    t.setAttribute("x", node.x);
    t.setAttribute("y", node.y + r + 15);
    t.setAttribute("class", "mini-node-label");
    t.textContent = ch.name || "";
    g.appendChild(t);

    if (!isCenter) {
      g.style.cursor = "pointer";
      g.addEventListener("click", function () { location.hash = "#/characters/" + ch.id; });
    }
    svg.appendChild(g);
  }

  nodes.forEach(function (n) { drawNode(n, false); });
  drawNode({ x: cx, y: cy, c: c }, true);

  var wrap = h("div", { class: "mini-graph-wrap" });
  wrap.appendChild(svg);
  return sectionBlock("人物關係", rels.length + " 條", wrap,
    [h("a", { class: "btn small", href: "#/graph", text: "完整關係圖 →" })]);
}

/* BGM 播放器 */
function bgmPlayer(c) {
  var audio = h("audio", { src: c.bgm, loop: true, preload: "auto" });
  var btn = h("button", { class: "bgm-btn", title: "播放／暫停 BGM" });
  btn.appendChild(h("span", { class: "bgm-ico", text: "♪" }));
  btn.appendChild(h("span", { class: "bgm-txt", text: "點擊播放" }));

  function setState(playing) {
    btn.classList.toggle("playing", playing);
    btn.querySelector(".bgm-txt").textContent = playing ? "播放中" : "點擊播放";
  }

  btn.addEventListener("click", function () {
    if (audio.paused) {
      audio.play().then(function () { setState(true); }).catch(function () { toast("無法播放音檔", true); });
    } else {
      audio.pause();
      setState(false);
    }
  });

  /* 嘗試自動播放；被瀏覽器攔截就停在「點擊播放」 */
  setTimeout(function () {
    var p = audio.play();
    if (p && p.catch) p.then(function () { setState(true); }).catch(function () { setState(false); });
  }, 400);

  var host = h("div", { class: "bgm-dock" }, audio, btn);
  return host;
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

  /* 縮放工具列（手機預設放大，可左右滑動） */
  var gz = window.innerWidth < 700 ? 1.7 : 1;
  var wrap = h("div", { class: "graph-wrap" });
  var zoomVal = h("span", { class: "zoom-val", text: Math.round(gz * 100) + "%" });

  function applyZoom() {
    wrap.style.setProperty("--gz", String(gz));
    zoomVal.textContent = Math.round(gz * 100) + "%";
  }

  var gtools = h("div", { class: "graph-tools" });
  var zOut = h("button", { class: "btn small", text: "−", title: "縮小" });
  zOut.addEventListener("click", function () { gz = clamp(gz - 0.2, 1, 3); applyZoom(); });
  var zIn = h("button", { class: "btn small", text: "＋", title: "放大" });
  zIn.addEventListener("click", function () { gz = clamp(gz + 0.2, 1, 3); applyZoom(); });
  var zFit = h("button", { class: "btn small", text: "適合視窗" });
  zFit.addEventListener("click", function () { gz = 1; applyZoom(); });
  gtools.appendChild(zOut);
  gtools.appendChild(zoomVal);
  gtools.appendChild(zIn);
  gtools.appendChild(zFit);
  gtools.appendChild(h("span", { class: "hint", text: "放大後可左右滑動" }));
  page.appendChild(gtools);

  applyZoom();
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
  var defs = document.createElementNS(NS, "defs");
  svg.appendChild(defs);

  nodes.forEach(function (n) {
    var g = document.createElementNS(NS, "g");
    g.setAttribute("class", "node" + (graphPick === n.id ? " picked" : ""));

    var r = 17 + Math.min(n.degree * 2.6, 13);
    var src = String((n.c && n.c.image) || "").trim();

    var circle = document.createElementNS(NS, "circle");
    circle.setAttribute("r", String(r));
    circle.style.cursor = "grab";
    g.appendChild(circle);

    if (src) {
      /* 有頭像：圓形裁切 */
      var clipId = "nc-" + String(n.id).replace(/[^A-Za-z0-9_-]/g, "");
      var cp = document.createElementNS(NS, "clipPath");
      cp.setAttribute("id", clipId);
      var clipCircle = document.createElementNS(NS, "circle");
      clipCircle.setAttribute("r", String(r));
      cp.appendChild(clipCircle);
      defs.appendChild(cp);

      var img = document.createElementNS(NS, "image");
      img.setAttribute("href", src);
      img.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", src);
      img.setAttribute("x", String(-r));
      img.setAttribute("y", String(-r));
      img.setAttribute("width", String(r * 2));
      img.setAttribute("height", String(r * 2));
      img.setAttribute("preserveAspectRatio", "xMidYMid slice");
      img.setAttribute("clip-path", "url(#" + clipId + ")");
      g.appendChild(img);

      circle.style.fill = "none";
      circle.style.stroke = factionColor(n.c.faction);
      circle.setAttribute("stroke-width", "3");

      img.addEventListener("error", function () {
        img.remove();
        circle.style.fill = factionColor(n.c.faction);
        circle.style.stroke = "#fff";
        circle.setAttribute("stroke-width", "2.5");
      });
    } else {
      circle.style.fill = factionColor(n.c.faction);
    }

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

    /* 小插圖：優先取這個節點綁定的第一張圖 */
    if (boundGallery.length && boundGallery[0].image) {
      var fig = h("figure", { class: "tl-illus" });
      var gi = h("img", { src: boundGallery[0].image, alt: boundGallery[0].title || "", loading: "lazy" });
      gi.addEventListener("click", function () { openLightbox(boundGallery[0]); });
      fig.appendChild(gi);
      if (boundGallery[0].title) fig.appendChild(h("figcaption", { text: boundGallery[0].title }));
      body.appendChild(fig);
    }

    if (boundStories.length || boundGallery.length) {
      var links = h("div", { class: "tl-links" });
      boundStories.forEach(function (s) {
        links.appendChild(h("a", { class: "tl-link", href: "#/stories/" + s.id + "/0", text: "▤ " + (s.title || "未命名故事") }));
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

/* ── 百科詞條 ─────────────────────────────── */
function findEntryByTitle(name) {
  var n = String(name || "").trim().toLowerCase();
  if (!n) return null;
  for (var i = 0; i < S.entries.length; i++) {
    if (String(S.entries[i].title || "").trim().toLowerCase() === n) return S.entries[i];
  }
  return null;
}

function inlineWiki(text) {
  var t = escapeHtml(text);
  t = t.replace(/\[\[([^\]]+)\]\]/g, function (whole, name) {
    var key = String(name).trim();
    var target = findEntryByTitle(key);
    if (target) {
      return '<a class="wikilink" href="#/wiki/' + target.id + '">' + key + "</a>";
    }
    return '<span class="wikilink missing" title="尚未建立這個詞條">' + key + "</span>";
  });
  t = t.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  return t.replace(/\n/g, "<br>");
}

function entryBody(text) {
  var wrap = h("div", { class: "prose entry-prose" });
  String(text || "").split(/\n{2,}/).forEach(function (block) {
    var b = block.trim();
    if (!b) return;
    if (b.charAt(0) === ">") {
      wrap.appendChild(h("blockquote", { html: inlineWiki(b.replace(/^>\s?/gm, "")) }));
    } else {
      wrap.appendChild(h("p", { html: inlineWiki(b) }));
    }
  });
  return wrap;
}

function wikiPage() {
  var page = h("div", { class: "page wiki-page" });
  var head = h("div", { class: "page-head" });
  head.appendChild(h("h1", { text: "百科" }));
  head.appendChild(editButton("＋ 新增詞條", function () { editEntry(null); }));
  head.appendChild(h("span", { class: "page-sub", text: S.entries.length + " 個詞條" }));
  page.appendChild(head);

  if (!S.entries.length) {
    page.appendChild(h("div", { class: "empty", text: editMode ? "還沒有詞條，點右上「＋ 新增詞條」。" : "百科還是空的。" }));
    return page;
  }

  var cats = [];
  S.entries.forEach(function (e) {
    var c = String(e.category || "").trim();
    if (c && cats.indexOf(c) < 0) cats.push(c);
  });

  var chips = h("div", { class: "filter-chips" });
  var state = { cat: "" };
  function paint() {
    chips.innerHTML = "";
    var all = h("button", { class: "filter-chip" + (state.cat === "" ? " on" : ""), text: "全部" });
    all.addEventListener("click", function () { state.cat = ""; paint(); draw(); });
    chips.appendChild(all);
    cats.forEach(function (c) {
      var b = h("button", { class: "filter-chip" + (state.cat === c ? " on" : ""), text: c });
      b.addEventListener("click", function () { state.cat = c; paint(); draw(); });
      chips.appendChild(b);
    });
  }
  page.appendChild(chips);

  var host = h("div", { class: "wiki-grid" });
  page.appendChild(host);

  function draw() {
    host.innerHTML = "";
    var list = S.entries.filter(function (e) {
      return !state.cat || String(e.category || "").trim() === state.cat;
    });
    if (!list.length) {
      host.appendChild(h("div", { class: "empty", text: "這個分類還沒有詞條。" }));
      return;
    }
    list.forEach(function (e) {
      var card = h("a", { class: "card wiki-card", href: "#/wiki/" + e.id });
      if (e.category) card.appendChild(h("span", { class: "wiki-cat", text: e.category }));
      card.appendChild(h("h3", { text: e.title || "未命名詞條" }));
      if (e.summary) card.appendChild(h("p", { class: "summary", text: e.summary }));
      var links = String(e.body || "").match(/\[\[([^\]]+)\]\]/g) || [];
      if (links.length) {
        card.appendChild(h("div", { class: "wiki-links-count", text: "→ " + links.length + " 個內鏈" }));
      }
      host.appendChild(card);
    });
  }

  paint();
  draw();
  return page;
}

function entryPage(id) {
  var page = h("div", { class: "page wiki-entry" });
  page.appendChild(backLink("#/wiki", "← 回到百科"));
  var e = byId(S.entries, id);
  if (!e) {
    page.appendChild(h("div", { class: "empty", text: "找不到這個詞條。" }));
    return page;
  }

  var head = h("div", { class: "entry-head" });
  if (e.category) {
    var catLink = h("a", { class: "wiki-cat big", href: "#/wiki", text: e.category });
    head.appendChild(catLink);
  }
  head.appendChild(h("h1", { text: e.title || "未命名詞條" }));
  if (e.summary) head.appendChild(h("p", { class: "entry-summary", text: e.summary }));
  head.appendChild(h("div", { class: "hero-actions" },
    editButton("編輯詞條", function () { editEntry(id); })));
  page.appendChild(head);

  page.appendChild(entryBody(e.body));

  /* 相關詞條 */
  var related = csv(e.related).map(function (rid) { return byId(S.entries, rid); }).filter(Boolean);
  var sameCat = S.entries.filter(function (x) {
    return x.id !== id && String(x.category || "").trim() === String(e.category || "").trim();
  });
  sameCat.forEach(function (x) {
    if (!related.some(function (r) { return r.id === x.id; })) related.push(x);
  });
  related = related.slice(0, 6);

  if (related.length) {
    var grid = h("div", { class: "wiki-related" });
    related.forEach(function (r) {
      var card = h("a", { class: "related-card", href: "#/wiki/" + r.id });
      if (r.category) card.appendChild(h("span", { class: "wiki-cat", text: r.category }));
      card.appendChild(h("b", { text: r.title || "" }));
      if (r.summary) card.appendChild(h("span", { class: "related-sum", text: r.summary }));
      grid.appendChild(card);
    });
    var block = h("div", { class: "section" },
      h("div", { class: "section-head" }, h("h2", { text: "相關詞條" })),
      grid);
    page.appendChild(block);
  }

  /* 反向連結：哪些詞條提到這裡 */
  var backlinks = S.entries.filter(function (x) {
    return x.id !== id && String(x.body || "").indexOf("[[" + (e.title || "") + "]]") >= 0;
  });
  if (backlinks.length) {
    var bl = h("div", { class: "chips" });
    backlinks.forEach(function (x) {
      bl.appendChild(h("a", { class: "chip faction", href: "#/wiki/" + x.id, text: "← " + (x.title || "") }));
    });
    page.appendChild(h("div", { class: "section" },
      h("div", { class: "section-head" }, h("h2", { text: "被以下詞條引用" })),
      bl));
  }

  return page;
}

/* ── 音樂管理頁 ───────────────────────────── */
function playPreview(src, btn) {
  if (!src) { toast("沒有音檔", true); return; }
  if (isChatCard()) { toast("聊天卡片裡不播放音樂；請在網站頁面試聽", true); return; }
  var a = registerAudio(new Audio(src));
  var old = btn.textContent;
  btn.textContent = "播放中…";
  playFade(a, MUSIC_VOLUME);
  a.addEventListener("ended", function () { btn.textContent = old; });
  a.addEventListener("error", function () {
    toast("無法播放：這不是音檔或路徑不對", true);
    btn.textContent = old;
  });
  a.addEventListener("pause", function () { btn.textContent = old; });
}

function assignCharacterSong(cid) {
  pickAudioFile(function (relPath) {
    mutate("updateCharacter", { id: cid, bgm: relPath }).then(function () {
      toast("已為這位人物設定歌曲");
      return load();
    }).catch(reportErr);
  });
}

function assignCharacterSongFromList(cid) {
  var opts = [];
  var seen = {};
  S.music.forEach(function (m) {
    if (m.src && !seen[m.src]) {
      seen[m.src] = 1;
      opts.push({ value: m.src, label: m.title || m.src.split("/").pop() });
    }
  });
  S.characters.forEach(function (c) {
    if (c.bgm && !seen[c.bgm]) {
      seen[c.bgm] = 1;
      opts.push({ value: c.bgm, label: c.bgm.split("/").pop() + "（" + (c.name || "") + "）" });
    }
  });
  if (!opts.length) { toast("音樂庫還是空的，請先用「上傳」加一首", true); return; }
  var me = byId(S.characters, cid) || {};
  openFormModal({
    title: "從音樂庫指定歌曲",
    hint: "只會在這位角色的頁面播放。",
    fields: [
      { group: "指定歌曲", k: "src", label: "歌曲", type: "select", options: opts, required: true }
    ],
    item: { src: me.bgm || "" },
    onSubmit: function (values, close, resetSave) {
      var cur = byId(S.characters, cid);
      var songs = parseSongs(cur && cur.bgm);
      if (songs.indexOf(values.src) < 0) songs.push(values.src);
      mutate("updateCharacter", { id: cid, bgm: songs.join("\n") }).then(function () {
        toast("已加入歌曲");
        return load();
      }).then(close, resetSave).catch(function (err) {
        reportErr(err);
        resetSave();
      });
    }
  });
}

function clearCharacterSong(cid) {
  var c = byId(S.characters, cid);
  if (!c) return;
  if (!window.confirm("清除「" + (c.name || "") + "」的專屬歌曲？")) return;
  mutate("updateCharacter", { id: cid, bgm: "" }).then(function () {
    toast("已清除");
    return load();
  }).catch(reportErr);
}

function musicPage() {
  var page = h("div", { class: "page" });
  var head = h("div", { class: "page-head" });
  head.appendChild(h("h1", { text: "音樂" }));
  head.appendChild(editButton("＋ 新增歌曲", function () { editMusic(null, currentScopeForNew()); }));
  head.appendChild(h("span", {
    class: "page-sub",
    text: S.music.length + " 首 · 每首只在自己的版面（或角色頁）播放"
  }));
  page.appendChild(head);

  if (!canEdit()) {
    page.appendChild(h("div", { class: "empty" },
      "這裡是音樂管理頁。要上傳或更換歌曲，請開啟「編輯模式」（或在 Spherse 裡操作）。"));
  }

  /* ── 版面歌曲（按版面分組，包含各角色頁） ── */
  if (!S.music.length) {
    page.appendChild(h("div", {
      class: "empty",
      text: canEdit()
        ? "還沒有歌曲。點右上「＋ 新增歌曲」，選它要播的版面（也可以選某個角色）。"
        : "還沒有歌曲。"
    }));
    return page;
  }

  var scopeOpts = buildMusicScopeOptions();
  var groups = {};
  S.music.forEach(function (m) {
    var k = String(m.page || "all");
    if (!groups[k]) groups[k] = [];
    groups[k].push(m);
  });
  var keys = [];
  scopeOpts.forEach(function (o) { if (groups[o.value]) keys.push(o.value); });
  Object.keys(groups).forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); });

  keys.forEach(function (k) {
    var list = groups[k];
    var block = h("div", { class: "song-group" });

    var gh = h("div", { class: "song-group-head" });
    gh.appendChild(h("span", { class: "song-badge", text: scopeLabel(k) }));
    gh.appendChild(h("span", { class: "count", text: list.length + " 首" }));
    if (canEdit()) {
      gh.appendChild(h("button", {
        class: "btn small", text: "＋ 加一首",
        onclick: function () { editMusic(null, k); }
      }));
    }
    block.appendChild(gh);

    var rows = h("div", { class: "song-list" });
    list.forEach(function (m) {
      var row = h("div", { class: "song-row" });
      var main = h("div", { class: "song-main" });
      main.appendChild(h("span", { class: "song-name", text: m.title || (m.src || "").split("/").pop() || "未命名" }));
      main.appendChild(h("span", { class: "song-src", text: m.src || "" }));
      row.appendChild(main);

      var play = h("button", { class: "btn small", text: "▶ 試聽" });
      play.addEventListener("click", function () { playPreview(m.src, play); });
      row.appendChild(play);

      if (canEdit()) {
        row.appendChild(h("button", { class: "btn small", text: "編輯／改名", onclick: function () { editMusic(m.id); } }));
        row.appendChild(h("button", { class: "btn small danger", text: "刪除", onclick: function () { deleteMusic(m.id); } }));
      }
      rows.appendChild(row);
    });
    block.appendChild(rows);
    page.appendChild(block);
  });

  return page;
}

/* ── 版面音樂 ─────────────────────────────── */
var musicAudio = null, musicDockEl = null, musicBtn = null, musicSrcNow = "";
var currentViewName = "home";
var MUSIC_VOLUME = 0.7;   /* 比原本小 30% */

/* ── 隨機播放 ─────────────────────────────── */
/* 隨機播放：固定開啟，不需要按鈕 */
var shuffleMode = true;

function allSongs() {
  var out = [], seen = {};
  S.music.forEach(function (m) {
    if (m.src && !seen[m.src]) { seen[m.src] = 1; out.push(m.src); }
  });
  S.characters.forEach(function (c) {
    parseSongs(c.bgm).forEach(function (s) {
      if (s && !seen[s]) { seen[s] = 1; out.push(s); }
    });
  });
  return out;
}

function pickRandomSong(exclude) {
  var pool = currentPool.filter(function (s) { return s !== exclude; });
  if (!pool.length) pool = currentPool.slice();          /* 只有一首時就重播那首 */
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

/* 這一頁（或這位角色）專屬的歌曲池 */
var currentPool = [];

function scopeSongs(view, character) {
  var list = null;

  /* 角色頁：優先播「這一頁（這個角色）」專屬的曲目 */
  if (character) {
    var own = S.music.filter(function (m) { return m.src && m.page === "char:" + character.id; });
    if (own.length) list = own;
  }

  /* 其他情況：播該版面設定的歌（或「全部版面」的歌） */
  if (!list) {
    list = S.music.filter(function (m) {
      return m.src && (!m.page || m.page === "all" || m.page === view);
    });
  }

  return {
    pool: list.map(function (m) { return m.src; }),
    label: (character && list.length && list[0].page === "char:" + character.id) ? (character.name || "") : ""
  };
}

function playRandomNext() {
  var next = pickRandomSong(musicSrcNow);
  if (!next || !musicAudio) return;
  musicSrcNow = next;
  musicAudio.src = next;
  playFade(musicAudio, MUSIC_VOLUME);
  setMusicState(true);
}

/* 一位角色可以有多首歌：以換行分隔存在 bgm 欄位
   每行格式：「名稱 | media/檔名.mp3」；只寫路徑也行（用檔名顯示） */
function parseSongEntries(str) {
  return String(str || "").split("\n").map(function (s) { return s.trim(); }).filter(Boolean).map(function (line) {
    var i = line.indexOf("|");
    if (i > 0) {
      var name = line.slice(0, i).trim();
      var src = line.slice(i + 1).trim();
      if (src) return { name: name || src.split("/").pop(), src: src };
    }
    return { name: line.split("/").pop(), src: line };
  });
}

function parseSongs(str) {
  return parseSongEntries(str).map(function (e) { return e.src; });
}

function songsText(list) {
  return list.map(function (e) {
    var base = String(e.src || "").split("/").pop();
    return (e.name && e.name !== base) ? (e.name + " | " + e.src) : e.src;
  }).filter(Boolean).join("\n");
}

/* 全域單一播放：任何時間只允許一個音檔在響 */
var audioRegistry = [];

function registerAudio(a) {
  if (a && audioRegistry.indexOf(a) < 0) audioRegistry.push(a);
  return a;
}

function stopOtherAudio(keep) {
  audioRegistry.forEach(function (a) {
    if (!a || a === keep) return;
    try {
      if (!a.paused) { a.pause(); a.currentTime = 0; }
    } catch (e) { /* 忽略 */ }
  });
}

/* 播放並在 1.6 秒內淡入到指定音量 */
function playFade(audio, targetVol) {
  if (!audio) return null;
  registerAudio(audio);
  stopOtherAudio(audio);
  var target = (targetVol == null) ? MUSIC_VOLUME : targetVol;
  audio.volume = 0;
  var p = audio.play();
  var startTs = null;
  function step(ts) {
    if (startTs === null) startTs = ts;
    var t = Math.min(1, (ts - startTs) / 1600);
    try { audio.volume = Math.max(0, Math.min(1, target * t)); } catch (e) { /* 忽略 */ }
    if (t < 1 && !audio.paused) requestAnimationFrame(step);
    else { try { audio.volume = target; } catch (e2) { /* 忽略 */ } }
  }
  if (p && p.then) {
    p.then(function () { requestAnimationFrame(step); }).catch(function () { /* 自動播放被擋 */ });
  } else {
    requestAnimationFrame(step);
  }
  return p;
}

/* 淡出後停止（離開該頁面時用） */
function fadeOutStop(audio) {
  if (!audio || audio.paused) {
    if (audio) { try { audio.pause(); } catch (e) { /* 忽略 */ } }
    return;
  }
  var from = audio.volume;
  var startTs = null;
  function step(ts) {
    if (startTs === null) startTs = ts;
    var t = Math.min(1, (ts - startTs) / 420);
    try { audio.volume = Math.max(0, from * (1 - t)); } catch (e) { /* 忽略 */ }
    if (t < 1 && !audio.paused) requestAnimationFrame(step);
    else { try { audio.pause(); audio.removeAttribute("src"); audio.load(); } catch (e2) { /* 忽略 */ } }
  }
  requestAnimationFrame(step);
}

var VIEW_LABELS = {
  all: "全部版面", home: "總覽", characters: "人物", graph: "關係圖",
  timeline: "時間綫", map: "地圖", gallery: "畫廊", wiki: "百科", stories: "故事", music: "音樂"
};

function setMusicState(playing) {
  if (!musicBtn) return;
  musicBtn.classList.toggle("playing", playing);
  var txt = musicBtn.querySelector(".bgm-txt");
  if (txt) txt.textContent = playing ? "播放中" : "點擊播放";
}

/* 是否被當成「聊天卡片」渲染（此時不要自動播音樂） */
function isChatCard() {
  try {
    var rt = window.spherse && window.spherse.runtime;
    return !!(rt && rt.sessionId);
  } catch (e) { return false; }
}

function initMusicDock() {
  musicDockEl = h("div", { class: "music-dock" });
  musicAudio = h("audio", { loop: !shuffleMode, preload: "auto" });
  musicBtn = h("button", { class: "bgm-btn", title: "播放／暫停" });
  musicBtn.appendChild(h("span", { class: "bgm-ico", text: "♪" }));
  musicBtn.appendChild(h("span", { class: "bgm-txt", text: "點擊播放" }));
  musicBtn.addEventListener("click", function () {
    if (!musicAudio.getAttribute("src")) {
      if (shuffleMode && currentPool.length) {
        playRandomNext();
        return;
      }
      var route = parseRoute();
      editMusic(null, route.view === "home" ? "all" : route.view);
      return;
    }
    if (musicAudio.paused) {
      playFade(musicAudio, MUSIC_VOLUME);
      setTimeout(function () { if (!musicAudio.paused) setMusicState(true); }, 120);
      musicAudio.addEventListener("playing", function once() {
        setMusicState(true);
        musicAudio.removeEventListener("playing", once);
      });
    } else {
      musicAudio.pause();
      setMusicState(false);
    }
  });

  var addBtn = h("button", { class: "music-add", title: "為這個版面加入音樂", text: "＋" });
  addBtn.addEventListener("click", function () {
    var route = parseRoute();
    editMusic(null, route.view === "home" ? "all" : route.view);
  });

  musicAudio.addEventListener("ended", function () {
    if (shuffleMode) playRandomNext();
    else setMusicState(false);
  });

  musicDockEl.appendChild(musicAudio);
  musicDockEl.appendChild(musicBtn);
  musicDockEl.appendChild(addBtn);
  document.body.appendChild(musicDockEl);
  registerAudio(musicAudio);
}

function updateMusicFor(view, character) {
  if (!musicDockEl) return;   /* 聊天卡片不會建立播放器，直接跳過 */
  currentViewName = view || "home";
  var editable = canEdit();
  var addBtn = musicDockEl.querySelector(".music-add");
  if (addBtn) addBtn.style.display = editable ? "inline-flex" : "none";

  /* 1. 先取「這一頁」的歌曲池：角色頁＝該角色的歌；其他頁＝該版面／全部版面的歌 */
  /* 2. 隨機模式只在這個池子裡跳，不會播到別人的歌 */
  var scoped = scopeSongs(view, character);
  currentPool = scoped.pool;
  if (musicAudio) musicAudio.loop = !shuffleMode;

  var src = "";
  var label = scoped.label ? scoped.label.replace(/ · $/, "") : "隨機播放";
  if (currentPool.length) {
    src = (musicSrcNow && currentPool.indexOf(musicSrcNow) >= 0)
      ? musicSrcNow
      : currentPool[Math.floor(Math.random() * currentPool.length)];
  }
  if (!src) {
    if (musicSrcNow) fadeOutStop(musicAudio);
    musicSrcNow = "";
    setMusicState(false);
    if (!editable) {
      musicDockEl.classList.add("hidden");
      return;
    }
    musicDockEl.classList.remove("hidden");
    musicDockEl.classList.add("empty");
    var t = musicBtn.querySelector(".bgm-txt");
    if (t) t.textContent = "此頁無音樂 · ＋加入";
    return;
  }

  musicDockEl.classList.remove("hidden");
  musicDockEl.classList.remove("empty");
  if (src !== musicSrcNow) {
    if (musicSrcNow && !musicAudio.paused) {
      /* 換歌：先淡出舊的再換 */
      fadeOutStop(musicAudio);
      setTimeout(function () {
        musicSrcNow = src;
        musicAudio.src = src;
        setMusicState(false);
        playFade(musicAudio, MUSIC_VOLUME);
        musicAudio.addEventListener("playing", function once() {
          setMusicState(true);
          musicAudio.removeEventListener("playing", once);
        });
      }, 260);
    } else {
      musicSrcNow = src;
      musicAudio.src = src;
      setMusicState(false);
      playFade(musicAudio, MUSIC_VOLUME);
      musicAudio.addEventListener("playing", function once() {
        setMusicState(true);
        musicAudio.removeEventListener("playing", once);
      });
    }
  }
  var txt2 = musicBtn.querySelector(".bgm-txt");
  if (txt2 && musicAudio.paused) txt2.textContent = label ? "點擊播放 · " + label.replace(/ · $/, "") : "點擊播放";
}

/* ── 首屏隨機背景圖 ───────────────────── */
var homeRandomTimer = null;

function randomPool() {
  var avatars = {};
  S.characters.forEach(function (c) { if (c.image) avatars[c.image] = 1; });
  return S.gallery.filter(function (g) { return g.image && !avatars[g.image]; });
}

function heroBackdrop() {
  var pool = randomPool();
  if (!pool.length) return null;

  var bg = h("div", { class: "hero-bg" });
  var img = h("img", { alt: "" });
  bg.appendChild(img);
  bg.appendChild(h("span", { class: "hero-bg-scrim" }));

  var last = -1;
  function pick() {
    if (pool.length === 1) {
      img.src = pool[0].image;
      return;
    }
    var i = last;
    while (i === last) i = Math.floor(Math.random() * pool.length);
    last = i;
    img.style.opacity = "0";
    setTimeout(function () {
      img.src = pool[i].image;
      img.style.opacity = "";
    }, 260);
  }
  pick();

  if (homeRandomTimer) clearInterval(homeRandomTimer);
  homeRandomTimer = setInterval(pick, 12000);
  return bg;
}

/* ── 故事 ─────────────────────────────────── */
function storiesPage() {
  var page = h("div", { class: "page" });
  var head = h("div", { class: "page-head" });
  head.appendChild(h("h1", { text: "背景故事" }));
  head.appendChild(editButton("＋ 新增故事", function () { editStory(null); }));
  var totalCh = 0;
  S.stories.forEach(function (s) { totalCh += splitChapters(s).length; });
  head.appendChild(h("span", {
    class: "page-sub",
    text: S.stories.length + " 篇 · " + totalCh + " 章"
  }));
  page.appendChild(head);

  if (!S.stories.length) {
    page.appendChild(h("div", {
      class: "empty",
      text: editMode
        ? "還沒有故事，點右上「＋ 新增故事」。內容裡用 === 章節標題 === 分行，就會自動分章。"
        : "這個世界還沒有寫下任何故事。"
    }));
    return page;
  }

  var list = h("div", { class: "story-list" });

  S.stories.forEach(function (s) {
    var chapters = splitChapters(s);
    var readCount = chapters.filter(function (ch) { return isRead(s.id, ch.index); }).length;
    var povs = storyPovs(s);

    var box = h("div", { class: "card story-block" });

    var top = h("div", { class: "story-block-head" });
    top.appendChild(h("a", { class: "story-link", href: "#/stories/" + s.id + "/0" },
      h("h3", { text: s.title || "未命名故事" })));
    if (s.form && s.form !== "敘述") top.appendChild(h("span", { class: "badge form", text: s.form }));
    if (povs.length > 1) top.appendChild(h("span", { class: "badge pov", text: "多視角 " + povs.length }));
    top.appendChild(h("span", { class: "badge", text: chapters.length + " 章" }));
    top.appendChild(h("span", { class: "badge read", text: readCount + "/" + chapters.length + " 已讀" }));

    var acts = h("div", { class: "row-actions" });
    acts.appendChild(h("a", {
      class: "btn small",
      href: "#/stories/" + s.id + "/" + Math.min(readCount, chapters.length - 1),
      text: readCount ? "繼續閱讀" : "開始閱讀"
    }));
    if (canEdit()) {
      acts.appendChild(h("button", { class: "btn small", text: "編輯", onclick: function () { editStory(s.id); } }));
      acts.appendChild(h("button", { class: "btn small danger", text: "刪除", onclick: function () { deleteStory(s.id); } }));
      acts.appendChild(h("button", {
        class: "btn small", text: "全部標為未讀",
        onclick: function () {
          chapters.forEach(function (ch) { markRead(s.id, ch.index, false); });
          render();
          toast("已重設閱讀進度");
        }
      }));
    }
    top.appendChild(acts);
    box.appendChild(top);

    var chapList = h("div", { class: "chapter-list" });
    chapters.forEach(function (ch) {
      var done = isRead(s.id, ch.index);
      var row = h("div", { class: "chapter-row" + (done ? " done" : "") });
      var link = h("a", { class: "chapter-link", href: "#/stories/" + s.id + "/" + ch.index });
      link.appendChild(h("span", { class: "chapter-idx", text: ("0" + (ch.index + 1)).slice(-2) }));
      link.appendChild(h("span", { class: "chapter-title", text: ch.title }));
      row.appendChild(link);
      row.appendChild(h("span", {
        class: "chapter-meta",
        text: ch.chars.toLocaleString() + " 字" + (ch.date ? " · " + ch.date : "")
      }));
      var dot = h("button", {
        class: "read-dot" + (done ? " on" : ""),
        text: done ? "已讀" : "未讀",
        title: "點擊切換已讀／未讀"
      });
      dot.addEventListener("click", function (e) {
        e.preventDefault();
        markRead(s.id, ch.index, !isRead(s.id, ch.index));
        render();
      });
      row.appendChild(dot);
      chapList.appendChild(row);
    });
    box.appendChild(chapList);
    list.appendChild(box);
  });

  page.appendChild(list);
  return page;
}

function storyCard(s) {
  var chapters = splitChapters(s);
  var card = h("a", { class: "card story-card", href: "#/stories/" + s.id + "/0" });
  card.appendChild(h("h3", { text: s.title || "未命名故事" }));
  var who = csv(s.characters).map(function (id) {
    var c = byId(S.characters, id);
    return c ? c.name : null;
  }).filter(Boolean);
  var meta = [];
  if (s.form && s.form !== "敘述") meta.push(s.form);
  meta.push(chapters.length + " 章");
  if (who.length) meta.push(who.join("、"));
  csv(s.tags).forEach(function (t) { meta.push("#" + t); });
  card.appendChild(h("div", { class: "meta", text: meta.join(" · ") }));
  var plain = String(chapters[0] && chapters[0].body || "").replace(/[*>#]/g, "").replace(/\s+/g, " ").trim();
  if (plain) card.appendChild(h("p", { class: "excerpt", text: plain }));
  return card;
}

function storyPage(id, sub) {
  var page = h("div", { class: "page" });
  var s = byId(S.stories, id);
  page.appendChild(backLink("#/stories", "← 回到故事列表"));

  if (!s) {
    page.appendChild(h("div", { class: "empty", text: "找不到這篇故事。" }));
    return page;
  }

  var chapters = splitChapters(s);
  var idx = parseInt(sub, 10);
  if (isNaN(idx)) idx = 0;
  idx = clamp(idx, 0, chapters.length - 1);
  var ch = chapters[idx];
  markRead(s.id, idx, true);

  var reader = h("div", { class: "reader" });

  /* ── 多視角選項卡 ── */
  var povs = storyPovs(s);
  if (povs.length > 1) {
    var tabs = h("div", { class: "pov-tabs" });
    povs.forEach(function (p) {
      var tab = h("button", { class: "pov-tab" + (p.id === s.id ? " on" : "") });
      tab.appendChild(document.createTextNode(povLabel(p)));
      var pc = p.pov ? byId(S.characters, p.pov) : null;
      if (pc) tab.appendChild(h("span", { class: "pov-who", text: pc.alias || "" }));
      tab.addEventListener("click", function () {
        if (p.id === s.id) return;
        location.hash = "#/stories/" + p.id + "/0";
      });
      tabs.appendChild(tab);
    });
    reader.appendChild(tabs);
  }

  /* ── 標題與資訊 ── */
  var head = h("div", { class: "reader-head" });
  var h1 = h("h1", { class: "reader-title", text: s.title || "未命名故事" });
  head.appendChild(h1);

  var metaRow = h("div", { class: "reader-meta" });
  if (s.form) metaRow.appendChild(h("span", { class: "badge form", text: s.form }));
  if (povs.length > 1) {
    var pcv = s.pov ? byId(S.characters, s.pov) : null;
    metaRow.appendChild(h("span", { class: "badge pov", text: "視角：" + (pcv ? pcv.name : povLabel(s)) }));
  }
  metaRow.appendChild(h("span", { class: "badge", text: "第 " + (idx + 1) + "／" + chapters.length + " 章" }));
  metaRow.appendChild(h("span", { class: "badge", text: ch.chars.toLocaleString() + " 字" }));
  if (ch.date) metaRow.appendChild(h("span", { class: "badge", text: ch.date }));
  var boundEv = byId(S.events, s.eventId);
  if (boundEv) {
    metaRow.appendChild(h("a", {
      class: "chip rel event-chip",
      href: "#/timeline",
      text: "◷ " + (boundEv.date ? boundEv.date + " · " : "") + (boundEv.title || "時間綫節點")
    }));
  }
  head.appendChild(metaRow);

  var acts = h("div", { class: "hero-actions" });
  acts.appendChild(editButton("編輯這篇故事", function () { editStory(s.id); }));
  head.appendChild(acts);
  reader.appendChild(head);

  /* ── 章節選擇列 ── */
  var bar = h("div", { class: "chapter-bar" });
  var sel = h("select", {});
  chapters.forEach(function (c2, i) {
    var opt = h("option", { value: String(i), text: ("0" + (i + 1)).slice(-2) + " · " + c2.title });
    if (i === idx) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.addEventListener("change", function () {
    location.hash = "#/stories/" + s.id + "/" + sel.value;
  });
  bar.appendChild(sel);

  var dot = h("button", {
    class: "read-dot" + (isRead(s.id, idx) ? " on" : ""),
    text: isRead(s.id, idx) ? "已讀" : "未讀"
  });
  dot.addEventListener("click", function () {
    markRead(s.id, idx, !isRead(s.id, idx));
    render();
  });
  bar.appendChild(dot);
  reader.appendChild(bar);

  /* ── 正文（依體裁給版式；信件／日記／檔案加打字機） ── */
  var bodyWrap = h("div", { class: "story-body" });
  var formCls = storyFormClass(s.form);

  if (!formCls) {
    bodyWrap.appendChild(richText(ch.body || "（這一章還沒有內容）"));
  } else {
    var sheet = h("div", { class: "sheet " + formCls });
    var labelRow = h("div", { class: "sheet-label" });
    labelRow.appendChild(h("span", { text: s.form === "信件" ? "LETTER" : s.form === "日記" ? "DIARY" : "CLASSIFIED" }));
    labelRow.appendChild(h("span", { text: ch.date || ch.title }));
    sheet.appendChild(labelRow);

    var textHost = h("div", { class: "sheet-text" });
    sheet.appendChild(textHost);

    var typable = ch.chars <= 1600;
    if (typable) {
      typewriter(textHost, ch.body || "");
      var replay = h("button", { class: "btn small sheet-replay", text: "▶ 重播" });
      replay.addEventListener("click", function (ev) {
        ev.stopPropagation();
        typewriter(textHost, ch.body || "");
      });
      sheet.appendChild(replay);
    } else {
      String(ch.body || "").split(/\n{2,}/).forEach(function (p) {
        if (p.trim()) textHost.appendChild(h("p", { text: p.trim() }));
      });
      sheet.appendChild(h("div", { class: "sheet-label", style: "margin-top:10px" },
        h("span", { text: "（長文不逐字播放）" })));
    }
    bodyWrap.appendChild(sheet);
  }
  reader.appendChild(bodyWrap);

  /* ── 相關人物 ── */
  var who = csv(s.characters).map(function (cid) { return byId(S.characters, cid); }).filter(Boolean);
  if (who.length) reader.appendChild(characterChips(s.characters));

  /* ── 上一章／下一章 ── */
  var nav = h("div", { class: "chapter-nav" });
  var prev = h("a", {
    class: "btn" + (idx <= 0 ? " disabled" : ""),
    href: idx > 0 ? "#/stories/" + s.id + "/" + (idx - 1) : "#/stories/" + s.id + "/0",
    text: "← 上一章"
  });
  nav.appendChild(prev);
  nav.appendChild(h("span", {
    class: "nav-mid",
    text: (idx + 1) + " / " + chapters.length
  }));
  var next = h("a", {
    class: "btn" + (idx >= chapters.length - 1 ? " disabled" : ""),
    href: idx < chapters.length - 1 ? "#/stories/" + s.id + "/" + (idx + 1) : "#/stories/" + s.id + "/" + idx,
    text: "下一章 →"
  });
  nav.appendChild(next);
  reader.appendChild(nav);

  page.appendChild(reader);
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

    { group: "角色頁", k: "status", label: "狀態", ph: "例：存活／便當／失蹤" },
    { k: "trivia", label: "軼事", type: "textarea", rows: 4, wide: true, ph: "空行分段；支援 **粗體**、> 引用" },
    { k: "quotes", label: "台詞（一行一句；要配音寫「台詞 | media/x.mp3」）", type: "textarea", rows: 5, wide: true, ph: "「你以為重來一次就會不一樣嗎？」" },
    { group: "同人設定（面板 / 圖鑑）", k: "voiceActor", label: "腦內聲優", ph: "例：某某聲優" },
    { k: "imprintSong", label: "印象曲", ph: "歌名，或 media/x.mp3" },
    {
      k: "stats", label: "能力數值（雷達圖）", type: "kv", wide: true, addLabel: "新增一項能力",
      hint: "數值 0–10，至少 3 項就會畫出雷達圖；項目名稱可以自己改。",
      cols: [{ label: "能力名稱" }, { label: "數值", type: "number" }]
    },
    {
      k: "forms", label: "形態變化（滑塊對比）", type: "pipe", wide: true, addLabel: "新增一個形態",
      hint: "兩個以上、而且都有圖片，就能左右拖動對比。",
      cols: [{ label: "形態名稱" }, { label: "圖片路徑", type: "image", wide: true }, { label: "說明", wide: true }]
    },
    {
      k: "outfits", label: "服裝 / 裝備圖鑑", type: "pipe", wide: true, addLabel: "新增一套服裝 / 裝備",
      hint: "每一套都會變成一張圖卡，點開可以看大圖與說明。",
      cols: [{ label: "名稱" }, { label: "類型（服裝／裝備…）" }, { label: "圖片路徑", type: "image", wide: true }, { label: "說明", wide: true }]
    },

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
    { k: "eventId", label: "綁定時間綫節點（同一個節點的多篇＝多視角）", type: "select", options: eventOptions(), wide: true },
    {
      k: "pov", label: "視角人物", type: "select",
      options: S.characters.map(function (c) { return { value: c.id, label: c.name || "未命名" }; })
    },
    {
      k: "form", label: "體裁（決定版式）", type: "select", default: "敘述",
      options: [
        { value: "敘述", label: "敘述（普通排版）" },
        { value: "信件", label: "信件（信紙＋打字機）" },
        { value: "日記", label: "日記（日記本＋打字機）" },
        { value: "檔案", label: "檔案（機密檔案＋打字機）" }
      ]
    },
    { k: "characters", label: "涉及人物", type: "multi", options: S.characters.map(function (c) { return { value: c.id, label: c.name || "未命名" }; }), wide: true },
    {
      k: "body", label: "內容", type: "textarea", rows: 14, wide: true,
      ph: "空行分段；支援 **粗體**、*斜體*、> 引用",
      hint: "分章節：一行只寫 === 章節標題 === 就會自動分章。下面兩個按鈕可以直接加。",
      btns: [
        { label: "＋ 新增章節", run: function (ta) { textareaAppend(ta, "=== 新章節 ===\n"); } },
        { label: "＋ 新增帶日期的章節", run: function (ta) { textareaAppend(ta, "=== " + todayStr() + " | 新章節 ===\n"); } }
      ]
    }
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

function entryFields() {
  return [
    { group: "百科詞條", k: "title", label: "詞條名稱", required: true, wide: true, ph: "例：催化機器" },
    { k: "category", label: "分類", ph: "例：地理／組織／歷史事件／概念" },
    { k: "summary", label: "一句話摘要", type: "textarea", rows: 2, wide: true },
    { k: "body", label: "內容（用 [[詞條名]] 建立內鏈）", type: "textarea", rows: 12, wide: true, ph: "提到其他詞條時，寫 [[詞條全名]] 就會自動變成連結。" },
    { k: "related", label: "相關詞條", type: "multi", options: S.entries.map(function (e) { return { value: e.id, label: e.title || "未命名" }; }), wide: true }
  ];
}

function musicFields() {
  return [
    { group: "版面音樂", k: "src", label: "音檔", type: "audio", wide: true, required: true, hint: "支援 mp3 / wav / ogg / m4a（單檔上限 100MB）。上傳失敗時可把檔案放進 media/ 再填 media/檔名.mp3" },
    { k: "title", label: "標題", wide: true, ph: "例：考卷與冰雨" },
    {
      k: "page", label: "播放版面（可選角色頁）", type: "select", default: "all",
      options: buildMusicScopeOptions()
    }
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

  /* 音檔建議清單：把音樂庫與各人物已設定的歌都列出來 */
  if (fields.some(function (f) { return f.type === "audio"; })) {
    var adl = h("datalist", { id: "audioList" });
    var seenAudio = {};
    var addAudio = function (src) {
      var s = String(src || "").trim();
      if (!s || seenAudio[s]) return;
      seenAudio[s] = 1;
      adl.appendChild(h("option", { value: s }));
    };
    S.music.forEach(function (m) { addAudio(m.src); });
    S.characters.forEach(function (c) { addAudio(c.bgm); });
    fields.forEach(function (f) { if (f.type === "audio") addAudio(val(item, f.k)); });
    form.appendChild(adl);
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
    } else if (f.type === "kv" || f.type === "pipe") {
      control = listEditor(f, item || {});
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
    } else if (f.type === "songs") {
      var sWrap = h("div", { class: "songs-field" });
      var sTa = h("textarea", { name: f.k, rows: "4", placeholder: "media/a.mp3\nmedia/b.mp3" });
      sTa.value = val(item, f.k);
      var sBtns = h("div", { class: "songs-btns" });
      var sAdd = h("button", { type: "button", class: "btn small", text: "＋ 上傳並加入" });
      sAdd.addEventListener("click", function () {
        pickAudioFile(function (rel) {
          var cur = String(sTa.value || "").trim();
          if (cur.split("\n").map(function (s) { return s.trim(); }).indexOf(rel) >= 0) return;
          sTa.value = cur ? cur.replace(/\s+$/, "") + "\n" + rel : rel;
        });
      });
      sBtns.appendChild(sAdd);
      sWrap.appendChild(sTa);
      sWrap.appendChild(sBtns);
      control = sWrap;
    } else if (f.type === "audio") {
      var arow = h("div", { class: "image-field" });
      var atext = h("input", { type: "text", name: f.k, placeholder: "media/bgm.mp3，或從清單選已有的歌" });
      atext.setAttribute("list", "audioList");
      atext.value = val(item, f.k);
      var apreview = h("button", { type: "button", class: "btn small", text: "▶", title: "試聽" });
      apreview.addEventListener("click", function () {
        var src = String(atext.value || "").trim();
        if (!src) { toast("還沒有音檔", true); return; }
        var a = new Audio(src);
        a.play().catch(function () { toast("無法播放：路徑可能不對", true); });
      });
      var abtn = h("button", { type: "button", class: "btn small", text: "上傳" });
      abtn.addEventListener("click", function () { pickAudio(atext); });
      arow.appendChild(atext);
      arow.appendChild(apreview);
      arow.appendChild(abtn);
      control = arow;
    } else {
      control = h("input", { type: "text", name: f.k, placeholder: f.ph || "" });
      control.value = val(item, f.k);
      if (f.type === "datalist") control.setAttribute("list", "factionList");
    }

    wrap.appendChild(control);
    if (f.btns && f.btns.length) {
      var bwrap = h("div", { class: "field-btns" });
      f.btns.forEach(function (b) {
        var btn = h("button", { type: "button", class: "btn small", text: b.label });
        btn.addEventListener("click", function () { b.run(control); });
        bwrap.appendChild(btn);
      });
      wrap.appendChild(bwrap);
    }
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
  if (!canEdit()) { toast("唯讀模式無法上傳圖片", true); return; }
  uploadHandler = onDone;
  el("fileInput").click();
}

function pickAudioFile(onDone) {
  if (!canEdit()) { toast("唯讀模式無法上傳音檔", true); return; }
  audioHandler = onDone;
  el("audioInput").click();
}

function pickAudio(textInput) {
  pickAudioFile(function (relPath) {
    textInput.value = relPath;
    toast("音檔已上傳");
  });
}

function putFile(file) {
  if (sdk) {
    return sdk.uploadFile({ dirPath: MEDIA_DIR, data: file }).then(function (res) {
      return stripPrefix(res.path);
    });
  }
  if (ghConfig()) return ghUpload(file);
  return Promise.reject(new Error("未設定寫入方式"));
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
    putFile(file).then(cb).catch(function (err) {
      toast("圖片上傳失敗：" + String((err && err.message) || err), true);
    });
  });

  el("audioInput").addEventListener("change", function () {
    var input = el("audioInput");
    var file = input.files && input.files[0];
    input.value = "";
    if (!file || !audioHandler) return;
    var cb = audioHandler;
    audioHandler = null;
    putFile(file).then(cb).catch(function (err) {
      var msg = String((err && err.message) || err);
      if (/unsupported|type/i.test(msg)) {
        toast("這個格式不被接受：「" + file.name + "」。請改放進 media/ 資料夾，再在欄位填 media/檔名.mp3", true);
      } else {
        toast("音檔上傳失敗：" + msg, true);
      }
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
  gallery: { add: "addGallery", update: "updateGallery", list: function () { return S.gallery; } },
  entry: { add: "addEntry", update: "updateEntry", list: function () { return S.entries; } },
  music: { add: "addMusic", update: "updateMusic", list: function () { return S.music; } }
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
  if (!canEdit()) { toast("唯讀模式無法編輯", true); return; }
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
  if (!canEdit()) { toast("唯讀模式無法編輯", true); return; }
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
  if (!canEdit()) { toast("唯讀模式無法編輯", true); return; }
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
  if (!canEdit()) { toast("唯讀模式無法編輯", true); return; }
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
  if (!canEdit()) { toast("唯讀模式無法編輯", true); return; }
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
  if (!canEdit()) { toast("唯讀模式無法編輯", true); return; }
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
  if (!canEdit()) { toast("唯讀模式無法編輯", true); return; }
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

function editEntry(id) {
  if (!canEdit()) { toast("唯讀模式無法編輯", true); return; }
  var item = id ? byId(S.entries, id) : null;
  openFormModal({
    title: item ? "編輯詞條：" + (item.title || "") : "新增百科詞條",
    fields: entryFields(),
    item: item || {},
    onSubmit: function (values, close, resetSave) {
      saveEntity("entry", values, id).then(close, resetSave);
    },
    onDelete: item ? function () { deleteEntry(id); } : null
  });
}

function deleteEntry(id) {
  var e = byId(S.entries, id);
  if (!e) return;
  if (!window.confirm("刪除詞條「" + (e.title || "未命名") + "」？")) return;
  mutate("removeEntry", { id: id }).then(function () {
    toast("已刪除詞條");
    return load();
  }).catch(reportErr);
}

function editMusic(id, presetPage) {
  if (!canEdit()) { toast("唯讀模式無法編輯", true); return; }
  var item = id ? byId(S.music, id) : null;
  openFormModal({
    title: item ? "編輯歌曲" : "新增歌曲",
    hint: "「播放版面」可以選整個版面，也可以選某一位角色的頁面——那首歌就只會在他／她的頁面播放。改「標題」就是替歌曲改名。",
    fields: musicFields(),
    item: item || { page: presetPage || "all" },
    onSubmit: function (values, close, resetSave) {
      var src = String(values.src || "").trim();
      if (/^https?:\/\//i.test(src) && !/\.(mp3|wav|ogg|m4a|flac|aac|opus)(\?|#|$)/i.test(src)) {
        toast("這看起來是網頁連結，不是音檔網址。請貼 .mp3 等音檔的直連網址，或按「上傳」選檔", true);
        resetSave();
        return;
      }
      saveEntity("music", values, id).then(close, resetSave);
    },
    onDelete: item ? function () { deleteMusic(id); } : null
  });
}

function deleteMusic(id) {
  var m = byId(S.music, id);
  if (!m) return;
  if (!window.confirm("刪除這首音樂？")) return;
  mutate("removeMusic", { id: id }).then(function () {
    toast("已刪除音樂");
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

/* ══════════════════════════════════════════
   章節閱讀 / 多視角 / 體裁 / 形態對比 / 圖鑑 / 雷達
   ══════════════════════════════════════════ */

/* ── 已讀標記（localStorage） ─────────────── */
var READ_KEY = "oc-world:read";

function readMapAll() {
  try { return JSON.parse(localStorage.getItem(READ_KEY) || "{}") || {}; }
  catch (e) { return {}; }
}
function saveReadMapAll(m) {
  try { localStorage.setItem(READ_KEY, JSON.stringify(m)); } catch (e) { /* 忽略 */ }
}
function isRead(sid, idx) { return !!readMapAll()[sid + ":" + idx]; }
function markRead(sid, idx, on) {
  var m = readMapAll(), k = sid + ":" + idx;
  if (on) m[k] = 1; else delete m[k];
  saveReadMapAll(m);
}

function countChars(t) {
  return String(t || "").replace(/[\s\u3000]/g, "").length;
}

/* ── 章節切分：=== 標題 === 或 === 日期 | 標題 === ── */
var CH_HEAD = /^\s*={2,}\s*(.+?)\s*={2,}\s*$/;

function splitChapters(s) {
  var lines = String((s && s.body) || "").split("\n");
  var found = false;
  var cur = { title: "", date: "", lines: [] };
  var raw = [];

  lines.forEach(function (ln) {
    var m = ln.match(CH_HEAD);
    if (!m) { cur.lines.push(ln); return; }
    found = true;
    if (cur.title || cur.lines.join("").trim()) raw.push(cur);
    var head = m[1].trim();
    var title = head, date = "";
    var parts = head.split("|");
    if (parts.length > 1) {
      var a = parts[0].trim(), b = parts[1].trim();
      if (/^\d{4}[-/.]\d{1,2}([-/.]\d{1,2})?$/.test(a)) { date = a; title = b; }
      else { title = a; date = b; }
    }
    cur = { title: title, date: date, lines: [] };
  });
  if (found) { if (cur.title || cur.lines.join("").trim()) raw.push(cur); }
  else raw.push({ title: "", date: "", lines: lines });

  if (!raw.length) raw.push({ title: "", date: "", lines: [] });

  return raw.map(function (c, i) {
    var text = c.lines.join("\n").replace(/^\s+|\s+$/g, "");
    return {
      index: i,
      title: c.title || ("第 " + (i + 1) + " 章"),
      date: c.date || "",
      body: text,
      chars: countChars(text)
    };
  });
}

/* ── 同一事件的其他視角 ─────────────────── */
function storyPovs(s) {
  if (!s || !s.eventId) return [s];
  var sibs = S.stories.filter(function (x) { return x.eventId === s.eventId; });
  return sibs.length ? sibs : [s];
}

function povLabel(s) {
  var c = s && s.pov ? byId(S.characters, s.pov) : null;
  return c ? c.name : (s && s.title) || "未命名";
}

/* ── 體裁版式 ─────────────────────────────── */
function storyFormClass(form) {
  var f = String(form || "").trim();
  if (f === "信件") return "sheet-letter";
  if (f === "日記") return "sheet-diary";
  if (f === "檔案" || f === "報告") return "sheet-file";
  return "";
}

/* ── 打字機效果 ───────────────────────────── */
function typewriter(host, text) {
  host.innerHTML = "";
  var paras = String(text || "").split(/\n{2,}/);
  var pEls = paras.map(function () {
    var p = h("p", {});
    host.appendChild(p);
    return p;
  });
  var pi = 0, ci = 0, done = false, timer = null;

  function finish() {
    if (done) return;
    done = true;
    clearTimeout(timer);
    pEls.forEach(function (el2, i) { el2.textContent = paras[i]; });
    host.classList.remove("tw-caret");
  }
  function step() {
    if (done) return;
    if (pi >= paras.length) { finish(); return; }
    var p = paras[pi];
    if (ci >= p.length) {
      pi++; ci = 0;
      timer = setTimeout(step, 240);
      return;
    }
    var ch = p.charAt(ci++);
    pEls[pi].textContent += ch;
    var delay = /[。！？…]/.test(ch) ? 190 : /[，、；：]/.test(ch) ? 110 : 26;
    timer = setTimeout(step, delay);
  }
  host.classList.add("tw-caret");
  step();
  host.addEventListener("click", finish, { once: true });
  return finish;
}

/* ── 能力數值 → 雷達圖 ───────────────────── */
function parseStats(str) {
  var out = [];
  String(str || "").split(/[\n,，]/).forEach(function (line) {
    var m = line.match(/^\s*([^:：]+)[:：]\s*(-?\d+(?:\.\d+)?)/);
    if (!m) return;
    out.push({ k: m[1].trim(), v: clamp(parseFloat(m[2]), 0, 10) });
  });
  return out;
}

function radarChart(stats, color) {
  if (!stats || stats.length < 3) return null;
  var n = stats.length, BOX = 300, c = BOX / 2, R = 100;
  var svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "radar");
  svg.setAttribute("viewBox", "0 0 " + BOX + " " + BOX);

  function pt(i, ratio) {
    var ang = (i / n) * Math.PI * 2 - Math.PI / 2;
    return [c + Math.cos(ang) * R * ratio, c + Math.sin(ang) * R * ratio];
  }

  [0.25, 0.5, 0.75, 1].forEach(function (r) {
    var poly = document.createElementNS(NS, "polygon");
    var pts = [];
    for (var i = 0; i < n; i++) { var p = pt(i, r); pts.push(p[0].toFixed(1) + "," + p[1].toFixed(1)); }
    poly.setAttribute("points", pts.join(" "));
    poly.setAttribute("class", "radar-ring");
    svg.appendChild(poly);
  });

  for (var i = 0; i < n; i++) {
    var p = pt(i, 1);
    var ln = document.createElementNS(NS, "line");
    ln.setAttribute("x1", c); ln.setAttribute("y1", c);
    ln.setAttribute("x2", p[0]); ln.setAttribute("y2", p[1]);
    ln.setAttribute("class", "radar-spoke");
    svg.appendChild(ln);
  }

  var shape = document.createElementNS(NS, "polygon");
  var pts2 = [];
  stats.forEach(function (st, j) {
    var q = pt(j, st.v / 10);
    pts2.push(q[0].toFixed(1) + "," + q[1].toFixed(1));
  });
  shape.setAttribute("points", pts2.join(" "));
  shape.setAttribute("fill", color);
  shape.setAttribute("fill-opacity", "0.2");
  shape.setAttribute("stroke", color);
  shape.setAttribute("stroke-width", "2");
  shape.setAttribute("stroke-linejoin", "round");
  svg.appendChild(shape);

  stats.forEach(function (st, j) {
    var q = pt(j, st.v / 10);
    var dot = document.createElementNS(NS, "circle");
    dot.setAttribute("cx", q[0]); dot.setAttribute("cy", q[1]);
    dot.setAttribute("r", "3.2");
    dot.setAttribute("fill", color);
    svg.appendChild(dot);

    var lp = pt(j, 1.19);
    var t = document.createElementNS(NS, "text");
    t.setAttribute("x", lp[0]); t.setAttribute("y", lp[1]);
    t.setAttribute("class", "radar-label");
    t.setAttribute("text-anchor", Math.abs(lp[0] - c) < 14 ? "middle" : (lp[0] > c ? "start" : "end"));
    t.textContent = st.k + " " + st.v;
    svg.appendChild(t);
  });

  return svg;
}

/* ── 形態 / 服裝解析（一行一項，用 | 分隔） ── */
function pipeLines(str) {
  return String(str || "").split("\n").map(function (l) { return l.trim(); }).filter(Boolean);
}

function parseForms(str) {
  return pipeLines(str).map(function (line) {
    var p = line.split("|").map(function (x) { return x.trim(); });
    return { name: p[0] || "", image: p[1] || "", desc: p.slice(2).join(" | ") };
  });
}

function parseOutfits(str) {
  return pipeLines(str).map(function (line) {
    var p = line.split("|").map(function (x) { return x.trim(); });
    return { name: p[0] || "", type: p[1] || "", image: p[2] || "", desc: p.slice(3).join(" | ") };
  });
}

/* ── 左右拖動對比兩張圖 ─────────────────── */
function compareSlider(a, b, labelA, labelB) {
  var box = h("div", { class: "compare" });
  var imgA = h("img", { src: a.image || "", alt: a.name || "" });
  var holder = h("div", { class: "cmp-b-hold" }, h("img", { src: b.image || "", alt: b.name || "" }));
  var handle = h("div", { class: "cmp-handle" }, h("span", { class: "cmp-knob", text: "⇄" }));
  box.appendChild(imgA);
  box.appendChild(holder);
  box.appendChild(handle);
  box.appendChild(h("span", { class: "cmp-tag cmp-tag-a", text: labelA || a.name || "" }));
  box.appendChild(h("span", { class: "cmp-tag cmp-tag-b", text: labelB || b.name || "" }));

  function set(p) {
    p = clamp(p, 0, 100);
    holder.style.clipPath = "inset(0 " + (100 - p) + "% 0 0)";
    handle.style.left = p + "%";
  }
  set(50);

  var dragging = false;
  function pct(ev) {
    var r = box.getBoundingClientRect();
    if (!r.width) return 50;
    return ((ev.clientX - r.left) / r.width) * 100;
  }
  box.addEventListener("pointerdown", function (ev) {
    dragging = true;
    set(pct(ev));
    try { box.setPointerCapture(ev.pointerId); } catch (e) { /* 忽略 */ }
    ev.preventDefault();
  });
  box.addEventListener("pointermove", function (ev) { if (dragging) set(pct(ev)); });
  box.addEventListener("pointerup", function () { dragging = false; });
  box.addEventListener("pointercancel", function () { dragging = false; });
  return box;
}

/* ── 音樂版面（含角色頁） ───────────────── */
function buildMusicScopeOptions() {
  var opts = [
    { value: "all", label: "全部版面" },
    { value: "home", label: "總覽" },
    { value: "characters", label: "人物列表" },
    { value: "graph", label: "關係圖" },
    { value: "timeline", label: "時間綫" },
    { value: "map", label: "地圖" },
    { value: "gallery", label: "畫廊" },
    { value: "wiki", label: "百科" },
    { value: "stories", label: "故事" }
  ];
  S.characters.forEach(function (c) {
    opts.push({ value: "char:" + c.id, label: (c.name || "未命名") + "（角色頁）" });
  });
  return opts;
}

function scopeLabel(page) {
  var p = String(page || "");
  if (p.indexOf("char:") === 0) {
    var c = byId(S.characters, p.slice(5));
    return c ? (c.name || "未命名") + " 的角色頁" : "（已刪除的角色）";
  }
  return VIEW_LABELS[p] || p || "全部版面";
}

function currentScopeForNew() {
  var r = parseRoute();
  if (r.view === "characters" && r.id) return "char:" + r.id;
  if (r.view === "music") return "all";
  return r.view || "all";
}

/* ── 清單欄位編輯器（數值 / 形態 / 服裝） ── */
function pickImageInto(input) {
  uploadImage(function (rel) {
    input.value = rel;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function textareaAppend(ta, text) {
  var cur = String(ta.value || "").replace(/\s+$/, "");
  ta.value = (cur ? cur + "\n\n" : "") + text;
  ta.focus();
  try { ta.selectionStart = ta.selectionEnd = ta.value.length; } catch (e) { /* 忽略 */ }
}

function todayStr() {
  var d = new Date();
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

function listEditor(f, item) {
  var mode = f.type;                       /* "kv" = 名稱:數值；"pipe" = 名稱 | 圖 | 說明 */
  var cols = f.cols || [];
  var wrapEl = h("div", { class: "list-editor" });
  var hidden = h("input", { type: "hidden", name: f.k });
  var rows = [];

  function parseText(text) {
    var src = String(text || "").split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
    return src.map(function (line) {
      if (mode === "kv") {
        var m = line.match(/^([^:：]+)[:：]\s*(.*)$/);
        return m ? [m[1].trim(), m[2].trim()] : [line, ""];
      }
      var parts = line.split("|").map(function (x) { return x.trim(); });
      var out = [];
      for (var i = 0; i < cols.length; i++) out.push(parts[i] || "");
      return out;
    });
  }

  function sync() {
    var lines = [];
    rows.forEach(function (r) {
      if (mode === "kv") {
        if (!String(r[0] || "").trim() && !String(r[1] || "").trim()) return;
        lines.push(String(r[0] || "").trim() + ": " + String(r[1] || "").trim());
        return;
      }
      var vals = r.slice();
      while (vals.length > 1 && !String(vals[vals.length - 1] || "").trim()) vals.pop();
      if (!vals.join("").trim()) return;
      lines.push(vals.map(function (x) { return String(x || "").trim(); }).join(" | "));
    });
    hidden.value = lines.join("\n");
  }

  rows = parseText(val(item, f.k));
  hidden.value = val(item, f.k);

  var rowsHost = h("div", { class: "le-rows" });

  function paint() {
    rowsHost.innerHTML = "";
    if (!rows.length) {
      rowsHost.appendChild(h("div", { class: "le-empty", text: "還沒有項目，按下面「＋ 新增一項」。" }));
    }
    rows.forEach(function (r, i) {
      var rowEl = h("div", { class: "le-row" });
      cols.forEach(function (col, j) {
        var cell = h("div", { class: "le-cell" + (col.wide ? " wide" : "") });
        var input = h("input", {
          type: col.type === "number" ? "number" : "text",
          placeholder: col.label || ""
        });
        if (col.type === "number") { input.min = "0"; input.max = "10"; input.step = "1"; }
        input.value = r[j] || "";
        input.addEventListener("input", function () { rows[i][j] = input.value; sync(); });
        cell.appendChild(input);
        if (col.type === "image") {
          cell.classList.add("with-btn");
          var up = h("button", { type: "button", class: "btn small", text: "上傳", title: "上傳圖片" });
          up.addEventListener("click", function () { pickImageInto(input); });
          cell.appendChild(up);
        }
        rowEl.appendChild(cell);
      });
      var del = h("button", { type: "button", class: "btn small danger le-del", text: "✕", title: "刪除這一行" });
      del.addEventListener("click", function () { rows.splice(i, 1); sync(); paint(); });
      rowEl.appendChild(del);
      rowsHost.appendChild(rowEl);
    });
  }

  var addBtn = h("button", {
    type: "button", class: "btn small",
    text: "＋ " + (f.addLabel || "新增一項")
  });
  addBtn.addEventListener("click", function () {
    var blank = cols.map(function () { return ""; });
    if (mode === "kv") blank = ["新項目", "5"];
    rows.push(blank);
    sync();
    paint();
    var lastRow = rowsHost.querySelector(".le-row:last-child input");
    if (lastRow) lastRow.focus();
  });

  wrapEl.appendChild(hidden);
  wrapEl.appendChild(rowsHost);
  wrapEl.appendChild(h("div", { class: "le-actions" }, addBtn));
  paint();
  return wrapEl;
}

/* ── 服裝 / 裝備詳情 ─────────────────────── */
function mediaCard(item, kindLabel, onClick) {
  var card = h("button", { class: "outfit-card", type: "button" });
  var thumb = h("div", { class: "outfit-thumb" });
  if (item.image) thumb.appendChild(h("img", { src: item.image, alt: item.name || "", loading: "lazy" }));
  else thumb.appendChild(h("span", { class: "ph", text: "◇" }));
  card.appendChild(thumb);
  var body = h("div", { class: "outfit-body" });
  body.appendChild(h("span", { class: "outfit-name", text: item.name || "未命名" }));
  if (kindLabel) body.appendChild(h("span", { class: "outfit-type", text: kindLabel }));
  card.appendChild(body);
  card.addEventListener("click", onClick);
  return card;
}

function openOutfitDetail(o) {
  var host = el("modalHost");
  host.innerHTML = "";
  var box = h("div", { class: "modal outfit-detail" });
  if (o.image) box.appendChild(h("img", { class: "od-img", src: o.image, alt: o.name || "" }));
  box.appendChild(h("h3", { text: o.name || "未命名" }));
  if (o.type) box.appendChild(h("span", { class: "outfit-type", text: o.type }));
  if (o.desc) box.appendChild(richText(o.desc));
  var close = h("button", { class: "btn primary", text: "關閉" });
  box.appendChild(h("div", { class: "modal-actions" }, close));
  var overlay = h("div", { class: "modal-overlay" }, box);
  function shut() { host.innerHTML = ""; }
  close.addEventListener("click", shut);
  overlay.addEventListener("click", function (e) { if (e.target === overlay) shut(); });
  host.appendChild(overlay);
}

/* ── 首屏氛圍：倒轉時鐘 + 碎片粒子 ───────── */
var atmosRaf = null;
var atmosRaf2 = null;
var atmosResize = null;

var CLOCK_SPEEDS = { sec: 12, min: 48, hour: 480, dash: 320 };

function stopAtmosphere() {
  if (atmosRaf) { cancelAnimationFrame(atmosRaf); atmosRaf = null; }
  if (atmosRaf2) { cancelAnimationFrame(atmosRaf2); atmosRaf2 = null; }
}

function startClockSpin(svg) {
  var nodes = {};
  Object.keys(CLOCK_SPEEDS).forEach(function (role) {
    nodes[role] = svg.querySelector('[data-role="' + role + '"]');
  });

  function frame(ts) {
    if (!svg.isConnected) { atmosRaf2 = null; return; }
    var t = ts / 1000;
    Object.keys(CLOCK_SPEEDS).forEach(function (role) {
      var node = nodes[role];
      if (!node) return;
      var deg = (-360 * t / CLOCK_SPEEDS[role]) % 360;
      node.setAttribute("transform", "rotate(" + deg.toFixed(2) + " 200 200)");
    });
    atmosRaf2 = requestAnimationFrame(frame);
  }
  atmosRaf2 = requestAnimationFrame(frame);
}

function buildClockFace() {
  var reduced = false;
  try { reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { /* 忽略 */ }

  var svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "clock");
  svg.setAttribute("viewBox", "0 0 400 400");
  svg.setAttribute("aria-hidden", "true");

  /* 指針由 JS 逐格設定 transform，不依賴 SMIL / CSS transform-origin */
  function tag(node, role) {
    node.setAttribute("data-role", role);
    return node;
  }

  function circle(r, cls) {
    var c = document.createElementNS(NS, "circle");
    c.setAttribute("cx", "200");
    c.setAttribute("cy", "200");
    c.setAttribute("r", String(r));
    c.setAttribute("class", cls);
    return c;
  }

  svg.appendChild(circle(160, "cl-face"));
  svg.appendChild(circle(172, "cl-ring"));
  svg.appendChild(tag(circle(152, "cl-ring-soft"), "dash"));

  for (var i = 0; i < 12; i++) {
    var ang = i * Math.PI / 6;
    var ln = document.createElementNS(NS, "line");
    ln.setAttribute("x1", (200 + Math.sin(ang) * 162).toFixed(1));
    ln.setAttribute("y1", (200 - Math.cos(ang) * 162).toFixed(1));
    ln.setAttribute("x2", (200 + Math.sin(ang) * 172).toFixed(1));
    ln.setAttribute("y2", (200 - Math.cos(ang) * 172).toFixed(1));
    ln.setAttribute("class", "cl-tick");
    svg.appendChild(ln);
  }

  function hand(len, width, cls, role) {
    var g = document.createElementNS(NS, "g");
    var l = document.createElementNS(NS, "line");
    l.setAttribute("x1", "200");
    l.setAttribute("y1", "214");
    l.setAttribute("x2", "200");
    l.setAttribute("y2", String(200 - len));
    l.setAttribute("class", cls);
    l.setAttribute("stroke-width", String(width));
    g.appendChild(l);
    return tag(g, role);
  }

  /* 三支指針都逆時針倒轉：秒 12 秒一圈、分 48 秒、時 480 秒 */
  svg.appendChild(hand(98, 7.5, "cl-line-hour", "hour"));
  svg.appendChild(hand(146, 4.2, "cl-line-min", "min"));
  svg.appendChild(hand(166, 1.8, "cl-line-sec", "sec"));

  svg.appendChild(circle(15, "cl-halo"));
  svg.appendChild(circle(6.5, "cl-center"));

  return svg;
}

function startShards(canvas) {
  var reduced = false;
  try { reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { /* 忽略 */ }

  var ctx = canvas.getContext("2d");
  if (!ctx) return;
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var parts = [], W = 1, H = 1, last = 0;

  function spawn(anyY) {
    return {
      x: Math.random() * W,
      y: anyY ? Math.random() * H : -24,
      w: 2 + Math.random() * 5,
      h: 3 + Math.random() * 9,
      vx: -5 + Math.random() * 10,
      vy: 7 + Math.random() * 15,
      rot: Math.random() * Math.PI,
      vr: -0.3 + Math.random() * 0.6,
      a: 0.1 + Math.random() * 0.26,
      warm: Math.random() < 0.38
    };
  }

  function resize() {
    var r = canvas.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width));
    H = Math.max(1, Math.round(r.height));
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var target = Math.round(Math.min(44, Math.max(12, W / 26)));
    while (parts.length < target) parts.push(spawn(true));
    parts.length = target;
  }

  function frame(ts) {
    if (!canvas.isConnected) { stopAtmosphere(); return; }
    var dt = last ? Math.min(0.05, (ts - last) / 1000) : 0.016;
    last = ts;

    ctx.clearRect(0, 0, W, H);
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.y > H + 26) { p.y = -26; p.x = Math.random() * W; }
      if (p.x < -26) p.x = W + 26;
      else if (p.x > W + 26) p.x = -26;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.warm
        ? "rgba(207,133,80," + p.a.toFixed(3) + ")"
        : "rgba(150,200,220," + p.a.toFixed(3) + ")";
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    atmosRaf = requestAnimationFrame(frame);
  }

  resize();
  if (atmosResize) window.removeEventListener("resize", atmosResize);
  atmosResize = resize;
  window.addEventListener("resize", atmosResize);

  atmosRaf = requestAnimationFrame(frame);
}

function openingAtmosphere() {
  stopAtmosphere();
  var wrap = h("div", { class: "atmos", "aria-hidden": "true" });

  var clockSvg = buildClockFace();
  wrap.appendChild(clockSvg);

  var canvas = h("canvas", { class: "shards" });
  wrap.appendChild(canvas);

  requestAnimationFrame(function () {
    if (clockSvg.isConnected) startClockSpin(clockSvg);
    if (canvas.isConnected) startShards(canvas);
  });
  return wrap;
}

/* ── 時間綫展開狀態 ───────────────────── */
var openEvents = {};

function teaserText(t) {
  var s = String(t || "").replace(/[*>#`_]/g, "").replace(/\s+/g, " ").trim();
  if (!s) return "（還沒有內容，點擊展開）";
  return s.length > 46 ? s.slice(0, 46) + "…" : s;
}

/* ── 主題：淺色 / 深色 ─────────────────── */
var THEME_KEY = "oc-world:theme";

function systemTheme() {
  try { return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"; }
  catch (e) { return "light"; }
}

function applyTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  document.documentElement.style.colorScheme = t;
  var btn = el("themeBtn");
  if (btn) btn.textContent = t === "dark" ? "☾" : "◐";
}

function currentTheme() {
  return document.documentElement.getAttribute("data-theme") || systemTheme();
}

function initTheme() {
  var saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch (e) { /* 忽略 */ }
  applyTheme((saved === "dark" || saved === "light") ? saved : systemTheme());

  var btn = el("themeBtn");
  if (btn) {
    btn.addEventListener("click", function () {
      var next = currentTheme() === "dark" ? "light" : "dark";
      applyTheme(next);
      try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* 忽略 */ }
    });
  }

  try {
    var mq = window.matchMedia("(prefers-color-scheme: dark)");
    if (mq.addEventListener) {
      mq.addEventListener("change", function () {
        var keep = null;
        try { keep = localStorage.getItem(THEME_KEY); } catch (e) { /* 忽略 */ }
        if (!keep) applyTheme(systemTheme());
      });
    }
  } catch (e) { /* 忽略 */ }
}

/* ── 啟動 ─────────────────────────────────── */
function init() {
  initTheme();
  initUpload();
  /* 在聊天卡片裡不建立音樂播放器，避免一出現就自動出聲 */
  if (!isChatCard()) initMusicDock();

  el("editToggle").addEventListener("click", function () {
    if (!canEdit()) {
      toast("尚未設定寫入方式", true);
      return;
    }
    editMode = !editMode;
    el("editToggle").classList.toggle("on", editMode);
    el("editToggle").textContent = editMode ? "完成編輯" : "編輯模式";
    el("modalHost").innerHTML = "";
    render();
    toast(editMode ? "編輯模式：可以新增與修改內容" : "已離開編輯模式");
  });

  /* 雲端寫入已停用，清掉舊的 token 設定 */
  try { localStorage.removeItem(GH_KEY); } catch (e) { /* 忽略 */ }

  window.addEventListener("hashchange", function () {
    render();
    window.scrollTo(0, 0);
  });

  /* 保險：若稍後才判定為聊天卡片，直接移除播放器並停止 */
  setTimeout(function () {
    if (isChatCard() && musicDockEl) {
      try { if (musicAudio) musicAudio.pause(); } catch (e) { /* 忽略 */ }
      musicDockEl.remove();
      musicDockEl = null;
      musicSrcNow = "";
    }
  }, 700);

  detectSdk().then(function (found) {
    sdk = found;
    updateEditAvailability();

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
