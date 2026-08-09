const STORAGE_KEY = "firstNoteV041";
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

const $ = (id) => document.getElementById(id);

function load() {
  const current = localStorage.getItem(STORAGE_KEY);
  const v04 = localStorage.getItem(V04_KEY);
  const v03 = localStorage.getItem(V03_KEY);
  const v02 = localStorage.getItem(V02_KEY);
  const v01 = localStorage.getItem(V01_KEY);

  if (current) {
    Object.assign(state, JSON.parse(current));
    return;
  }

  const legacyRaw = v04 || v03 || v02 || v01;
  if (!legacyRaw) return;

  const old = JSON.parse(legacyRaw);
  state.tripName = old.tripName || "";
  state.startDate = old.startDate || "";
  state.endDate = old.endDate || old.startDate || "";
  state.activeDay = old.activeDay || old.startDate || "";
  state.schedule = (old.schedule || []).map((item) => ({
    ...item,
    date: item.date || old.startDate || ""
  }));
  state.checklist = old.checklist || [];
  state.destination = old.destination || "";
  state.memories = old.memories || [];
  state.concept = old.concept || "";
  state.tripPhoto = old.tripPhoto || "";
  if (old.memo && String(old.memo).trim()) {
    state.memos = [{ id: Date.now(), text: String(old.memo).trim() }];
  }
  save();
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
    button.innerHTML = `<strong>DAY ${index + 1}</strong>${date.getMonth() + 1}/${date.getDate()}`;
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
    preview.src = state.tripPhoto;
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
    card.innerHTML = `${m.photo ? `<img src="${m.photo}" alt="旅の写真">` : ""}<div class="bubble"><h3>${escapeHtml(m.title)}</h3>${m.note ? `<p>${escapeHtml(m.note).replace(/\n/g,"<br>")}</p>` : ""}</div><time>${m.date}</time><button class="delete">DELETE</button>`;
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
  if (!confirm("保存した旅行プランをすべて消しますか？")) return;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(V04_KEY);
  localStorage.removeItem(V03_KEY);
  localStorage.removeItem(V02_KEY);
  localStorage.removeItem(V01_KEY);
  location.reload();
});

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

load();
normalizeDates();
bindBasics();
renderDayTabs();
renderSchedule();
renderChecklist();
renderMemos();
renderMemories();
renderCountdown();
