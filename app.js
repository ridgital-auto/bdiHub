/* LinkHub v2 — link dikelompokkan per proyek */
const KEY = "linkhub.links.v1"; // key lama dipakai ulang, isi dimigrasi ke v2
const $ = (id) => document.getElementById(id);

let store = load();          // {version, projects:[], links:[]}
let activeProject = "all";   // "all" | projectId | "none"
let editingLinkId = null;
let editingProjectId = null;

const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ---------- load + migrasi v1 -> v2 ---------- */
function load() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(KEY)); } catch { /* abaikan */ }

  if (Array.isArray(raw)) return migrateV1(raw);              // format lama: array link
  if (raw && raw.version === 2) return sanitize(raw);
  return { version: 2, projects: [], links: [] };
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
    projects: Array.isArray(s.projects) ? s.projects : [],
    links: Array.isArray(s.links) ? s.links : []
  };
}
function save() { localStorage.setItem(KEY, JSON.stringify(store)); }

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

function card(l) {
  const el = document.createElement("div");
  el.className = "card" + (l.pinned ? " pinned" : "");
  el.innerHTML = `
    <div class="card-head">
      <h3>${l.pinned ? '<span class="pin">📌</span>' : ""}${esc(l.name)}</h3>
      <div class="card-tools">
        <button title="Opsi">⋮</button>
        <div class="tools-menu hidden">
          <button data-act="visit">↗ Buka</button>
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
        <a class="visit" href="${esc(l.url)}" target="_blank" rel="noopener">Kunjungi ↗</a>
        ${l.hits ? `<div class="hits">dibuka ${l.hits}×</div>` : ""}
      </div>
    </div>`;

  const toggle = el.querySelector(".tools-menu");
  el.querySelector(".card-tools > button").onclick = (e) => {
    e.stopPropagation();
    document.querySelectorAll(".tools-menu").forEach(m => m !== toggle && m.classList.add("hidden"));
    toggle.classList.toggle("hidden");
  };
  el.querySelector(".visit").onclick = () => { l.hits = (l.hits || 0) + 1; save(); setTimeout(render, 300); };
  toggle.onclick = (e) => {
    e.stopPropagation();
    const act = e.target.closest("button")?.dataset.act;
    if (!act) return;
    toggle.classList.add("hidden");
    if (act === "visit") el.querySelector(".visit").click();
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
  fillProjectSelect($("fProject"), defProj);
  $("fPin").checked = !!l?.pinned;
  $("modal").classList.remove("hidden");
  $("fName").focus();
}
function closeLinkModal() { $("modal").classList.add("hidden"); editingLinkId = null; }

$("btnAdd").onclick = () => openLinkModal(null);
$("btnCancel").onclick = closeLinkModal;
$("modal").addEventListener("click", e => { if (e.target === $("modal")) closeLinkModal(); });

$("form").onsubmit = (e) => {
  e.preventDefault();
  const name = $("fName").value.trim();
  const url = normUrl($("fUrl").value);
  if (!name || !url) return;
  const data = {
    name, url,
    desc: $("fDesc").value.trim(),
    projectId: $("fProject").value || null,
    pinned: $("fPin").checked
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
  a.download = "linkhub-backup-" + new Date().toISOString().slice(0, 10) + ".json";
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
          if (!l.name || !l.url) return;
          if (!l.id || lIds.has(l.id)) l.id = uid();
          lIds.add(l.id);
          let pid = l.projectId || null;
          if (pid && pMap[pid]) pid = pMap[pid];
          if (pid && !pIds.has(pid)) pid = null;
          store.links.push({ id: l.id, name: l.name, url: l.url, desc: l.desc || "", projectId: pid, pinned: !!l.pinned, hits: l.hits || 0, added: l.added || Date.now() });
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
    store = { version: 2, projects: [], links: [] };
    activeProject = "all";
    save(); render();
  }
  $("menu").classList.add("hidden");
};

/* ---------- init ---------- */
$("search").oninput = render;
render();
