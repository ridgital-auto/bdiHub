/* bdiHub — link dikelompokkan per proyek */
const KEY = "bdihub.data.v1";
const OLD_KEY = "linkhub.links.v1"; // kunci lama — dimigrasi otomatis sekali saja
const $ = (id) => document.getElementById(id);

let store = load();          // {version, projects:[], links:[]}
let activeProject = "all";   // "all" | projectId | "none"
let editingLinkId = null;
let editingProjectId = null;
let removeAttachedFile = false;

const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ---------- load + migrasi v1 -> v2 ---------- */
function load() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(KEY)); } catch { /* abaikan */ }
  let fromOldKey = false;
  if (!raw) {
    try { raw = JSON.parse(localStorage.getItem(OLD_KEY)); } catch { /* abaikan */ }
    fromOldKey = !!raw;
  }

  let out;
  if (Array.isArray(raw)) out = migrateV1(raw);              // format lama: array link
  else if (raw && raw.version === 2) out = sanitize(raw);
  else out = { version: 2, updatedAt: 0, projects: [], links: [] };

  if (fromOldKey) {
    // pindahkan ke kunci baru sekali saja, lalu hapus kunci lama
    try {
      localStorage.setItem(KEY, JSON.stringify(out));
      localStorage.removeItem(OLD_KEY);
    } catch { /* abaikan */ }
  }

  return out;
}
function migrateV1(links) {
  const projects = [];
  const byCat = {};
  links.forEach(l => {
    const cat = (l.cat || "").trim();
    if (cat && !byCat[cat]) {
      const p = { id: uid(), name: cat, desc: "", added: Date.now() };
      projects.push(p); byCat[cat] = p.id;
    }
  });
  return {
    version: 2,
    updatedAt: Date.now(),
    projects,
    links: links.map(l => ({
      id: l.id || uid(),
      name: l.name || "Tanpa nama",
      url: l.url || "",
      desc: l.desc || "",
      projectId: (l.cat || "").trim() ? byCat[(l.cat || "").trim()] : null,
      pinned: !!l.pinned,
      hits: l.hits || 0,
      added: l.added || Date.now()
    }))
  };
}
function sanitize(s) {
  return {
    version: 2,
    updatedAt: s.updatedAt || 0,
    projects: Array.isArray(s.projects) ? s.projects : [],
    links: Array.isArray(s.links) ? s.links : []
  };
}

/* ---------- seed bawaan: proyek "game" + 5 game kamera (ditanam 2026-10-20) ---------- */
const GAME_BASE = "https://ridgital-auto.github.io/bdiHub/games/";
const SEED_PROJECT = { id: "game-proj", name: "game", desc: "Kumpulan game kamera & web app anak" };
const SEED_LINKS = [
  { id: "game-link-efek-kamera", name: "Efek Kamera", icon: "📸", url: GAME_BASE + "efek-kamera.html", desc: "Efek kamera cermin untuk Kiki — 105 efek wajah, tombol foto & GIF" },
  { id: "game-link-nose-downhill", name: "Nose Downhill", icon: "🚵", url: GAME_BASE + "nose-downhill.html", desc: "Game kamera downhill sepeda gunung endless" },
  { id: "game-link-bucungs", name: "Bucungs", icon: "😮", url: GAME_BASE + "bucungs.html", desc: "Game runner dikontrol monyong (mulut)" },
  { id: "game-link-wajah-ceria", name: "Wajah Ceria", icon: "😊", url: GAME_BASE + "wajah-ceria.html", desc: "5 mini-game kamera wajah untuk anak" }
];
function seedGames(s) {
  // digabung berdasarkan id — tidak pernah menggandakan, dan kalau user
  // menghapusnya manual, id tetap tercatat di sini hanya bila user yang hapus
  // SETELAH seed pertama; penanda seededGame disimpan terpisah di localStorage.
  let changed = false;
  if (!s.projects.some(p => p.id === SEED_PROJECT.id)) {
    s.projects.push({ ...SEED_PROJECT, added: Date.now() });
    changed = true;
  }
  const ids = new Set(s.links.map(l => l.id));
  SEED_LINKS.forEach(l => {
    if (!ids.has(l.id)) {
      s.links.push({ ...l, projectId: SEED_PROJECT.id, pinned: false, hits: 0, added: Date.now() });
      changed = true;
    }
  });
  return changed;
}

/* link seed yang sudah dihapus permanen oleh user — dibersihkan dari data lama too */
const REMOVED_SEED_IDS = ["game-link-kontrol-mulut"];

/* tanam proyek "game" bawaan sekali saja saat aplikasi dimuat, sekaligus
   membersihkan link seed yang sudah dihapus. Dipanggil di sini (setelah semua
   konstanta siap), BUKAN di dalam load(), karena load() dieksekusi di baris
   paling atas sebelum konstanta SEED_* ada. */
(function maintainSeeds() {
  let changed = false;
  let seeded = false;
  try { seeded = localStorage.getItem("bdihub.seeded.game.v1") === "1"; } catch { /* abaikan */ }
  if (!seeded) {
    if (seedGames(store)) changed = true;
    try { localStorage.setItem("bdihub.seeded.game.v1", "1"); } catch { /* abaikan */ }
  }
  const before = store.links.length;
  store.links = store.links.filter(l => !REMOVED_SEED_IDS.includes(l.id));
  if (store.links.length !== before) changed = true;
  // lengkapi icon pada link seed yang sudah tertanam sebelum ada fitur icon
  const iconMap = {};
  SEED_LINKS.forEach(s => { iconMap[s.id] = s.icon; });
  store.links.forEach(l => {
    if (iconMap[l.id] && !l.icon) { l.icon = iconMap[l.id]; changed = true; }
  });
  if (changed) {
    store.updatedAt = Date.now();
    try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* abaikan */ }
  }
})();
function saveLocal() {
  store.updatedAt = Date.now();
  localStorage.setItem(KEY, JSON.stringify(store));
}
function save() { saveLocal(); DriveSync.onLocalChange(); }

function normUrl(u) {
  u = u.trim();
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  return u;
}
function domainOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; }
}
function projectName(id) {
  const p = store.projects.find(x => x.id === id);
  return p ? p.name : "Tanpa proyek";
}
function countIn(id) { return store.links.filter(l => l.projectId === id).length; }
function unassigned() { return store.links.filter(l => !l.projectId); }

/* ---------- render ---------- */
function render() {
  const q = $("search").value.trim().toLowerCase();

  // chips proyek
  const chipBox = $("chips");
  chipBox.innerHTML = "";
  const mkChip = (key, label, count) => {
    const b = document.createElement("button");
    b.className = "chip" + (key === activeProject ? " active" : "");
    b.innerHTML = esc(label) + (count != null ? ` <span class="cnt">${count}</span>` : "");
    b.onclick = () => { activeProject = key; render(); };
    chipBox.appendChild(b);
  };
  mkChip("all", "Semua", store.links.length);
  store.projects.forEach(p => mkChip(p.id, "📁 " + p.name, countIn(p.id)));
  if (unassigned().length) mkChip("none", "Tanpa proyek", unassigned().length);
  if (activeProject !== "all" && activeProject !== "none" &&
      !store.projects.some(p => p.id === activeProject)) activeProject = "all";

  // daftar link sesuai filter
  let list = store.links.filter(l =>
    (activeProject === "all" || (activeProject === "none" ? !l.projectId : l.projectId === activeProject)) &&
    (!q || (l.name + " " + (l.desc || "") + " " + domainOf(l.url)).toLowerCase().includes(q))
  );
  list = [...list].sort((a, b) =>
    (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.hits || 0) - (a.hits || 0)
  );

  const grid = $("grid");
  grid.innerHTML = "";
  const totalEmpty = store.links.length === 0;
  $("empty").classList.toggle("hidden", !totalEmpty && list.length > 0);
  if (totalEmpty) {
    $("emptyTitle").textContent = "Belum ada link";
    $("emptyText").innerHTML = "Tambahkan link web app pertama kamu lewat tombol <b>＋ Tambah Link</b>.";
  } else if (list.length === 0) {
    $("emptyTitle").textContent = "Tidak ada link di sini";
    $("emptyText").innerHTML = q
      ? "Tidak ketemu. Coba kata kunci lain."
      : `Proyek <b>${esc(projectName(activeProject))}</b> belum ada link. Klik <b>＋ Tambah Link</b> untuk menambahkannya ke proyek ini.`;
  }

  list.forEach(l => grid.appendChild(card(l)));
}

/* favicon tiap web app: coba file icon di path-nya dulu (GitHub Pages project
   berbagi satu domain, jadi layanan s2 Google yang berbasis domain tidak bisa
   membedakan), baru fallback ke s2, terakhir icon globe. */
function faviconCandidates(url) {
  const list = [];
  try {
    const u = new URL(url);
    let p = u.pathname;
    if (p && p !== "/") {
      if (!p.endsWith("/")) p = p.slice(0, p.lastIndexOf("/") + 1);
      const base = u.origin + p;
      ["favicon.ico", "favicon.svg", "icon.svg", "favicon-32.png", "apple-touch-icon.png", "img/favicon.ico"]
        .forEach(f => list.push(base + f));
    }
    list.push("https://www.google.com/s2/favicons?domain=" + encodeURIComponent(u.hostname) + "&sz=64");
  } catch { /* abaikan */ }
  return list;
}
function attachFavicon(wrap, url) {
  const cands = faviconCandidates(url);
  if (!cands.length) return;
  const img = document.createElement("img");
  img.className = "fav";
  img.loading = "lazy";
  img.alt = "";
  img.referrerPolicy = "no-referrer";
  let i = 0;
  img.onerror = () => { i++; if (i < cands.length) img.src = cands[i]; else img.remove(); };
  img.src = cands[0];
  wrap.appendChild(img);
}

/* download file target link untuk dibuka offline */
function dataURLtoBlob(dataURL) {
  const parts = dataURL.split(",");
  const mime = (parts[0].match(/:(.*?);/) || [])[1] || "application/octet-stream";
  const bin = atob(parts[1] || "");
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
async function downloadLink(l) {
  let fileName = "";
  try {
    const p = new URL(l.url).pathname;
    const f = p.substring(p.lastIndexOf("/") + 1);
    if (f && /\.(html?|zip|pdf|json|txt)$/i.test(f)) fileName = decodeURIComponent(f);
  } catch { /* abaikan */ }
  if (!fileName) fileName = (l.name || "file").replace(/[\\/:*?"<>|]/g, "").trim() + ".html";
  let blob = null;
  if (l.file) {
    try { blob = dataURLtoBlob(l.file); fileName = l.fileName || fileName; } catch { /* abaikan */ }
  }
  if (!blob) {
    try {
      const r = await fetch(l.url);
      if (!r.ok) throw 0;
      blob = await r.blob();
    } catch { /* abaikan */ }
  }
  if (blob) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
  } else if (confirm("Download langsung gagal di situs ini. Buka link-nya saja di tab baru?")) {
    window.open(l.url, "_blank", "noopener");
  }
}
function openFileBlob(l) {
  try {
    const url = URL.createObjectURL(dataURLtoBlob(l.file));
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch { alert("File tidak bisa dibuka ❌"); }
}

function card(l) {
  const el = document.createElement("div");
  el.className = "card" + (l.pinned ? " pinned" : "");
  const dom = domainOf(l.url);
  el.innerHTML = `
    <div class="card-head">
      <span class="favwrap" title="${esc(dom)}">🌐</span>
      <h3>${l.pinned ? '<span class="pin">📌</span>' : ""}${esc(l.name)}</h3>
      <div class="card-tools">
        <button title="Opsi">⋮</button>
        <div class="tools-menu hidden">
          <button data-act="visit">↗ Buka</button>
          <button data-act="dl">⬇️ Download (offline)</button>
          <button data-act="pin">${l.pinned ? "📍 Lepas pin" : "📌 Sematkan"}</button>
          <button data-act="edit">✏️ Edit</button>
          <button data-act="copy">📋 Salin URL</button>
          <button data-act="del" class="danger">🗑️ Hapus</button>
        </div>
      </div>
    </div>
    <span class="badge">📁 ${esc(projectName(l.projectId))}</span>
    ${l.desc ? `<p class="desc">${esc(l.desc)}</p>` : ""}
    <div class="card-foot">
      <div>
        <a class="visit" ${l.file ? "" : `href="${esc(l.url)}" target="_blank" rel="noopener"`}>${l.file ? "Buka ▶" : "Kunjungi ↗"}</a>
        <button class="visit dl" title="Download file ini agar bisa dibuka tanpa buka bdiHub lagi">⬇ Download</button>
        ${l.hits ? `<div class="hits">dibuka ${l.hits}×</div>` : ""}
      </div>
    </div>`;

  const toggle = el.querySelector(".tools-menu");
  if (l.icon) el.querySelector(".favwrap").textContent = l.icon;
  else attachFavicon(el.querySelector(".favwrap"), l.url);
  el.querySelector(".card-tools > button").onclick = (e) => {
    e.stopPropagation();
    document.querySelectorAll(".tools-menu").forEach(m => m !== toggle && m.classList.add("hidden"));
    toggle.classList.toggle("hidden");
  };
  const visitBtn = el.querySelector(".visit");
  if (l.file) {
    visitBtn.onclick = (e) => {
      e.preventDefault();
      l.hits = (l.hits || 0) + 1; save(); openFileBlob(l); setTimeout(render, 300);
    };
  } else {
    visitBtn.onclick = () => { l.hits = (l.hits || 0) + 1; save(); setTimeout(render, 300); };
  }
  el.querySelector(".visit.dl").onclick = (e) => { e.stopPropagation(); downloadLink(l); };
  toggle.onclick = (e) => {
    e.stopPropagation();
    const act = e.target.closest("button")?.dataset.act;
    if (!act) return;
    toggle.classList.add("hidden");
    if (act === "visit") el.querySelector(".visit").click();
    if (act === "dl") downloadLink(l);
    if (act === "pin") { l.pinned = !l.pinned; save(); render(); }
    if (act === "edit") openLinkModal(l);
    if (act === "copy") { navigator.clipboard.writeText(l.url).then(() => alert("URL tersalin ✅")); }
    if (act === "del" && confirm(`Hapus "${l.name}"?`)) {
      store.links = store.links.filter(x => x.id !== l.id); save(); render();
    }
  };
  return el;
}
document.addEventListener("click", () => {
  document.querySelectorAll(".tools-menu").forEach(m => m.classList.add("hidden"));
  $("menu").classList.add("hidden");
});

/* ---------- modal link ---------- */
function fillProjectSelect(sel, selectedId) {
  sel.innerHTML =
    `<option value="">— Tanpa proyek —</option>` +
    store.projects.map(p => `<option value="${p.id}"${p.id === selectedId ? " selected" : ""}>${esc(p.name)}</option>`).join("");
}
function openLinkModal(l) {
  editingLinkId = l?.id || null;
  $("modalTitle").textContent = l ? "Edit Link" : "Tambah Link";
  const defProj = l ? l.projectId : (activeProject !== "all" && activeProject !== "none" ? activeProject : null);
  $("modalSub").textContent = l ? "" : (defProj ? `Akan ditambahkan ke proyek: ${projectName(defProj)}` : "Pilih proyek untuk link ini (opsional).");
  $("fName").value = l?.name || "";
  $("fUrl").value = l?.url || "";
  $("fDesc").value = l?.desc || "";
  $("fFile").value = "";
  removeAttachedFile = false;
  $("fFileInfo").textContent = l?.fileName ? ("📎 " + l.fileName + " (pilih file baru untuk mengganti)") : "";
  $("fFileClear").classList.toggle("hidden", !(l && l.file));
  fillProjectSelect($("fProject"), defProj);
  $("fPin").checked = !!l?.pinned;
  $("modal").classList.remove("hidden");
  $("fName").focus();
}
function closeLinkModal() { $("modal").classList.add("hidden"); editingLinkId = null; }

$("btnAdd").onclick = () => openLinkModal(null);
$("btnCancel").onclick = closeLinkModal;
$("modal").addEventListener("click", e => { if (e.target === $("modal")) closeLinkModal(); });

$("fFileClear").onclick = () => {
  removeAttachedFile = true;
  $("fFileInfo").textContent = "File akan dihapus saat disimpan.";
  $("fFileClear").classList.add("hidden");
};
$("fFile").onchange = () => {
  const f = $("fFile").files[0];
  if (f) {
    removeAttachedFile = false;
    $("fFileInfo").textContent = "📎 " + f.name + " (" + Math.round(f.size / 1024) + " KB)";
  } else if (!removeAttachedFile) {
    const l = editingLinkId ? store.links.find(x => x.id === editingLinkId) : null;
    $("fFileInfo").textContent = l?.fileName ? ("📎 " + l.fileName + " (pilih file baru untuk mengganti)") : "";
  }
};

$("form").onsubmit = async (e) => {
  e.preventDefault();
  const name = $("fName").value.trim();
  let url = $("fUrl").value.trim();
  if (url) url = normUrl(url);
  const existing = editingLinkId ? store.links.find(x => x.id === editingLinkId) : null;
  let file = existing?.file || null;
  let fileName = existing?.fileName || "";
  if (removeAttachedFile) { file = null; fileName = ""; }
  const picked = $("fFile").files[0];
  if (picked) {
    if (picked.size > 3 * 1024 * 1024) { alert("File terlalu besar (maks ~3 MB agar muat di penyimpanan browser) ❌"); return; }
    try {
      file = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = rej;
        r.readAsDataURL(picked);
      });
      fileName = picked.name;
    } catch { alert("File tidak bisa dibaca ❌"); return; }
  }
  if (!name || (!url && !file)) { alert("Isi nama, lalu isi URL atau upload file 🙂"); return; }
  const data = {
    name, url,
    desc: $("fDesc").value.trim(),
    projectId: $("fProject").value || null,
    pinned: $("fPin").checked,
    file, fileName
  };
  if (editingLinkId) {
    const l = store.links.find(x => x.id === editingLinkId);
    if (l) Object.assign(l, data);
  } else {
    store.links.unshift({ id: uid(), hits: 0, added: Date.now(), ...data });
  }
  save(); closeLinkModal(); render();
};

/* ---------- modal proyek ---------- */
function openProjectModal(p) {
  editingProjectId = p?.id || null;
  $("pmodalTitle").textContent = p ? "Edit Proyek" : "Tambah Proyek";
  $("pName").value = p?.name || "";
  $("pDesc").value = p?.desc || "";
  $("pmodal").classList.remove("hidden");
  $("pName").focus();
}
function closeProjectModal() { $("pmodal").classList.add("hidden"); editingProjectId = null; }

$("btnAddProject").onclick = () => openProjectModal(null);
$("pbtnCancel").onclick = closeProjectModal;
$("pmodal").addEventListener("click", e => { if (e.target === $("pmodal")) closeProjectModal(); });

$("pform").onsubmit = (e) => {
  e.preventDefault();
  const name = $("pName").value.trim();
  if (!name) return;
  if (editingProjectId) {
    const p = store.projects.find(x => x.id === editingProjectId);
    if (p) { p.name = name; p.desc = $("pDesc").value.trim(); }
  } else {
    store.projects.push({ id: uid(), name, desc: $("pDesc").value.trim(), added: Date.now() });
  }
  save(); closeProjectModal(); render();
};

/* ---------- kelola proyek ---------- */
function openManage() {
  renderProjectList();
  $("mmodal").classList.remove("hidden");
}
function renderProjectList() {
  const box = $("projectList");
  box.innerHTML = "";
  if (!store.projects.length) {
    box.innerHTML = `<p class="muted">Belum ada proyek. Buat lewat tombol <b>＋ Proyek</b>.</p>`;
    return;
  }
  store.projects.forEach(p => {
    const row = document.createElement("div");
    row.className = "proj-row";
    row.innerHTML = `
      <div class="proj-info">
        <b>📁 ${esc(p.name)}</b>
        <span class="muted">${countIn(p.id)} link</span>
        ${p.desc ? `<div class="muted small">${esc(p.desc)}</div>` : ""}
      </div>
      <div class="proj-btns">
        <button class="btn sm" data-act="view">👁️ Lihat</button>
        <button class="btn sm" data-act="edit">✏️</button>
        <button class="btn sm danger" data-act="del">🗑️</button>
      </div>`;
    row.querySelector('[data-act="view"]').onclick = () => {
      activeProject = p.id; $("mmodal").classList.add("hidden"); render();
    };
    row.querySelector('[data-act="edit"]').onclick = () => {
      $("mmodal").classList.add("hidden"); openProjectModal(p);
    };
    row.querySelector('[data-act="del"]').onclick = () => {
      const n = countIn(p.id);
      if (confirm(`Hapus proyek "${p.name}"?${n ? `\n${n} link di dalamnya akan pindah ke "Tanpa proyek".` : ""}`)) {
        store.links.forEach(l => { if (l.projectId === p.id) l.projectId = null; });
        store.projects = store.projects.filter(x => x.id !== p.id);
        if (activeProject === p.id) activeProject = "all";
        save(); renderProjectList(); render();
      }
    };
    box.appendChild(row);
  });
}
$("btnManageProjects").onclick = () => { $("menu").classList.add("hidden"); openManage(); };
$("mbtnClose").onclick = () => $("mmodal").classList.add("hidden");
$("mmodal").addEventListener("click", e => { if (e.target === $("mmodal")) $("mmodal").classList.add("hidden"); });

document.addEventListener("keydown", e => {
  if (e.key === "Escape") { closeLinkModal(); closeProjectModal(); $("mmodal").classList.add("hidden"); }
});

/* ---------- menu: export / import / reset ---------- */
$("btnMenu").onclick = (e) => { e.stopPropagation(); $("menu").classList.toggle("hidden"); };

$("btnExport").onclick = () => {
  const blob = new Blob([JSON.stringify(store, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "bdihub-backup-" + new Date().toISOString().slice(0, 10) + ".json";
  a.click();
  URL.revokeObjectURL(a.href);
  $("menu").classList.add("hidden");
};

$("btnImport").onclick = () => { $("fileInput").click(); $("menu").classList.add("hidden"); };
$("fileInput").onchange = (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      let data = JSON.parse(r.result);
      // dukung format lama (array link) maupun v2
      if (Array.isArray(data)) data = migrateV1(data);
      if (!data || !Array.isArray(data.links)) throw 0;
      if (confirm(`Import ${data.links.length} link & ${(data.projects || []).length} proyek? (digabung dengan data lama)`)) {
        const pIds = new Set(store.projects.map(p => p.id));
        const lIds = new Set(store.links.map(l => l.id));
        const pMap = {}; // id lama -> id baru (utk relasi link)
        (data.projects || []).forEach(p => {
          if (!p.name) return;
          const oldId = p.id;
          if (!oldId || pIds.has(oldId)) p.id = uid();
          pIds.add(p.id);
          if (oldId) pMap[oldId] = p.id;
          store.projects.push({ id: p.id, name: p.name, desc: p.desc || "", added: p.added || Date.now() });
        });
        data.links.forEach(l => {
          if (!l.name || (!l.url && !l.file)) return;
          if (!l.id || lIds.has(l.id)) l.id = uid();
          lIds.add(l.id);
          let pid = l.projectId || null;
          if (pid && pMap[pid]) pid = pMap[pid];
          if (pid && !pIds.has(pid)) pid = null;
          store.links.push({ id: l.id, name: l.name, url: l.url, desc: l.desc || "", projectId: pid, pinned: !!l.pinned, hits: l.hits || 0, added: l.added || Date.now(), icon: l.icon || "", file: l.file || null, fileName: l.fileName || "" });
        });
        save(); render(); alert("Import selesai ✅");
      }
    } catch { alert("File tidak valid ❌"); }
  };
  r.readAsText(f);
  e.target.value = "";
};

$("btnReset").onclick = () => {
  if (confirm("Hapus SEMUA proyek dan link? Pastikan sudah export backup dulu!")) {
    store = { version: 2, updatedAt: Date.now(), projects: [], links: [] };
    activeProject = "all";
    save(); render();
  }
  $("menu").classList.add("hidden");
};

$("btnSyncNow").onclick = () => {
  $("menu").classList.add("hidden");
  if (DriveSync.token) DriveSync.uploadNow();
  else { alert("Login Google dulu untuk sinkron ke Drive 🙂"); DriveSync.login(); }
};

/* ---------- init ---------- */
$("search").oninput = render;
render();
DriveSync.init();
