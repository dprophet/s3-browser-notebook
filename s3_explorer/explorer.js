// S3 explorer front end. Every action is one request to the Python side (widget.py), which makes
// the S3 calls. Requests carry an id; replies and progress messages come back with the same id.

// Inline SVG icons (no icon font or emoji font needed). 24x24, stroked in currentColor.
const PATHS = {
  folder: "M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2.5h9A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z",
  file: "M6 3h8l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v5h5",
  image: "M4 4h16v16H4zM4 16l5-5 4 4 2-2 5 5M15.5 9.5a1.5 1.5 0 1 0 0-.01",
  table: "M4 4h16v16H4zM4 9h16M4 14.5h16M10 9v11",
  code: "M6 3h8l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v5h5M10 12l-2 2.5 2 2.5M14 12l2 2.5-2 2.5",
  archive: "M4 4h16v4H4zM5 8v12h14V8M10 12h4",
  pdf: "M6 3h8l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v5h5M8 13h8M8 17h5",
  upload: "M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3",
  download: "M12 4v12M7 11l5 5 5-5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3",
  newFolder: "M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2.5h9A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5zM12 11v6M9 14h6",
  rename: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  back: "M19 12H5M11 6l-6 6 6 6",
  forward: "M5 12h14M13 6l6 6-6 6",
  up: "M12 19V5M6 11l6-6 6 6",
  refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
  alert: "M12 3l10 18H2zM12 10v5M12 18v.01",
  block: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM5.6 5.6l12.8 12.8",
};
function icon(name, cls = "") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", `s3x-svg ${cls}`);
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", PATHS[name] || PATHS.file);
  svg.append(path);
  return svg;
}
const fileIcon = (e) => icon(e.folder ? "folder" : kindOf(e.name), e.folder ? "s3x-folder" : "");
const KIND_BY_EXT = {
  png: "image", jpg: "image", jpeg: "image", gif: "image", svg: "image", webp: "image", bmp: "image", ico: "image",
  csv: "table", tsv: "table", parquet: "table", xlsx: "table", xls: "table",
  json: "code", py: "code", js: "code", ts: "code", sql: "code", yaml: "code", yml: "code", xml: "code",
  sh: "code", md: "code", txt: "code", log: "code", ini: "code", toml: "code", html: "code", css: "code",
  zip: "archive", gz: "archive", tgz: "archive", bz2: "archive", xz: "archive", tar: "archive", "7z": "archive",
  pdf: "pdf",
};
const TEXT_EXT = new Set(["csv", "tsv", "json", "py", "js", "ts", "sql", "yaml", "yml", "xml", "sh", "md",
  "txt", "log", "ini", "toml", "html", "css", "cfg", "conf", "r", "java", "scala", "go", "rs", "c", "h", "cpp"]);

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "className") el.className = v;
    else if (k === "dataset") Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const ext = (name) => (name.includes(".") ? name.split(".").pop().toLowerCase() : "");
const kindOf = (name) => KIND_BY_EXT[ext(name)] || "file";
const baseName = (key) => key.replace(/\/$/, "").split("/").pop();

function humanSize(n) {
  if (n === null || n === undefined) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return i === 0 ? `${n} B` : `${n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`;
}

function fmtTime(epoch) {
  if (!epoch) return "";
  const d = new Date(epoch * 1000);
  const pad = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtDuration(s) {
  s = Math.max(0, Math.floor(s));
  const m = Math.floor(s / 60), sec = s % 60;
  if (m >= 60) return `${Math.floor(m / 60)} h ${m % 60} min`;
  return m >= 1 ? `${m} min ${String(sec).padStart(2, "0")} s` : `${sec} s`;
}

// Minimal CSV parser: quotes, escaped quotes, CRLF. Enough for a preview.
function parseDelimited(text, delim, maxRows) {
  const rows = [];
  let row = [], field = "", i = 0, quoted = false;
  while (i < text.length && rows.length < maxRows) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
    i++;
  }
  if ((field || row.length) && rows.length < maxRows) { row.push(field); rows.push(row); }
  return rows;
}

function toBytes(dataView) {
  return new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength);
}

function render({ model, el }) {
  // ---- state ----------------------------------------------------------------------------------
  const state = {
    bucket: model.get("bucket"),
    prefix: model.get("prefix"),
    folders: [], files: [], nextToken: null,
    selected: new Set(), anchor: null,
    sort: { col: "name", dir: 1 }, filter: "",
    history: [], future: [],
    loading: false, error: null, busy: null,
    previewKey: null,
  };
  const pending = new Map();
  let seq = 0;
  let previewUrl = null;

  // ---- requests -------------------------------------------------------------------------------
  function call(op, args = {}, { buffers, onProgress } = {}) {
    const id = `${Date.now().toString(36)}-${++seq}`;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, onProgress });
      model.send({ id, op, ...args }, undefined, buffers);
    });
  }

  model.on("msg:custom", (msg, buffers) => {
    const p = pending.get(msg.id);
    if (!p) return;
    if (msg.progress) { p.onProgress?.(msg.progress, buffers || []); return; }
    pending.delete(msg.id);
    if (msg.ok) p.resolve({ result: msg.result, buffers: buffers || [] });
    else {
      const err = new Error(msg.error?.message || "Request failed");
      Object.assign(err, msg.error || {});
      if (["ExpiredToken", "TokenRefreshRequired", "SignedOut"].includes(err.code)) showExpired();
      p.reject(err);
    }
  });

  // ---- layout ---------------------------------------------------------------------------------
  const credBadge = h("span", { className: "s3x-cred" });
  const renewBtn = h("button", { className: "s3x-btn s3x-small", onclick: () => renew(), title: "Sign in again and get a new credential" }, "Renew");
  const signOutBtn = h("button", { className: "s3x-btn s3x-small", onclick: () => signOut(), title: "Forget the cached credential" }, "Sign out");
  const header = h("div", { className: "s3x-header" },
    h("span", { className: "s3x-title" }, "S3 Explorer"),
    h("span", { className: "s3x-env" }),
    h("span", { className: "s3x-role" }),
    h("span", { className: "s3x-spacer" }),
    credBadge, renewBtn, signOutBtn);

  const backBtn = h("button", { className: "s3x-btn s3x-icon", title: "Back (Alt+←)", onclick: () => goBack() }, icon("back"));
  const fwdBtn = h("button", { className: "s3x-btn s3x-icon", title: "Forward (Alt+→)", onclick: () => goForward() }, icon("forward"));
  const upBtn = h("button", { className: "s3x-btn s3x-icon", title: "Up one folder (Backspace)", onclick: () => goUp() }, icon("up"));
  const refreshBtn = h("button", { className: "s3x-btn s3x-icon", title: "Refresh (F5)", onclick: () => load() }, icon("refresh"));

  const bucketList = h("datalist", { id: `s3x-buckets-${Math.random().toString(36).slice(2)}` });
  const bucketInput = h("input", {
    className: "s3x-bucket", list: bucketList.id, spellcheck: "false", title: "Bucket. Type another name and press Enter.",
    onkeydown: (e) => { if (e.key === "Enter") { e.preventDefault(); navigate(bucketInput.value.trim(), ""); } },
    onchange: () => { if (bucketInput.value.trim() !== state.bucket) navigate(bucketInput.value.trim(), ""); },
  });
  const crumbs = h("div", { className: "s3x-crumbs" });
  const pathInput = h("input", {
    className: "s3x-path hidden", spellcheck: "false",
    onkeydown: (e) => {
      if (e.key === "Enter") { e.preventDefault(); goToPath(pathInput.value); }
      if (e.key === "Escape") hidePathInput();
    },
    onblur: () => hidePathInput(),
  });
  const filterInput = h("input", {
    className: "s3x-filter", placeholder: "Filter this folder", type: "search",
    oninput: () => { state.filter = filterInput.value.toLowerCase(); renderList(); },
  });
  const nav = h("div", { className: "s3x-nav" }, backBtn, fwdBtn, upBtn, refreshBtn,
    h("span", { className: "s3x-s3" }, "s3://"), bucketInput, bucketList,
    h("div", { className: "s3x-location", onclick: (e) => { if (e.target === crumbs || e.target.classList.contains("s3x-location")) showPathInput(); } },
      crumbs, pathInput),
    filterInput);

  const fileInput = h("input", { type: "file", multiple: true, className: "hidden", onchange: () => { uploadFiles([...fileInput.files]); fileInput.value = ""; } });
  const folderInput = h("input", { type: "file", multiple: true, webkitdirectory: true, className: "hidden", onchange: () => { uploadFiles([...folderInput.files]); folderInput.value = ""; } });
  const btn = (label, title, onclick, cls = "") => h("button", { className: `s3x-btn ${cls}`, title, onclick }, label);
  const actions = {
    upload: btn([icon("upload"), "Upload"], "Upload files into this folder (or drop them anywhere on the explorer)", () => fileInput.click()),
    uploadDir: btn([icon("upload"), "Folder"], "Upload a whole folder", () => folderInput.click()),
    mkdir: btn([icon("newFolder"), "New folder"], "Create a folder here", () => newFolder()),
    download: btn([icon("download"), "Download"], "Download the selection (several files or a folder come as a .zip)", () => download()),
    rename: btn([icon("rename"), "Rename"], "Rename or move the selected item (F2)", () => rename()),
    copy: btn([icon("copy"), "Copy URI"], "Copy the s3:// URI of the selection", () => copyUri()),
    del: btn([icon("trash"), "Delete"], "Delete the selection (Delete key)", () => remove(), "s3x-danger"),
  };
  const toolbar = h("div", { className: "s3x-toolbar" },
    actions.upload, actions.uploadDir, actions.mkdir, h("span", { className: "s3x-sep" }),
    actions.download, actions.rename, actions.copy, actions.del, fileInput, folderInput);

  const thead = h("thead");
  const tbody = h("tbody");
  const table = h("table", { className: "s3x-table" }, thead, tbody);
  const listPane = h("div", { className: "s3x-list", tabindex: "0" }, table);
  const preview = h("div", { className: "s3x-preview" });
  const main = h("div", { className: "s3x-main" }, listPane, h("div", { className: "s3x-divider" }), preview);

  const statusText = h("span", { className: "s3x-status-text" });
  const progress = h("div", { className: "s3x-progress hidden" }, h("div", { className: "s3x-progress-bar" }));
  const footer = h("div", { className: "s3x-footer" }, statusText, progress);

  const dropOverlay = h("div", { className: "s3x-drop hidden" }, h("div", {}, "Drop to upload into ", h("b", { className: "s3x-drop-target" })));
  const modalHost = h("div", { className: "s3x-modal-host hidden" });
  const toast = h("div", { className: "s3x-toast hidden" });

  const root = h("div", { className: "s3x-root", tabindex: "-1" }, header, nav, toolbar, main, footer, dropOverlay, modalHost, toast);
  root.style.height = `${model.get("height")}px`;
  el.append(root);

  // ---- credential header ----------------------------------------------------------------------
  let expired = false;
  function renderCred() {
    const c = model.get("cred") || {};
    header.querySelector(".s3x-env").textContent = (c.env || "").toUpperCase();
    header.querySelector(".s3x-role").textContent = c.role || "";
    header.querySelector(".s3x-role").title = c.role_arn || "";
    tickCred();
  }
  function tickCred() {
    const c = model.get("cred") || {};
    renewBtn.textContent = c.expires_at ? "Renew" : "Sign in";
    signOutBtn.classList.toggle("hidden", !c.expires_at);
    if (!c.expires_at) {
      credBadge.textContent = "Signed out";
      credBadge.className = "s3x-cred bad";
      credBadge.title = "No credential. Click Sign in.";
      if (!expired) { showExpired(); setStatus("Signed out. Click Sign in to get a new credential.", "error"); }
      return;
    }
    const left = c.expires_at - Date.now() / 1000;
    const until = new Date(c.expires_at * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const from = c.source === "cache" ? "cached" : "new";
    credBadge.title = `Credential (${from}) for ${c.role_arn}\nExpires ${new Date(c.expires_at * 1000).toLocaleString()}\nCache: ${c.cache_file}` + (c.subject ? `\nSigned in as ${c.subject}` : "");
    if (left <= 60) {
      credBadge.textContent = `Credential expired at ${until}`;
      credBadge.className = "s3x-cred bad";
      if (!expired) showExpired();
    } else {
      credBadge.textContent = `● ${from} credential · expires ${until} (${fmtDuration(left)})`;
      credBadge.className = `s3x-cred ${left < 600 ? "warn" : "ok"}`;
      if (expired) { expired = false; root.classList.remove("s3x-expired"); updateActions(); updateFooter(); }
    }
  }
  function showExpired() {
    expired = true;
    root.classList.add("s3x-expired");
    updateActions();
    setStatus("The credential has expired. Click Renew to sign in again.", "error");
  }
  const ticker = setInterval(tickCred, 1000);
  model.on("change:cred", renderCred);
  // Python can move the explorer too: explorer.prefix = "reports/"
  model.on("change:bucket", () => { if (model.get("bucket") !== state.bucket) navigate(model.get("bucket"), model.get("prefix") || ""); });
  model.on("change:prefix", () => { if (model.get("prefix") !== state.prefix) navigate(state.bucket, model.get("prefix") || ""); });

  // ---- navigation -----------------------------------------------------------------------------
  function navigate(bucket, prefix, { record = true } = {}) {
    if (!bucket) return;
    if (record && (bucket !== state.bucket || prefix !== state.prefix)) {
      state.history.push([state.bucket, state.prefix]);
      state.future = [];
    }
    state.bucket = bucket;
    state.prefix = prefix;
    state.filter = "";
    filterInput.value = "";
    state.previewKey = null;
    clearPreviewUrl();
    preview.replaceChildren(emptyPreview());
    model.set("bucket", bucket);
    model.set("prefix", prefix);
    model.save_changes();
    load();
  }
  function goBack() {
    const prev = state.history.pop();
    if (!prev) return;
    state.future.push([state.bucket, state.prefix]);
    navigate(prev[0], prev[1], { record: false });
  }
  function goForward() {
    const next = state.future.pop();
    if (!next) return;
    state.history.push([state.bucket, state.prefix]);
    navigate(next[0], next[1], { record: false });
  }
  function goUp() {
    if (!state.prefix) return;
    const parts = state.prefix.replace(/\/$/, "").split("/");
    parts.pop();
    navigate(state.bucket, parts.length ? parts.join("/") + "/" : "");
  }
  function goToPath(text) {
    let t = text.trim().replace(/^s3:\/\//, "");
    if (!t) return;
    const slash = t.indexOf("/");
    const bucket = slash < 0 ? t : t.slice(0, slash);
    let prefix = slash < 0 ? "" : t.slice(slash + 1).replace(/^\/+/, "");
    if (prefix && !prefix.endsWith("/")) prefix += "/";
    hidePathInput();
    navigate(bucket, prefix);
  }
  function showPathInput() {
    pathInput.value = `s3://${state.bucket}/${state.prefix}`;
    crumbs.classList.add("hidden");
    pathInput.classList.remove("hidden");
    pathInput.focus();
    pathInput.select();
  }
  function hidePathInput() {
    pathInput.classList.add("hidden");
    crumbs.classList.remove("hidden");
  }

  function renderCrumbs() {
    bucketInput.value = state.bucket;
    crumbs.replaceChildren();
    const parts = state.prefix ? state.prefix.replace(/\/$/, "").split("/") : [];
    crumbs.append(h("a", { className: "s3x-crumb", onclick: () => navigate(state.bucket, "") }, "/"));
    parts.forEach((p, i) => {
      const target = parts.slice(0, i + 1).join("/") + "/";
      if (i > 0) crumbs.append(h("span", { className: "s3x-crumb-sep" }, "/"));
      crumbs.append(h("a", { className: "s3x-crumb", onclick: () => navigate(state.bucket, target) }, p));
    });
    crumbs.append(h("span", { className: "s3x-crumb-edit", title: "Type a path", onclick: () => showPathInput() }, icon("rename")));
    backBtn.disabled = !state.history.length;
    fwdBtn.disabled = !state.future.length;
    upBtn.disabled = !state.prefix;
    const known = new Set(model.get("buckets") || []);
    known.add(state.bucket);
    bucketList.replaceChildren(...[...known].map((b) => h("option", { value: b })));
  }

  // ---- listing --------------------------------------------------------------------------------
  async function load({ more = false, keepSelection = false } = {}) {
    if (!more) {
      state.folders = []; state.files = []; state.nextToken = null;
      if (!keepSelection) state.selected.clear();
    }
    state.loading = true; state.error = null;
    renderCrumbs(); renderList();
    const want = [state.bucket, state.prefix];
    try {
      const { result } = await call("list", { bucket: state.bucket, prefix: state.prefix, token: more ? state.nextToken : null });
      if (want[0] !== state.bucket || want[1] !== state.prefix) return;   // user moved on
      state.folders.push(...result.folders);
      state.files.push(...result.files);
      state.nextToken = result.next_token;
      if (keepSelection) {
        const present = new Set([...state.folders, ...state.files.map((f) => f.key)]);
        for (const k of [...state.selected]) if (!present.has(k)) state.selected.delete(k);
      }
    } catch (e) {
      if (want[0] !== state.bucket || want[1] !== state.prefix) return;
      state.error = e;
    } finally {
      if (want[0] === state.bucket && want[1] === state.prefix) {
        state.loading = false;
        renderList();
      }
    }
  }

  function entries() {
    const f = state.filter;
    const folders = state.folders
      .map((p) => ({ key: p, name: baseName(p), folder: true, size: null, modified: null }))
      .filter((e) => !f || e.name.toLowerCase().includes(f));
    const files = state.files
      .map((o) => ({ ...o, name: o.key.slice(state.prefix.length), folder: false }))
      .filter((e) => !f || e.name.toLowerCase().includes(f));
    const { col, dir } = state.sort;
    const cmp = (a, b) => {
      const va = a[col], vb = b[col];
      if (col === "name") return dir * a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
      return dir * ((va ?? -1) - (vb ?? -1)) || a.name.localeCompare(b.name);
    };
    folders.sort((a, b) => (col === "name" ? cmp(a, b) : a.name.localeCompare(b.name)));
    files.sort(cmp);
    return [...folders, ...files];
  }

  function renderHead() {
    const col = (id, label, cls = "") => {
      const arrow = state.sort.col === id ? (state.sort.dir > 0 ? " ▲" : " ▼") : "";
      return h("th", {
        className: `s3x-sortable ${cls}`,
        onclick: () => { state.sort = { col: id, dir: state.sort.col === id ? -state.sort.dir : 1 }; renderList(); },
      }, label + arrow);
    };
    const all = entries();
    const allChecked = all.length > 0 && all.every((e) => state.selected.has(e.key));
    const cb = h("input", {
      type: "checkbox", title: "Select all", checked: allChecked,
      onclick: (e) => { e.stopPropagation(); selectAll(!allChecked); },
    });
    thead.replaceChildren(h("tr", {}, h("th", { className: "s3x-check" }, cb), col("name", "Name"), col("size", "Size", "s3x-num"), col("modified", "Modified")));
  }

  function renderList() {
    renderHead();
    tbody.replaceChildren();
    const rows = entries();
    if (state.error) {
      tbody.append(h("tr", {}, h("td", { colspan: 4, className: "s3x-error-cell" }, errorBlock(state.error, `Couldn't list s3://${state.bucket}/${state.prefix}`))));
    } else if (!rows.length && !state.loading) {
      tbody.append(h("tr", {}, h("td", { colspan: 4, className: "s3x-empty" },
        state.filter ? "Nothing matches the filter." : "This folder is empty. Drop files here or use Upload.")));
    }
    for (const e of rows) {
      const sel = state.selected.has(e.key);
      const tr = h("tr", {
        className: `s3x-row ${sel ? "selected" : ""} ${e.key === state.previewKey ? "previewed" : ""}`,
        dataset: { key: e.key },
        onclick: (ev) => onRowClick(ev, e, rows),
        ondblclick: () => open(e),
      },
        h("td", { className: "s3x-check" }, h("input", {
          type: "checkbox", checked: sel,
          onclick: (ev) => { ev.stopPropagation(); toggle(e.key); },
        })),
        h("td", { className: "s3x-name", title: e.key },
          fileIcon(e),
          h("span", {}, e.folder ? e.name + "/" : e.name)),
        h("td", { className: "s3x-num" }, e.folder ? "" : humanSize(e.size)),
        h("td", { className: "s3x-time" }, fmtTime(e.modified)));
      tbody.append(tr);
    }
    if (state.loading) tbody.append(h("tr", {}, h("td", { colspan: 4, className: "s3x-empty" }, h("span", { className: "s3x-spinner" }), " Loading…")));
    else if (state.nextToken) {
      tbody.append(h("tr", {}, h("td", { colspan: 4, className: "s3x-more" },
        h("button", { className: "s3x-btn", onclick: () => load({ more: true, keepSelection: true }) }, "Load more…"))));
    }
    updateActions();
    updateFooter();
  }

  function onRowClick(ev, e, rows) {
    if (ev.shiftKey && state.anchor) {
      const keys = rows.map((r) => r.key);
      const a = keys.indexOf(state.anchor), b = keys.indexOf(e.key);
      if (a >= 0 && b >= 0) {
        if (!(ev.ctrlKey || ev.metaKey)) state.selected.clear();
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++) state.selected.add(keys[i]);
      }
    } else if (ev.ctrlKey || ev.metaKey) {
      toggle(e.key, false);
      state.anchor = e.key;
    } else {
      state.selected.clear();
      state.selected.add(e.key);
      state.anchor = e.key;
      if (!e.folder) showPreview(e);
      else showFolderInfo(e);
    }
    renderList();
    listPane.focus({ preventScroll: true });
  }

  function toggle(key, rerender = true) {
    if (state.selected.has(key)) state.selected.delete(key); else state.selected.add(key);
    state.anchor = key;
    if (rerender) renderList();
  }
  function selectAll(on) {
    state.selected.clear();
    if (on) for (const e of entries()) state.selected.add(e.key);
    renderList();
  }

  function open(e) {
    if (e.folder) navigate(state.bucket, e.key);
    else showPreview(e);
  }

  function selection() {
    const folderSet = new Set(state.folders);
    const keys = [], prefixes = [];
    for (const k of state.selected) (folderSet.has(k) ? prefixes : keys).push(k);
    return { keys, prefixes };
  }

  function updateActions() {
    const { keys, prefixes } = selection();
    const n = keys.length + prefixes.length;
    const dead = expired || !!state.busy;
    actions.download.disabled = dead || n === 0;
    actions.del.disabled = dead || n === 0;
    actions.rename.disabled = dead || n !== 1;
    actions.copy.disabled = n === 0;
    actions.upload.disabled = dead;
    actions.uploadDir.disabled = dead;
    actions.mkdir.disabled = dead;
  }

  function updateFooter() {
    if (state.busy) return;
    const { keys, prefixes } = selection();
    const selSize = state.files.filter((f) => state.selected.has(f.key)).reduce((s, f) => s + f.size, 0);
    const total = state.files.reduce((s, f) => s + f.size, 0);
    let text = `${state.folders.length} folder${state.folders.length === 1 ? "" : "s"}, ${state.files.length} file${state.files.length === 1 ? "" : "s"} (${humanSize(total)})`;
    if (state.nextToken) text += " · more not loaded yet";
    if (keys.length + prefixes.length) text += ` · ${keys.length + prefixes.length} selected` + (keys.length ? ` (${humanSize(selSize)})` : "");
    if (!expired) setStatus(text);
  }

  function setStatus(text, kind = "") {
    statusText.textContent = text;
    statusText.className = `s3x-status-text ${kind}`;
  }

  function setProgress(fraction) {
    if (fraction === null) { progress.classList.add("hidden"); return; }
    progress.classList.remove("hidden");
    progress.firstChild.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
  }

  async function busy(label, fn) {
    state.busy = label;
    updateActions();
    setStatus(label);
    setProgress(0);
    try { return await fn(); }
    finally { state.busy = null; setProgress(null); updateActions(); updateFooter(); }
  }

  function flash(text, kind = "ok") {
    toast.textContent = text;
    toast.className = `s3x-toast ${kind}`;
    clearTimeout(flash.t);
    flash.t = setTimeout(() => toast.classList.add("hidden"), kind === "error" ? 7000 : 3500);
  }

  function errorBlock(e, title) {
    const denied = e.status === 403 || /AccessDenied|Forbidden/i.test(e.code || "");
    return h("div", { className: "s3x-error" },
      h("div", { className: "s3x-error-title" }, icon(denied ? "block" : "alert"), title),
      h("div", {}, h("code", {}, e.code || "Error"), " — ", e.message || ""),
      denied ? h("div", { className: "s3x-hint" }, "The S3 endpoint refused this request: the credential doesn't allow it.") : null,
      e.request_id ? h("div", { className: "s3x-hint" }, `Request id ${e.request_id}`) : null);
  }

  // ---- preview --------------------------------------------------------------------------------
  function clearPreviewUrl() { if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; } }

  function previewHeader(e, extra = []) {
    return h("div", { className: "s3x-pv-head" },
      h("div", { className: "s3x-pv-name", title: e.key }, fileIcon(e), baseName(e.key) + (e.folder ? "/" : "")),
      h("div", { className: "s3x-pv-meta" }, ...extra));
  }

  function showFolderInfo(e) {
    state.previewKey = e.key;
    clearPreviewUrl();
    preview.replaceChildren(previewHeader(e, [`s3://${state.bucket}/${e.key}`]),
      h("div", { className: "s3x-pv-body s3x-pv-center" },
        h("button", { className: "s3x-btn", onclick: () => navigate(state.bucket, e.key) }, "Open folder")));
  }

  async function showPreview(e) {
    state.previewKey = e.key;
    clearPreviewUrl();
    const meta = h("span", {}, `${humanSize(e.size)} · ${fmtTime(e.modified)}`);
    const body = h("div", { className: "s3x-pv-body" }, h("span", { className: "s3x-spinner" }), " Loading preview…");
    const details = h("details", { className: "s3x-pv-details" }, h("summary", {}, "Details"));
    preview.replaceChildren(previewHeader(e, [meta]), body, details);
    details.addEventListener("toggle", () => { if (details.open && details.childElementCount === 1) loadDetails(e, details); }, { once: false });
    const kind = kindOf(e.name);
    if (!TEXT_EXT.has(ext(e.name)) && kind !== "image" && kind !== "pdf" && e.size > 0 && !looksTextual(e.name)) {
      body.replaceChildren(h("div", { className: "s3x-pv-center" },
        h("div", {}, `No preview for this file type.`),
        h("button", { className: "s3x-btn", onclick: () => download([e.key]) }, icon("download"), "Download")));
      return;
    }
    try {
      const { result, buffers } = await call("preview", { bucket: state.bucket, key: e.key });
      if (state.previewKey !== e.key) return;
      const bytes = buffers.length ? toBytes(buffers[0]) : new Uint8Array();
      const note = result.truncated ? h("div", { className: "s3x-hint" }, `Showing the first ${humanSize(bytes.length)} of ${humanSize(result.size)}.`) : null;
      if (kind === "image" || (result.content_type || "").startsWith("image/")) {
        if (result.truncated) { body.replaceChildren(h("div", { className: "s3x-pv-center" }, "Image too large to preview.")); return; }
        const type = ext(e.name) === "svg" ? "image/svg+xml" : result.content_type;
        previewUrl = URL.createObjectURL(new Blob([bytes], { type }));
        body.replaceChildren(h("div", { className: "s3x-pv-img" }, h("img", { src: previewUrl, alt: e.name })));
      } else if (kind === "pdf") {
        if (result.truncated) { body.replaceChildren(h("div", { className: "s3x-pv-center" }, "PDF too large to preview.")); return; }
        previewUrl = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
        body.replaceChildren(h("iframe", { className: "s3x-pv-pdf", src: previewUrl, title: e.name }));
      } else {
        if (!bytes.length) { body.replaceChildren(h("div", { className: "s3x-pv-center s3x-hint" }, "Empty file.")); return; }
        const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
        if (text.includes("\u0000")) { body.replaceChildren(h("div", { className: "s3x-pv-center" }, "Binary file — no preview.")); return; }
        const x = ext(e.name);
        if (x === "csv" || x === "tsv") body.replaceChildren(note || "", tablePreview(text, x === "tsv" ? "\t" : ","));
        else if (x === "json" && !result.truncated) {
          let pretty = text;
          try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch { /* show as-is */ }
          body.replaceChildren(h("pre", { className: "s3x-pv-text" }, pretty));
        } else body.replaceChildren(note || "", h("pre", { className: "s3x-pv-text" }, text));
      }
    } catch (err) {
      if (state.previewKey !== e.key) return;
      body.replaceChildren(errorBlock(err, "Couldn't read the file"));
    }
  }

  function looksTextual(name) { return !name.includes(".") || /^(readme|license|makefile|dockerfile)/i.test(name); }

  function tablePreview(text, delim) {
    const rows = parseDelimited(text, delim, 501);
    if (!rows.length) return h("div", { className: "s3x-pv-center" }, "Empty file.");
    const [head, ...data] = rows;
    const more = data.length >= 500 ? h("div", { className: "s3x-hint" }, "First 500 rows.") : null;
    return h("div", { className: "s3x-pv-table-wrap" },
      h("table", { className: "s3x-pv-table" },
        h("thead", {}, h("tr", {}, head.map((c) => h("th", {}, c)))),
        h("tbody", {}, data.map((r) => h("tr", {}, r.map((c) => h("td", {}, c)))))), more);
  }

  async function loadDetails(e, details) {
    details.append(h("div", { className: "s3x-hint" }, "Loading…"));
    try {
      const { result } = await call("head", { bucket: state.bucket, key: e.key });
      const rows = [
        ["URI", `s3://${state.bucket}/${e.key}`], ["Size", `${humanSize(result.size)} (${(result.size ?? 0).toLocaleString()} bytes)`],
        ["Type", result.content_type], ["Modified", result.modified ? new Date(result.modified * 1000).toLocaleString() : ""],
        ["ETag", result.etag], ["Storage class", result.storage || "STANDARD"], ["Encryption", result.encryption || "—"],
        ...Object.entries(result.metadata || {}).map(([k, v]) => [`x-amz-meta-${k}`, v]),
      ];
      details.lastChild.replaceWith(h("table", { className: "s3x-kv" }, rows.map(([k, v]) => h("tr", {}, h("th", {}, k), h("td", {}, v ?? "")))));
    } catch (err) {
      details.lastChild.replaceWith(errorBlock(err, "Couldn't read the details"));
    }
  }

  // ---- actions --------------------------------------------------------------------------------
  async function download(keysOverride) {
    const sel = keysOverride ? { keys: keysOverride, prefixes: [] } : selection();
    if (!sel.keys.length && !sel.prefixes.length) return;
    const zip = sel.keys.length + sel.prefixes.length > 1 || sel.prefixes.length > 0;
    await busy(zip ? "Preparing a .zip…" : `Downloading ${baseName(sel.keys[0])}…`, async () => {
      const chunks = [];
      try {
        const { result } = await call("download", { bucket: state.bucket, ...sel, base: state.prefix }, {
          onProgress: (p, buffers) => {
            if (p.phase === "zip") { setStatus(`Zipping ${p.done + 1} of ${p.count}: ${p.key}`); setProgress(p.done / Math.max(1, p.count)); return; }
            for (const b of buffers) chunks.push(toBytes(b).slice());
            setStatus(`Downloading ${humanSize(p.sent)}${p.total ? ` of ${humanSize(p.total)}` : ""}…`);
            setProgress(p.total ? p.sent / p.total : 0);
          },
        });
        const url = URL.createObjectURL(new Blob(chunks, { type: result.content_type }));
        const a = h("a", { href: url, download: result.name });
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        flash(`Downloaded ${result.name} (${humanSize(result.size)})` + (result.files ? `, ${result.files} files` : ""));
      } catch (err) { flash(`Download failed: ${err.code || ""} ${err.message}`, "error"); }
    });
  }

  async function uploadFiles(files) {
    if (!files.length || expired) return;
    const existing = new Set(state.files.map((f) => f.key));
    const items = files.map((f) => ({ file: f, key: state.prefix + (f.webkitRelativePath || f._relPath || f.name) }));
    const clash = items.filter((i) => existing.has(i.key));
    if (clash.length && !(await confirmBox(`Replace ${clash.length === 1 ? `“${baseName(clash[0].key)}”` : `${clash.length} files`}?`,
      "A file with the same name is already in this folder.", "Replace"))) return;
    const total = items.reduce((s, i) => s + i.file.size, 0);
    let done = 0, ok = 0;
    const failures = [];
    await busy(`Uploading ${items.length} file${items.length === 1 ? "" : "s"}…`, async () => {
      for (const [n, item] of items.entries()) {
        let uploadId = null;
        try {
          const { result } = await call("upload_start", { bucket: state.bucket, key: item.key, size: item.file.size, content_type: item.file.type });
          uploadId = result.upload_id;
          for (let off = 0; off < item.file.size; off += result.chunk) {
            const buf = await item.file.slice(off, off + result.chunk).arrayBuffer();
            await call("upload_chunk", { upload_id: uploadId }, { buffers: [buf] });
            done += buf.byteLength;
            setStatus(`Uploading ${n + 1} of ${items.length}: ${baseName(item.key)} — ${humanSize(done)} of ${humanSize(total)}`);
            setProgress(total ? done / total : 1);
          }
          setStatus(`Saving ${baseName(item.key)} to S3…`);
          await call("upload_finish", { upload_id: uploadId });
          ok++;
        } catch (err) {
          failures.push({ key: item.key, err });
          if (uploadId) call("upload_abort", { upload_id: uploadId }).catch(() => {});
          if (["ExpiredToken", "SignedOut"].includes(err.code)) break;
        }
      }
    });
    if (failures.length) {
      const f = failures[0];
      flash(`${ok} uploaded, ${failures.length} failed. ${baseName(f.key)}: ${f.err.code || ""} ${f.err.message}`, "error");
    } else flash(`Uploaded ${ok} file${ok === 1 ? "" : "s"} (${humanSize(total)})`);
    load({ keepSelection: true });
  }

  async function newFolder() {
    const name = await promptBox("New folder", "Folder name", "");
    if (!name) return;
    const clean = name.replace(/^\/+|\/+$/g, "");
    if (!clean) return;
    await busy("Creating folder…", async () => {
      try {
        await call("mkdir", { bucket: state.bucket, prefix: state.prefix + clean });
        flash(`Created ${clean}/`);
      } catch (err) { flash(`Couldn't create the folder: ${err.code || ""} ${err.message}`, "error"); }
    });
    load();
  }

  async function rename() {
    const { keys, prefixes } = selection();
    const src = keys[0] || prefixes[0];
    if (!src) return;
    const isDir = src.endsWith("/");
    const relative = src.slice(state.prefix.length).replace(/\/$/, "");
    const answer = await promptBox(isDir ? "Rename folder" : "Rename file",
      "New name. Include a path (a/b/name) to move it within this bucket.", relative);
    if (!answer || answer === relative) return;
    const dst = state.prefix + answer.replace(/^\/+|\/+$/g, "") + (isDir ? "/" : "");
    await busy(`Renaming ${baseName(src)}…`, async () => {
      try {
        const { result } = await call("rename", { bucket: state.bucket, src, dst }, {
          onProgress: (p) => { setStatus(`Moving ${p.done} of ${p.count}…`); setProgress(p.done / p.count); },
        });
        flash(`Renamed to ${baseName(dst)}` + (result.moved > 1 ? ` (${result.moved} objects)` : ""));
      } catch (err) { flash(`Rename failed: ${err.code || ""} ${err.message}`, "error"); }
    });
    state.selected.clear();
    load();
  }

  async function remove() {
    const { keys, prefixes } = selection();
    const n = keys.length + prefixes.length;
    if (!n) return;
    const what = n === 1 ? `“${baseName(keys[0] || prefixes[0])}${prefixes.length ? "/" : ""}”` : `${n} items`;
    const ok = await confirmBox(`Delete ${what}?`,
      prefixes.length ? "Folders are deleted with everything inside them. This can't be undone." : "This can't be undone.", "Delete", true);
    if (!ok) return;
    await busy(`Deleting ${what}…`, async () => {
      try {
        const { result } = await call("delete", { bucket: state.bucket, keys, prefixes }, {
          onProgress: (p) => { setStatus(`Deleting ${p.done} of ${p.count}…`); setProgress(p.done / p.count); },
        });
        if (result.errors.length) {
          const e = result.errors[0];
          flash(`${result.deleted.length} deleted, ${result.errors.length} refused. ${baseName(e.key)}: ${e.code} ${e.message}`, "error");
        } else flash(`Deleted ${result.deleted.filter((k) => !k.endsWith("/")).length || result.deleted.length} object${result.deleted.length === 1 ? "" : "s"}`);
      } catch (err) { flash(`Delete failed: ${err.code || ""} ${err.message}`, "error"); }
    });
    state.previewKey = null;
    preview.replaceChildren(emptyPreview());
    load();
  }

  async function copyUri() {
    const uris = [...state.selected].map((k) => `s3://${state.bucket}/${k}`);
    if (!uris.length) return;
    try {
      await navigator.clipboard.writeText(uris.join("\n"));
      flash(uris.length === 1 ? `Copied ${uris[0]}` : `Copied ${uris.length} URIs`);
    } catch {
      await promptBox("Copy URI", "Clipboard not available here. Copy it from the box:", uris.join(" "));
    }
  }

  async function signOut() {
    if (!(await confirmBox("Sign out?", "The cached credential is deleted. It keeps working until it expires, but this notebook won't reuse it.", "Sign out"))) return;
    try {
      await call("sign_out");
      flash("Signed out. The cached credential is deleted.");
    } catch (err) { flash(`Sign out failed: ${err.message}`, "error"); }
  }

  // ---- renew ----------------------------------------------------------------------------------
  async function renew() {
    let cancelled = false;
    const body = h("div", {}, h("span", { className: "s3x-spinner" }), " Starting sign-in…");
    const close = modal((model.get("cred") || {}).expires_at ? "Renew credential" : "Sign in", body, [["Cancel", () => { cancelled = true; close(); }]]);
    try {
      const { result } = await call("renew_start");
      body.replaceChildren(
        h("p", {}, "Sign in on the page that just opened, then come back here."),
        h("p", {}, h("a", { href: result.url, target: "_blank", rel: "noopener", className: "s3x-link" }, "Open the sign-in page ↗"),
          result.user_code ? h("span", {}, "  ·  code ", h("code", {}, result.user_code)) : ""),
        h("p", { className: "s3x-hint" }, h("span", { className: "s3x-spinner" }), " Waiting for you to approve…"));
      window.open(result.url, "_blank", "noopener");
      let interval = result.interval || 5;
      while (!cancelled) {
        await new Promise((r) => setTimeout(r, interval * 1000));
        if (cancelled) return;
        const { result: poll } = await call("renew_poll");
        if (poll.state === "done") { close(); flash("New credential issued and cached"); load({ keepSelection: true }); return; }
        if (poll.state === "slow_down") interval += 5;
      }
    } catch (err) {
      if (cancelled) return;
      body.replaceChildren(errorBlock(err, "Sign-in failed"));
    }
  }

  // ---- modals ---------------------------------------------------------------------------------
  function modal(title, content, buttons, onKey) {
    const box = h("div", { className: "s3x-modal", role: "dialog", "aria-label": title },
      h("div", { className: "s3x-modal-title" }, title), content,
      h("div", { className: "s3x-modal-buttons" }, buttons.map(([label, fn, cls]) => h("button", { className: `s3x-btn ${cls || ""}`, onclick: fn }, label))));
    modalHost.replaceChildren(box);
    modalHost.classList.remove("hidden");
    const keyHandler = (e) => { e.stopPropagation(); onKey?.(e); };
    box.addEventListener("keydown", keyHandler);
    return () => { modalHost.classList.add("hidden"); modalHost.replaceChildren(); listPane.focus({ preventScroll: true }); };
  }

  function confirmBox(title, text, okLabel, danger = false) {
    return new Promise((resolve) => {
      let close;
      const done = (v) => { close(); resolve(v); };
      close = modal(title, h("p", {}, text), [["Cancel", () => done(false)], [okLabel, () => done(true), danger ? "s3x-danger" : "s3x-primary"]],
        (e) => { if (e.key === "Escape") done(false); if (e.key === "Enter") done(true); });
      modalHost.querySelector(".s3x-modal-buttons button:last-child").focus();
    });
  }

  function promptBox(title, label, value) {
    return new Promise((resolve) => {
      const input = h("input", { className: "s3x-input", value, spellcheck: "false" });
      let close;
      const done = (v) => { close(); resolve(v); };
      close = modal(title, h("label", { className: "s3x-field" }, h("span", {}, label), input),
        [["Cancel", () => done(null)], ["OK", () => done(input.value.trim()), "s3x-primary"]],
        (e) => { if (e.key === "Escape") done(null); if (e.key === "Enter") done(input.value.trim()); });
      input.focus();
      input.select();
    });
  }

  // ---- drag and drop --------------------------------------------------------------------------
  let dragDepth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
  root.addEventListener("dragenter", (e) => {
    if (!hasFiles(e) || expired) return;
    e.preventDefault();
    dragDepth++;
    dropOverlay.querySelector(".s3x-drop-target").textContent = `s3://${state.bucket}/${state.prefix}`;
    dropOverlay.classList.remove("hidden");
  });
  root.addEventListener("dragover", (e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } });
  root.addEventListener("dragleave", (e) => {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) dropOverlay.classList.add("hidden");
  });
  root.addEventListener("drop", async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();          // keep JupyterLab from opening the file itself
    dragDepth = 0;
    dropOverlay.classList.add("hidden");
    const files = await droppedFiles(e.dataTransfer);
    uploadFiles(files);
  });

  // Folders dropped in: walk them so the folder structure is kept.
  async function droppedFiles(dt) {
    const roots = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
    if (!roots.length) return [...dt.files];
    const out = [];
    const walk = async (entry, path) => {
      if (entry.isFile) {
        const file = await new Promise((res, rej) => entry.file(res, rej));
        file._relPath = path + file.name;
        out.push(file);
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        let batch;
        do {
          batch = await new Promise((res, rej) => reader.readEntries(res, rej));
          for (const child of batch) await walk(child, `${path}${entry.name}/`);
        } while (batch.length);
      }
    };
    for (const r of roots) await walk(r, "");
    return out;
  }

  // ---- keyboard -------------------------------------------------------------------------------
  // Handled on the explorer only, and stopped there so JupyterLab's notebook shortcuts don't fire.
  root.addEventListener("keydown", (e) => {
    const typing = e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA";
    if (!modalHost.classList.contains("hidden")) { e.stopPropagation(); return; }
    if (typing) { e.stopPropagation(); return; }
    const rows = entries();
    const keys = rows.map((r) => r.key);
    const cur = keys.indexOf(state.anchor);
    const handled = () => { e.preventDefault(); e.stopPropagation(); };
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const next = Math.max(0, Math.min(keys.length - 1, cur + (e.key === "ArrowDown" ? 1 : -1)));
      if (keys[next] !== undefined) {
        if (!e.shiftKey) state.selected.clear();
        state.selected.add(keys[next]);
        state.anchor = keys[next];
        const row = rows[next];
        if (!e.shiftKey) (row.folder ? showFolderInfo(row) : showPreview(row));
        renderList();
        tbody.querySelector(`tr[data-key="${CSS.escape(keys[next])}"]`)?.scrollIntoView({ block: "nearest" });
      }
      handled();
    } else if (e.key === "Enter") { if (cur >= 0) open(rows[cur]); handled(); }
    else if (e.key === "Backspace" || (e.altKey && e.key === "ArrowUp")) { goUp(); handled(); }
    else if (e.altKey && e.key === "ArrowLeft") { goBack(); handled(); }
    else if (e.altKey && e.key === "ArrowRight") { goForward(); handled(); }
    else if (e.key === "Delete") { if (state.selected.size) remove(); handled(); }
    else if (e.key === "F2") { if (state.selected.size === 1) rename(); handled(); }
    else if (e.key === "F5") { load(); handled(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") { selectAll(true); handled(); }
    else if (e.key === "Escape") { state.selected.clear(); renderList(); handled(); }
    else e.stopPropagation();
  });

  // ---- resizable preview ----------------------------------------------------------------------
  const divider = main.querySelector(".s3x-divider");
  divider.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    divider.setPointerCapture(e.pointerId);
    const rect = main.getBoundingClientRect();
    const move = (ev) => {
      const frac = Math.min(0.8, Math.max(0.25, (ev.clientX - rect.left) / rect.width));
      main.style.gridTemplateColumns = `${frac}fr 6px ${1 - frac}fr`;
    };
    const up = () => { divider.removeEventListener("pointermove", move); divider.removeEventListener("pointerup", up); };
    divider.addEventListener("pointermove", move);
    divider.addEventListener("pointerup", up);
  });

  function emptyPreview() {
    return h("div", { className: "s3x-pv-body s3x-pv-center s3x-hint" }, "Select a file to preview it.");
  }

  // ---- go -------------------------------------------------------------------------------------
  preview.append(emptyPreview());
  renderCred();
  load();

  return () => { clearInterval(ticker); clearPreviewUrl(); };
}

export default { render };
