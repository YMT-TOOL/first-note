const STORAGE_KEY = "firstNoteV041";
const TRIPS_KEY = "firstNoteTripsV05";
const ACTIVE_TRIP_KEY = "firstNoteActiveTripV05";
const V04_KEY = "firstNoteV04";
const V03_KEY = "tripPlannerV03";
const V02_KEY = "disneyPlannerV02";
const V01_KEY = "disneyPlannerV01";

const state = {
  tripName: "",
  destination: "",
  startDate: "",
  endDate: "",
  activeDay: "",
  schedule: [],
  checklist: [],
  memos: [],
  memories: [],
  concept: "",
  tripPhoto: ""
};
let trips = [];
let activeTripId = "";

const $ = (id) => document.getElementById(id);

function blankTrip() {
  return {
    id: "trip_" + Date.now() + "_" + Math.random().toString(36).slice(2,7),
    tripName: "",
    destination: "",
    startDate: "",
    endDate: "",
    activeDay: "",
    schedule: [],
    checklist: [],
    memos: [],
    memories: [],
    concept: "",
    tripPhoto: ""
  };
}

function loadLegacySingleTrip() {
  const current = localStorage.getItem(STORAGE_KEY);
  const v04 = localStorage.getItem(V04_KEY);
  const v03 = localStorage.getItem(V03_KEY);
  const v02 = localStorage.getItem(V02_KEY);
  const v01 = localStorage.getItem(V01_KEY);
  const raw = current || v04 || v03 || v02 || v01;
  if (!raw) return blankTrip();
  try {
    const old = JSON.parse(raw);
    const migrated = blankTrip();
    migrated.tripName = old.tripName || "";
    migrated.startDate = old.startDate || "";
    migrated.endDate = old.endDate || old.startDate || "";
    migrated.activeDay = old.activeDay || old.startDate || "";
    migrated.schedule = (old.schedule || []).map(item => ({...item,date:item.date || old.startDate || ""}));
    migrated.checklist = old.checklist || [];
    migrated.destination = old.destination || "";
    migrated.memories = old.memories || [];
    migrated.concept = old.concept || "";
    migrated.tripPhoto = old.tripPhoto || "";
    migrated.memos = old.memos || [];
    if (!migrated.memos.length && old.memo && String(old.memo).trim()) {
      migrated.memos = [{id:Date.now(),text:String(old.memo).trim()}];
    }
    return migrated;
  } catch {
    return blankTrip();
  }
}

function load() {
  try { trips = JSON.parse(localStorage.getItem(TRIPS_KEY)) || []; } catch { trips = []; }
  if (!trips.length) {
    trips = [loadLegacySingleTrip()];
    activeTripId = trips[0].id;
    saveTrips();
  } else {
    // 復元や再同期で同じ端末IDを持つ旅が複数できても、一覧から個別に選べるようにする。
    const usedIds = new Set();
    trips.forEach((trip, index) => {
      const baseId = trip.cloudId ? `cloud_${trip.cloudId}` : (trip.id || `trip_${Date.now()}_${index}`);
      let uniqueId = baseId;
      let suffix = 2;
      while (usedIds.has(uniqueId)) uniqueId = `${baseId}_${suffix++}`;
      trip.id = uniqueId;
      usedIds.add(uniqueId);
    });
    activeTripId = localStorage.getItem(ACTIVE_TRIP_KEY) || trips[0].id;
    if (!trips.some(t => t.id === activeTripId)) activeTripId = trips[0].id;
  }
  loadActiveTrip();
}

function loadActiveTrip() {
  const trip = trips.find(t => t.id === activeTripId) || trips[0];
  activeTripId = trip.id;
  Object.keys(state).forEach(k => {
    const v = trip[k];
    state[k] = Array.isArray(v) ? [...v] : (v ?? (Array.isArray(state[k]) ? [] : ""));
  });
  localStorage.setItem(ACTIVE_TRIP_KEY, activeTripId);
}

function saveTrips() {
  localStorage.setItem(TRIPS_KEY, JSON.stringify(trips));
  localStorage.setItem(ACTIVE_TRIP_KEY, activeTripId);
}

function save() {
  const idx = trips.findIndex(t => t.id === activeTripId);
  const snapshot = {id:activeTripId, ...JSON.parse(JSON.stringify(state))};
  if (idx >= 0) trips[idx] = snapshot; else trips.push(snapshot);
  saveTrips();
  renderTripList();
  if (typeof scheduleCloudSave === "function") scheduleCloudSave();
}
function bindBasics() {
  $("tripName").value = state.tripName || "";
  $("destination").value = state.destination || "";
  $("startDate").value = state.startDate || "";
  $("endDate").value = state.endDate || "";
  $("conceptText").value = state.concept || "";
  renderTripPhoto();

  $("tripName").addEventListener("input", (e) => {
    state.tripName = e.target.value;
    save();
  });

  $("destination").addEventListener("input", (e) => {
    state.destination = e.target.value;
    save();
  });

  $("conceptText").addEventListener("input", (e) => {
    state.concept = e.target.value;
    save();
  });

  $("tripPhotoInput").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      state.tripPhoto = await compressImage(file, 1400, 0.82);
      save();
      renderTripPhoto();
    } catch (err) {
      alert("写真を読み込めませんでした。別の写真で試してください。");
    }
  });

  ["startDate", "endDate"].forEach((key) => {
    $(key).addEventListener("change", (e) => {
      state[key] = e.target.value;
      normalizeDates();
      save();
      renderDayTabs();
      renderSchedule();
      renderCountdown();
renderTripList();
    });
  });
}

function normalizeDates() {
  if (state.startDate && state.endDate && state.endDate < state.startDate) {
    state.endDate = state.startDate;
    $("endDate").value = state.endDate;
  }
  const days = getTripDays();
  if (!state.activeDay || !days.includes(state.activeDay)) {
    state.activeDay = days[0] || state.startDate || "";
  }
}

function getTripDays() {
  if (!state.startDate) return [];
  const start = new Date(`${state.startDate}T00:00:00`);
  const end = new Date(`${state.endDate || state.startDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];

  const result = [];
  const cursor = new Date(start);
  let guard = 0;
  while (cursor <= end && guard < 30) {
    result.push(toDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
    guard += 1;
  }
  return result;
}

function renderDayTabs() {
  const wrap = $("dayTabs");
  wrap.innerHTML = "";
  const days = getTripDays();
  if (!days.length) return;

  days.forEach((dateKey, index) => {
    const date = new Date(`${dateKey}T00:00:00`);
    const button = document.createElement("button");
    button.type = "button";
    button.className = dateKey === state.activeDay ? "active" : "";
    button.innerHTML = `<strong>DAY ${index + 1}</strong><span>${date.getMonth() + 1}/${date.getDate()}</span>`;
    button.addEventListener("click", () => {
      state.activeDay = dateKey;
      save();
      renderDayTabs();
      renderSchedule();
    });
    wrap.appendChild(button);
  });
}

function renderCountdown() {
  if (!state.startDate) {
    $("countdownValue").textContent = "あと — 日!";
    return;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${state.startDate}T00:00:00`);
  const diff = Math.ceil((target - today) / 86400000);

  if (diff > 0) {
    $("countdownValue").textContent = `あと ${diff} 日!`;
  } else if (diff === 0) {
    $("countdownValue").textContent = "TODAY!";
  } else {
    $("countdownValue").textContent = "旅の思い出 ✓";
  }
}

function renderSchedule() {
  const list = $("scheduleList");
  list.innerHTML = "";
  const activeDate = state.activeDay || state.startDate || "";
  const items = state.schedule
    .filter((item) => (item.date || state.startDate || "") === activeDate)
    .sort((a, b) => (a.time || "").localeCompare(b.time || ""));

  $("scheduleEmpty").style.display = items.length ? "none" : "grid";

  items.forEach((item) => {
    const row = document.createElement("div");
    row.className = "timeline-item";
    row.innerHTML = `
      <span class="time">${item.time || "--:--"}</span>
      <span class="timeline-dot"></span>
      <span class="timeline-text">${escapeHtml(item.text)}</span>
      <button class="delete" aria-label="予定を削除">DELETE</button>
    `;
    row.querySelector("button").addEventListener("click", () => {
      state.schedule = state.schedule.filter((x) => x.id !== item.id);
      save();
      renderSchedule();
    });
    list.appendChild(row);
  });
}

function renderChecklist() {
  const list = $("checkList");
  list.innerHTML = "";

  state.checklist.forEach((item) => {
    const row = document.createElement("div");
    row.className = `check-item ${item.done ? "done" : ""}`;
    row.innerHTML = `
      <input class="check-toggle" type="checkbox" ${item.done ? "checked" : ""}>
      <span class="item-text">${escapeHtml(item.text)}</span>
      <button class="delete" aria-label="項目を削除">DELETE</button>
    `;
    row.querySelector(".check-toggle").addEventListener("change", () => {
      item.done = !item.done;
      save();
      renderChecklist();
    });
    row.querySelector(".delete").addEventListener("click", () => {
      state.checklist = state.checklist.filter((x) => x.id !== item.id);
      save();
      renderChecklist();
    });
    list.appendChild(row);
  });

  renderProgress();
}

function renderProgress() {
  const total = state.checklist.length;
  const done = state.checklist.filter((x) => x.done).length;
  const percent = total ? Math.round((done / total) * 100) : 0;
  $("checkProgress").textContent = `${percent}%`;
  $("progressBar").style.width = `${percent}%`;
  $("progressText").textContent = total ? `${done} / ${total} 完了` : "まず1つ追加してみよう";
}

function renderMemos() {
  const list = $("memoList");
  list.innerHTML = "";
  $("memoEmpty").style.display = state.memos.length ? "none" : "block";

  [...state.memos].reverse().forEach((memo) => {
    const card = document.createElement("article");
    card.className = "memo-item";
    card.innerHTML = `
      <p>${escapeHtml(memo.text).replace(/\n/g, "<br>")}</p>
      <button class="delete" aria-label="メモを削除">DELETE</button>
    `;
    card.querySelector("button").addEventListener("click", () => {
      state.memos = state.memos.filter((x) => x.id !== memo.id);
      save();
      renderMemos();
    });
    list.appendChild(card);
  });
}

$("addScheduleBtn").addEventListener("click", () => {
  const text = $("scheduleText").value.trim();
  if (!text) return;
  normalizeDates();
  state.schedule.push({
    id: Date.now(),
    date: state.activeDay || state.startDate || "",
    time: $("scheduleTime").value,
    text
  });
  $("scheduleText").value = "";
  $("scheduleTime").value = "";
  save();
  renderSchedule();
});

$("scheduleText").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("addScheduleBtn").click();
});

$("addCheckBtn").addEventListener("click", () => {
  const text = $("checkText").value.trim();
  if (!text) return;
  state.checklist.push({ id: Date.now(), text, done: false });
  $("checkText").value = "";
  save();
  renderChecklist();
});

$("checkText").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("addCheckBtn").click();
});

$("addMemoBtn").addEventListener("click", () => {
  const text = $("memoText").value.trim();
  if (!text) return;
  state.memos.push({ id: Date.now(), text });
  $("memoText").value = "";
  save();
  renderMemos();
});

$("memoText").addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    $("addMemoBtn").click();
  }
});


function renderTripPhoto() {
  const preview = $("tripPhotoPreview");
  const empty = document.querySelector(".tripPhotoEmpty");
  if (state.tripPhoto) {
    if (typeof setCloudImageSource === "function") setCloudImageSource(preview, state.tripPhoto);
    else preview.src = state.tripPhoto;
    preview.style.display = "block";
    empty.style.display = "none";
  } else {
    preview.removeAttribute("src");
    preview.style.display = "none";
    empty.style.display = "grid";
  }
}

function compressImage(file, maxSide = 1400, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function renderMemories() {
  const board = $("memoryBoard");
  board.innerHTML = "";
  const items = state.memories || [];
  $("memoryEmpty").style.display = items.length ? "none" : "block";
  [...items].reverse().forEach((m) => {
    const card = document.createElement("article");
    card.className = "memory";
    card.innerHTML = `${m.photo ? `<img alt="旅の写真">` : ""}<div class="bubble"><h3>${escapeHtml(m.title)}</h3>${m.note ? `<p>${escapeHtml(m.note).replace(/\n/g,"<br>")}</p>` : ""}</div><time>${m.date}</time><button class="delete">DELETE</button>`;
    if (m.photo) {
      const image = card.querySelector("img");
      if (typeof setCloudImageSource === "function") setCloudImageSource(image, m.photo);
      else image.src = m.photo;
    }
    card.querySelector("button").addEventListener("click",()=>{state.memories=state.memories.filter(x=>x.id!==m.id);save();renderMemories();});
    board.appendChild(card);
  });
}

$("addMemoryBtn").addEventListener("click", () => {
  const title = $("memoryTitle").value.trim();
  if (!title) return;
  const file = $("memoryPhoto").files[0];
  const finish = (photo="") => {
    state.memories = state.memories || [];
    state.memories.push({id:Date.now(), title, note:$("memoryNote").value.trim(), photo, date:new Date().toLocaleDateString("ja-JP")});
    $("memoryTitle").value=""; $("memoryNote").value=""; $("memoryPhoto").value=""; save(); renderMemories();
  };
  if (!file) return finish();
  compressImage(file, 1200, 0.78).then(finish).catch(() => alert("写真を読み込めませんでした。"));
});

$("resetBtn").addEventListener("click", () => {
  if (!confirm("今開いている旅行ノートの内容をリセットしますか？")) return;
  const fresh = blankTrip();
  fresh.id = activeTripId;
  const idx = trips.findIndex(t => t.id === activeTripId);
  trips[idx] = fresh;
  loadActiveTrip();
  saveTrips();
  refreshFromState();
  if (typeof scheduleCloudSave === "function") scheduleCloudSave();
});

function formatTripRange(t) {
  if (!t.startDate) return "日程未設定";
  const s = new Date(t.startDate + "T00:00:00");
  const e = new Date((t.endDate || t.startDate) + "T00:00:00");
  return `${s.getFullYear()}/${String(s.getMonth()+1).padStart(2,"0")}/${String(s.getDate()).padStart(2,"0")} - ${String(e.getMonth()+1).padStart(2,"0")}/${String(e.getDate()).padStart(2,"0")}`;
}

function tripStatus(t) {
  if (!t.startDate) return "NEW";
  const today = new Date(); today.setHours(0,0,0,0);
  const start = new Date(t.startDate + "T00:00:00");
  const end = new Date((t.endDate || t.startDate) + "T23:59:59");
  if (today > end) return "終了";
  const d = Math.ceil((start-today)/86400000);
  if (d > 0) return `あと ${d}日`;
  return "旅行中";
}

function renderTripList() {
  const list = $("tripList");
  if (!list) return;
  list.innerHTML = "";
  const sorted = [...trips].sort((a,b) => {
    const aa = a.startDate || "9999-12-31", bb = b.startDate || "9999-12-31";
    return aa.localeCompare(bb);
  });
  sorted.forEach(t => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tripSwitch" + (t.id === activeTripId ? " active" : "");
    btn.innerHTML = `
      <span class="tripThumb">${t.tripPhoto ? `<img alt="">` : "✈"}</span>
      <span class="tripMeta"><b>${escapeHtml(t.tripName || "新しい旅")}</b><small>${formatTripRange(t)}</small><small>${escapeHtml(t.destination || "行き先未設定")}</small></span>
      <span class="tripBadge">${tripStatus(t)}</span>`;
    btn.addEventListener("click", () => switchTrip(t.id));
    if (t.tripPhoto) {
      const image = btn.querySelector("img");
      if (typeof setCloudImageSource === "function") setCloudImageSource(image, t.tripPhoto);
      else image.src = t.tripPhoto;
    }
    list.appendChild(btn);
  });
}

function openTripDrawer() {
  renderTripList();
  $("tripDrawer").classList.add("open");
  $("drawerBackdrop").classList.add("open");
  $("tripDrawer").setAttribute("aria-hidden","false");
  document.body.classList.add("drawer-open");
}
function closeTripDrawer() {
  $("tripDrawer").classList.remove("open");
  $("drawerBackdrop").classList.remove("open");
  $("tripDrawer").setAttribute("aria-hidden","true");
  document.body.classList.remove("drawer-open");
}
function switchTrip(id) {
  save();
  activeTripId = id;
  localStorage.setItem(ACTIVE_TRIP_KEY,id);
  loadActiveTrip();
  refreshFromState();
  closeTripDrawer();
}
function createTrip() {
  save();
  const t = blankTrip();
  trips.push(t);
  activeTripId = t.id;
  saveTrips();
  loadActiveTrip();
  refreshFromState();
  closeTripDrawer();
  if (typeof scheduleCloudSave === "function") scheduleCloudSave();
}

$("tripMenuBtn").addEventListener("click", openTripDrawer);
$("closeTripMenu").addEventListener("click", closeTripDrawer);
$("drawerBackdrop").addEventListener("click", closeTripDrawer);
$("newTripBtn").addEventListener("click", createTrip);
document.addEventListener("keydown", e => { if (e.key === "Escape") closeTripDrawer(); });

function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[char]));
}

function refreshFromState() {
  $("tripName").value = state.tripName || "";
  $("destination").value = state.destination || "";
  $("startDate").value = state.startDate || "";
  $("endDate").value = state.endDate || "";
  $("conceptText").value = state.concept || "";
  normalizeDates();
  renderTripPhoto();
  renderDayTabs();
  renderSchedule();
  renderChecklist();
  renderMemos();
  renderMemories();
  renderCountdown();
  renderTripList();
}

load();
normalizeDates();
bindBasics();
refreshFromState();
if (typeof initCloudSync === "function") initCloudSync();
