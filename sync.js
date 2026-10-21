/* bdiHub Google Drive sync — login Google + backup otomatis.
   Memakai SATU OAuth Client ID bersama (milik pengelola aplikasi, identifier
   publik — aman dipasang di kode client-side), pola yang sama dengan Puskesdoc. */
const GOOGLE_CLIENT_ID = "909196579559-egqlen997lr6a1jp9nrt0dagqvslksa9.apps.googleusercontent.com";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
/* openid+email+profile: agar bisa membaca email & nama pengguna untuk label admin */
const LOGIN_SCOPE = DRIVE_SCOPE + " openid email profile";
const BACKUP_FOLDER = "bdiHub";
const BACKUP_FILE = "bdihub-backup.json";
const ADMIN_EMAIL = "ridgitalstudio@gmail.com";
const USER_KEY = "linkhub.user.v1";

/* Gabung dua data berdasarkan id (union) — TIDAK ada data yang dibuang.
   Untuk id yang sama di kedua sisi, versi dari sisi yang updatedAt-nya lebih
   baru yang menang. Mencegah kejadian data lama tertimpah data kosong dari
   browser baru (dan sebaliknya). */
function mergeStores(local, drive) {
  const newer = (drive.updatedAt || 0) > (local.updatedAt || 0) ? drive : local;
  const older = newer === drive ? local : drive;
  const pm = new Map((older.projects || []).map(p => [p.id, p]));
  (newer.projects || []).forEach(p => pm.set(p.id, p));
  const lm = new Map((older.links || []).map(l => [l.id, l]));
  (newer.links || []).forEach(l => lm.set(l.id, l));
  return {
    version: 2,
    updatedAt: Math.max(local.updatedAt || 0, drive.updatedAt || 0),
    projects: [...pm.values()],
    links: [...lm.values()],
  };
}
function storeSignature(s) {
  const norm = (arr) => [...(arr || [])].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return JSON.stringify({ p: norm(s.projects), l: norm(s.links) });
}

const DriveSync = {
  token: null,
  tokenExpiresAt: 0,
  _tc: null,
  _pending: null,
  _refreshCooldownUntil: 0,
  user: null,            // {email, name, picture}
  folderId: null,
  fileId: null,
  syncTimer: null,
  status: "off",         // off | pending | syncing | ok | expired | error
  statusMsg: "",

  async init() {
    try { this.user = JSON.parse(localStorage.getItem(USER_KEY)); } catch { this.user = null; }
    const mainBtn = $("btnLoginMain");
    if (mainBtn) mainBtn.onclick = () => this.login();
    this.updateGate();
    this.renderAuth();
    if (!this.user) return;
    // Pernah login di browser ini: sambung ulang diam-diam supaya refresh
    // halaman tidak terasa logout. Sesi hanya berakhir lewat tombol Keluar.
    this.setStatus("syncing", "Menyambung ulang sesi…");
    this.renderAuth();
    try { await this.ensureGis(); }
    catch { this.markSessionStale(); return; }
    const ok = await this.requestTokenSilent();
    if (ok) {
      await this.fetchUser();
      this.updateGate();
      this.renderAuth();
      await this.initialSync();
    } else {
      this.markSessionStale();
    }
  },

  markSessionStale() {
    this.setStatus("expired", "Sesi perlu disambung ulang — klik 🔑 Sambung ulang");
    this.renderAuth();
    // Jaring pengaman: coba diam-diam sekali lagi pada sentuhan pertama user
    // (percobaan saat halaman dimuat kadang gagal sesaat — jaringan/GIS belum siap).
    if (this._retryArmed) return;
    this._retryArmed = true;
    const retry = async (e) => {
      document.removeEventListener("pointerdown", retry);
      if (e.target.closest("#btnLogin, #btnLoginMain, #btnLogout")) return;
      if (!this.user || this.token || this._pending) return;
      const ok = await this.requestTokenSilent();
      if (ok) { await this.fetchUser(); this.renderAuth(); await this.initialSync(); }
    };
    document.addEventListener("pointerdown", retry);
  },

  // Hub hanya tampil setelah login; sebelum itu yang tampil layar login.
  updateGate() {
    const loggedIn = !!this.user;
    const ls = $("loginScreen"), as = $("appScreen");
    if (ls) ls.classList.toggle("hidden", loggedIn);
    if (as) as.classList.toggle("hidden", !loggedIn);
  },

  setLoginMsg(t) { const el = $("loginStatus"); if (el) el.textContent = t || ""; },

  /* ---------- auth ---------- */
  ensureGis() {
    return new Promise((resolve, reject) => {
      let n = 0;
      const t = setInterval(() => {
        if (window.google?.accounts?.oauth2) { clearInterval(t); resolve(); }
        else if (++n > 100) { clearInterval(t); reject(new Error("Gagal memuat login Google. Periksa koneksi internet.")); }
      }, 100);
    });
  },

  ensureTokenClient() {
    if (this._tc) return this._tc;
    this._tc = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: LOGIN_SCOPE,
      error_callback: () => {
        if (this._pending) { const r = this._pending; this._pending = null; r(false); }
      },
      callback: (resp) => {
        const ok = !!(resp && resp.access_token);
        if (ok) {
          this.token = resp.access_token;
          this.tokenExpiresAt = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
          this._refreshCooldownUntil = 0;
        }
        if (this._pending) { const r = this._pending; this._pending = null; r(ok); }
      },
    });
    return this._tc;
  },

  // Minta token baru. HARUS dipanggil dari gestur pengguna (klik) agar popup tidak diblokir browser.
  requestTokenNow() {
    return new Promise((resolve) => {
      this._pending = resolve;
      try {
        // hint akun: langsung arahkan ke akun yang benar (HP punya banyak akun Google)
        const opts = {};
        if (this.user?.email) { opts.hint = this.user.email; opts.login_hint = this.user.email; }
        this.ensureTokenClient().requestAccessToken(opts);
        setTimeout(() => { if (this._pending) { this._pending = null; resolve(false); } }, 45000);
      } catch { this._pending = null; resolve(false); }
    });
  },

  // true kalau token masih berlaku; kalau tidak, coba perpanjang diam-diam (butuh gestur pengguna).
  async ensureToken() {
    if (this.token && Date.now() < this.tokenExpiresAt - 60000) return true;
    if (!this.user) return false;
    if (Date.now() < this._refreshCooldownUntil) return false;
    const ok = await this.requestTokenNow();
    if (!ok) this._refreshCooldownUntil = Date.now() + 10 * 60 * 1000;
    return ok && !!this.token;
  },

  // Minta token TANPA tampilan (prompt kosong). Berhasil bila sesi Google di
  // browser masih aktif & izin sudah pernah diberikan — dipakai saat memuat
  // halaman agar user tidak perlu login ulang setiap refresh.
  requestTokenSilent() {
    return new Promise((resolve) => {
      this._pending = resolve;
      try {
        // hint WAJIB bila di HP ada banyak akun Google: tanpa petunjuk akun,
        // Google menolak permintaan diam-diam ("perlu pilih akun") dan sesi
        // gagal dipulihkan — user jadi diminta login berulang-ulang.
        const opts = { prompt: "" };
        if (this.user?.email) { opts.hint = this.user.email; opts.login_hint = this.user.email; }
        this.ensureTokenClient().requestAccessToken(opts);
        setTimeout(() => { if (this._pending) { this._pending = null; resolve(false); } }, 15000);
      } catch { this._pending = null; resolve(false); }
    });
  },

  async login() {
    this.setLoginMsg("Membuka login Google…");
    try { await this.ensureGis(); }
    catch (e) { this.setLoginMsg(""); alert(e.message || "Gagal login Google"); return; }
    const ok = await this.requestTokenNow();
    if (!ok) { this.setStatus("error", "Login dibatalkan"); this.setLoginMsg("Login dibatalkan — coba lagi ya."); this.renderAuth(); return; }
    this.setLoginMsg("");
    await this.fetchUser();
    this.updateGate();
    this.renderAuth();
    await this.initialSync();
  },

  async fetchUser() {
    let me = null;
    try {
      me = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: "Bearer " + this.token },
      }).then(r => r.json());
    } catch { me = null; }
    if (me && me.email) {
      this.user = { email: me.email, name: me.name, picture: me.picture };
      localStorage.setItem(USER_KEY, JSON.stringify(this.user));
    } else {
      // profil gagal dibaca — pertahankan data user lama kalau ada
      try { this.user = JSON.parse(localStorage.getItem(USER_KEY)); } catch { this.user = null; }
      if (!this.user) this.user = { email: "", name: "", picture: "" };
    }
  },

  logout() {
    if (this.token) {
      fetch("https://oauth2.googleapis.com/revoke?token=" + this.token, { method: "POST" }).catch(() => {});
    }
    this.token = null; this.user = null;
    this.folderId = null; this.fileId = null;
    clearTimeout(this.syncTimer);
    localStorage.removeItem(USER_KEY);
    this.setStatus("off", "");
    this.setLoginMsg("");
    this.updateGate();
    this.renderAuth();
  },

  /* ---------- drive api ---------- */
  async api(path, opts = {}) {
    const res = await fetch("https://www.googleapis.com" + path, {
      ...opts,
      headers: { Authorization: "Bearer " + this.token, ...(opts.headers || {}) },
    });
    if (res.status === 401) { this.markExpired(); throw new Error("expired"); }
    if (!res.ok) throw new Error("Drive error " + res.status);
    const ct = res.headers.get("content-type") || "";
    return ct.includes("json") ? res.json() : res.text();
  },

  markExpired() {
    this.token = null;
    this.setStatus("expired", "Sesi Google berakhir — login ulang");
    this.renderAuth();
  },

  async findOrCreateFolder() {
    if (this.folderId) return this.folderId;
    const q = encodeURIComponent(`name = '${BACKUP_FOLDER}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
    const data = await this.api(`/drive/v3/files?q=${q}&fields=files(id)`);
    if (data.files?.length) { this.folderId = data.files[0].id; return this.folderId; }
    const created = await this.api("/drive/v3/files", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: BACKUP_FOLDER, mimeType: "application/vnd.google-apps.folder" }),
    });
    this.folderId = created.id;
    return this.folderId;
  },

  async findBackupFile() {
    const folderId = await this.findOrCreateFolder();
    const q = encodeURIComponent(`name = '${BACKUP_FILE}' and '${folderId}' in parents and trashed = false`);
    const data = await this.api(`/drive/v3/files?q=${q}&fields=files(id,modifiedTime)`);
    this.fileId = data.files?.[0]?.id || null;
    if (!this.fileId) await this.migrateOldBackup();
    return this.fileId;
  },

  // Sekali saja: pindahkan backup lama (folder "LinkHub"/linkhub-backup.json) ke lokasi baru.
  async migrateOldBackup() {
    try {
      const qf = encodeURIComponent(`name = 'LinkHub' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
      const fd = await this.api(`/drive/v3/files?q=${qf}&fields=files(id)`);
      if (!fd.files?.length) return;
      const oldFolderId = fd.files[0].id;
      if (oldFolderId === this.folderId) return;
      const q = encodeURIComponent(`name = 'linkhub-backup.json' and '${oldFolderId}' in parents and trashed = false`);
      const data = await this.api(`/drive/v3/files?q=${q}&fields=files(id)`);
      if (!data.files?.length) return;
      const oldId = data.files[0].id;
      const oldData = await this.api(`/drive/v3/files/${oldId}?alt=media`);
      const parsed = typeof oldData === "string" ? JSON.parse(oldData) : oldData;
      if (!parsed || !Array.isArray(parsed.links)) return;
      // tulis ke lokasi baru, lalu hapus file lama
      const body = JSON.stringify({ version: 2, updatedAt: parsed.updatedAt || Date.now(), projects: parsed.projects || [], links: parsed.links });
      const metadata = { name: BACKUP_FILE, parents: [this.folderId] };
      const boundary = "bh" + Date.now();
      const multipart =
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
        JSON.stringify(metadata) +
        `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n` + body +
        `\r\n--${boundary}--`;
      const created = await this.api("/upload/drive/v3/files?uploadType=multipart", {
        method: "POST",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body: multipart,
      });
      this.fileId = created.id;
      await this.api(`/drive/v3/files/${oldId}`, { method: "DELETE" }).catch(() => {});
    } catch { /* migrasi gagal — abaikan, sinkron normal tetap jalan */ }
  },

  async downloadBackup() {
    const data = await this.api(`/drive/v3/files/${this.fileId}?alt=media`);
    return typeof data === "string" ? JSON.parse(data) : data;
  },

  payload() {
    return JSON.stringify({ version: 2, updatedAt: store.updatedAt || Date.now(), projects: store.projects, links: store.links });
  },

  async uploadBackup() {
    const body = this.payload();
    if (this.fileId) {
      await this.api(`/upload/drive/v3/files/${this.fileId}?uploadType=media`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body,
      });
    } else {
      const metadata = { name: BACKUP_FILE, parents: [await this.findOrCreateFolder()] };
      const boundary = "lh" + Date.now();
      const multipart =
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
        JSON.stringify(metadata) +
        `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n` + body +
        `\r\n--${boundary}--`;
      const created = await this.api("/upload/drive/v3/files?uploadType=multipart", {
        method: "POST",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body: multipart,
      });
      this.fileId = created.id;
    }
  },

  /* ---------- alur sinkron ---------- */
  async initialSync() {
    if (!this.token) return;
    this.setStatus("syncing", "Menyinkronkan…");
    try {
      await this.findBackupFile();
      const drive = this.fileId ? await this.downloadBackup().catch(() => null) : null;
      if (drive && Array.isArray(drive.links)) {
        // GABUNG data lokal & Drive berdasarkan id — tidak ada yang tertimpah.
        const localBefore = sanitize(store);
        const merged = mergeStores(localBefore, sanitize(drive));
        const changedLocal = storeSignature(merged) !== storeSignature(localBefore);
        const changedDrive = storeSignature(merged) !== storeSignature(sanitize(drive));
        store = merged;
        if (activeProject !== "all" && activeProject !== "none" &&
            !store.projects.some(p => p.id === activeProject)) activeProject = "all";
        saveLocal();
        if (changedLocal) render();
        if (changedDrive) {
          await this.uploadBackup();
          this.setStatus("ok", "Data digabung & disinkronkan ✓");
        } else {
          this.setStatus("ok", changedLocal ? "Data dari Drive dipakai" : "Sudah sinkron ✓");
        }
      } else if (store.links.length || store.projects.length) {
        await this.uploadBackup();
        this.setStatus("ok", "Backup Drive dibuat");
      } else {
        this.setStatus("ok", "Siap sinkron");
      }
    } catch (e) {
      if (e.message !== "expired") this.setStatus("error", "Gagal sinkron — coba lagi");
    }
    this.renderAuth();
  },

  onLocalChange() {
    if (!this.user) return;
    clearTimeout(this.syncTimer);
    // Perpanjang token selagi masih dalam gestur pengguna (klik tombol) —
    // Google menerbitkan token baru diam-diam, jadi sesi tidak putus tiap jam.
    this.ensureToken().then((ok) => {
      if (!ok || !this.token) {
        this.setStatus("expired", "Sesi Google berakhir — klik 🔑 untuk login ulang");
        this.renderAuth();
        return;
      }
      this.setStatus("pending", "Akan disinkronkan…");
      this.renderAuth();
      this.syncTimer = setTimeout(() => this.uploadNow(), 2500);
    });
  },

  async uploadNow() {
    clearTimeout(this.syncTimer);
    const ok = await this.ensureToken();
    if (!ok || !this.token) {
      this.setStatus("expired", "Sesi Google berakhir — klik 🔑 untuk login ulang");
      this.renderAuth();
      return;
    }
    this.setStatus("syncing", "Menyinkronkan…");
    this.renderAuth();
    try {
      if (!this.fileId) await this.findBackupFile();
      await this.uploadBackup();
      this.setStatus("ok", "Tersinkron ✓ " + new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }));
    } catch (e) {
      if (e.message !== "expired") this.setStatus("error", "Gagal sinkron — coba lagi");
    }
    this.renderAuth();
  },

  /* ---------- tampilan ---------- */
  setStatus(s, msg) { this.status = s; this.statusMsg = msg || ""; },

  renderAuth() {
    const box = $("authArea");
    const dot = { off: "⚪", pending: "🟡", syncing: "🔵", ok: "🟢", expired: "🟠", error: "🔴" }[this.status];
    if (this.user && this.token) {
      const isAdmin = (this.user.email || "").toLowerCase() === ADMIN_EMAIL;
      box.innerHTML = `
        <div class="user-chip" title="${esc(this.user.email || "")}">
          ${this.user.picture ? `<img src="${esc(this.user.picture)}" class="avatar" alt="">` : "👤"}
          <span class="uname">${esc(this.user.name || this.user.email || "Pengguna")}${isAdmin ? " 👑" : ""}</span>
          <span class="sync-dot" title="${esc(this.statusMsg)}">${dot}</span>
          <button id="btnLogout" class="btn sm ghost" title="Keluar dari akun Google">⏻ Keluar</button>
        </div>`;
      $("btnLogout").onclick = () => this.logout();
    } else if (this.user && !this.token) {
      box.innerHTML = `
        <div class="user-chip" title="${esc(this.user.email || "")}">
          ${this.user.picture ? `<img src="${esc(this.user.picture)}" class="avatar" alt="">` : "👤"}
          <span class="uname">${esc(this.user.name || this.user.email || "Pengguna")}</span>
          <span class="sync-dot" title="${esc(this.statusMsg)}">${dot}</span>
          <button id="btnLogin" class="btn sm" title="Sambung ulang ke Google">🔑 Sambung ulang</button>
        </div>`;
      $("btnLogin").onclick = () => this.login();
    } else {
      box.innerHTML = `<button id="btnLogin" class="btn">🔑 Masuk dengan Google</button>`;
      $("btnLogin").onclick = () => this.login();
    }
  },
};
