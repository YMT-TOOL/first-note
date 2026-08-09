const STORAGE_KEY = "tripPlannerV03";
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
  memos: []
};

const $ = (id) => document.getElementById(id);

function load() {
  const current = localStorage.getItem(STORAGE_KEY);
  const v02 = localStorage.getItem(V02_KEY);
  const v01 = localStorage.getItem(V01_KEY);

  if (current) {
    Object.assign(state, JSON.parse(current));
    return;
  }

  const legacyRaw = v02 || v01;
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

  $("tripName").addEventListener("input", (e) => {
    state.tripName = e.target.value;
    save();
  });

  $("destination").addEventListener("input", (e) => {
    state.destination = e.target.value;
    save();
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
    $("countdownValue").textContent = "—";
    $("countdownLabel").textContent = "日付を設定すると表示されます";
    return;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${state.startDate}T00:00:00`);
  const diff = Math.ceil((target - today) / 86400000);

  if (diff > 0) {
    $("countdownValue").textContent = `${diff}`;
    $("countdownLabel").textContent = "days to go";
  } else if (diff === 0) {
    $("countdownValue").textContent = "TODAY";
    $("countdownLabel").textContent = "いよいよ出発！";
  } else {
    $("countdownValue").textContent = "✓";
    $("countdownLabel").textContent = "また次の旅へ。";
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
      <span class="timeline-time">${item.time || "--:--"}</span>
      <span class="timeline-dot"></span>
      <span class="timeline-text">${escapeHtml(item.text)}</span>
      <button class="icon-button" aria-label="予定を削除">DELETE</button>
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
      <button class="check-toggle" aria-label="チェック切替"></button>
      <span class="item-text">${escapeHtml(item.text)}</span>
      <button class="icon-button" aria-label="項目を削除">DELETE</button>
    `;
    row.querySelector(".check-toggle").addEventListener("click", () => {
      item.done = !item.done;
      save();
      renderChecklist();
    });
    row.querySelector(".icon-button").addEventListener("click", () => {
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
  $("progressText").textContent = total ? `${done} / ${total} items ready` : "持ち物を登録しよう";
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
      <button class="icon-button" aria-label="メモを削除">DELETE</button>
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

$("resetBtn").addEventListener("click", () => {
  if (!confirm("保存した旅行プランをすべて消しますか？")) return;
  localStorage.removeItem(STORAGE_KEY);
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
renderCountdown();
