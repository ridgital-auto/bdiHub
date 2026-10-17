/* LinkHub — simpan, cari, dan buka kumpulan link web app */
const KEY = "linkhub.links.v1";
const $ = (id) => document.getElementById(id);

let links = load();
let activeCat = "Semua";
let editingId = null;

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
function save() { localStorage.setItem(KEY, JSON.stringify(links)); }
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function normUrl(u) {
  u = u.trim();
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  return u;
}
function domainOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; }
}

/* ---------- render ---------- */
function render() {
  const q = $("search").value.trim().toLowerCase();
  const cats = [...new Set(links.map(l => l.cat).filter(Boolean))].sort();

  // chips
  const chipBox = $("chips");
  chipBox.innerHTML = "";
  ["Semua", ...cats].forEach(c => {
    const b = document.createElement("button");
    b.className = "chip" + (c === activeCat ? " active" : "");
    b.textContent = c;
    b.onclick = () => { activeCat = c; render(); };
    chipBox.appendChild(b);
  });
  if (activeCat !== "Semua" && !cats.includes(activeCat)) activeCat = "Semua";

  // cards
  let list = links.filter(l =>
    (activeCat === "Semua" || l.cat === activeCat) &&
    (!q || (l.name + " " + (l.desc || "") + " " + domainOf(l.url)).toLowerCase().includes(q))
  );
  list = [...list].sort((a, b) =>
    (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.hits || 0) - (a.hits || 0)
  );

  const grid = $("grid");
  grid.innerHTML = "";
  $("empty").classList.toggle("hidden", links.length > 0);

  list.forEach(l => grid.appendChild(card(l)));

  // datalist kategori
  $("catList").innerHTML = cats.map(c => `<option value="${esc(c)}">`).join("");
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
    ${l.cat ? `<span class="badge">${esc(l.cat)}</span>` : ""}
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
    if (act === "edit") openModal(l);
    if (act === "copy") { navigator.clipboard.writeText(l.url).then(() => alert("URL tersalin ✅")); }
    if (act === "del" && confirm(`Hapus "${l.name}"?`)) {
      links = links.filter(x => x.id !== l.id); save(); render();
    }
  };
  return el;
}
document.addEventListener("click", () =>
  document.querySelectorAll(".tools-menu").forEach(m => m.classList.add("hidden")));

const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------- modal ---------- */
function openModal(l) {
  editingId = l?.id || null;
  $("modalTitle").textContent = l ? "Edit Link" : "Tambah Link";
  $("fName").value = l?.name || "";
  $("fUrl").value = l?.url || "";
  $("fDesc").value = l?.desc || "";
  $("fCat").value = l?.cat || "";
  $("fPin").checked = !!l?.pinned;
  $("modal").classList.remove("hidden");
  $("fName").focus();
}
function closeModal() { $("modal").classList.add("hidden"); editingId = null; }

$("btnAdd").onclick = () => openModal(null);
$("btnCancel").onclick = closeModal;
$("modal").addEventListener("click", e => { if (e.target === $("modal")) closeModal(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });

$("form").onsubmit = (e) => {
  e.preventDefault();
  const name = $("fName").value.trim();
  const url = normUrl($("fUrl").value);
  if (!name || !url) return;
  const data = {
    name,
    url,
    desc: $("fDesc").value.trim(),
    cat: $("fCat").value.trim(),
    pinned: $("fPin").checked
  };
  if (editingId) {
    const l = links.find(x => x.id === editingId);
    if (l) Object.assign(l, data);
  } else {
    links.unshift({ id: uid(), hits: 0, added: Date.now(), ...data });
  }
  save(); closeModal(); render();
};

/* ---------- menu: export / import / reset ---------- */
$("btnMenu").onclick = (e) => { e.stopPropagation(); $("menu").classList.toggle("hidden"); };
document.addEventListener("click", () => $("menu").classList.add("hidden"));

$("btnExport").onclick = () => {
  const blob = new Blob([JSON.stringify(links, null, 2)], { type: "application/json" });
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
      const data = JSON.parse(r.result);
      if (!Array.isArray(data)) throw 0;
      if (confirm(`Import ${data.length} link? (data lama akan digabung)`)) {
        const ids = new Set(links.map(l => l.id));
        data.forEach(d => {
          if (!d.name || !d.url) return;
          if (!d.id || ids.has(d.id)) d.id = uid();
          ids.add(d.id);
          links.push({ hits: 0, added: Date.now(), desc: "", cat: "", pinned: false, ...d });
        });
        save(); render(); alert("Import selesai ✅");
      }
    } catch { alert("File tidak valid ❌"); }
  };
  r.readAsText(f);
  e.target.value = "";
};

$("btnReset").onclick = () => {
  if (confirm("Hapus SEMUA link? Pastikan sudah export backup dulu!")) {
    links = []; save(); render();
  }
  $("menu").classList.add("hidden");
};

/* ---------- init ---------- */
$("search").oninput = render;
render();
