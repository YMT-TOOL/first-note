const SUPABASE_URL = "https://agyfnamuzmltaedfraxe.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_oH3IwX8ppGJKwrr0oYJzTw_VWVnWSNp";
const CLOUD_BUCKET = "trip-photos";
const CLOUD_LINK_PREFIX = "firstNoteCloudLinkedV06:";
const LOCAL_BACKUP_PREFIX = "firstNoteBeforeCloudV06:";

let cloudClient = null;
let cloudSession = null;
let cloudSaveTimer = null;
let cloudBusy = false;
let cloudQueued = false;
let lastCloudPullAt = 0;
const signedPhotoCache = new Map();

function setSyncStatus(kind, text) {
  const button = document.getElementById("accountBtn");
  const label = document.getElementById("syncText");
  if (!button || !label) return;
  button.classList.remove("online", "syncing", "error");
  if (kind) button.classList.add(kind);
  label.textContent = text;
}

function openAuthPanel() {
  document.getElementById("authPanel")?.classList.add("open");
  document.getElementById("authPanel")?.setAttribute("aria-hidden", "false");
  document.getElementById("authBackdrop")?.classList.add("open");
}

function closeAuthPanel() {
  document.getElementById("authPanel")?.classList.remove("open");
  document.getElementById("authPanel")?.setAttribute("aria-hidden", "true");
  document.getElementById("authBackdrop")?.classList.remove("open");
}

function updateAuthPanel() {
  const signedIn = Boolean(cloudSession?.user);
  document.getElementById("authSignedOut").hidden = signedIn;
  document.getElementById("authSignedIn").hidden = !signedIn;
  document.getElementById("accountEmail").textContent = signedIn ? cloudSession.user.email : "";
  setSyncStatus(signedIn ? "online" : "", signedIn ? "同期済み" : "ログイン");
}

function dataUrlToBlob(dataUrl) {
  const [header, body] = dataUrl.split(",");
  const mime = header.match(/data:(.*?);/)?.[1] || "image/jpeg";
  const bytes = atob(body);
  const array = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) array[i] = bytes.charCodeAt(i);
  return new Blob([array], { type: mime });
}

function isInlinePhoto(value) {
  return typeof value === "string" && value.startsWith("data:image/");
}

function isStoragePhoto(value) {
  return typeof value === "string" && value.startsWith("storage:");
}

async function uploadInlinePhoto(trip, value, label) {
  if (!isInlinePhoto(value)) return value;
  const extension = value.startsWith("data:image/webp") ? "webp" : "jpg";
  const path = `${trip.cloudId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${label}.${extension}`;
  const { error } = await cloudClient.storage.from(CLOUD_BUCKET).upload(path, dataUrlToBlob(value), {
    contentType: extension === "webp" ? "image/webp" : "image/jpeg",
    upsert: false
  });
  if (error) throw error;
  return `storage:${path}`;
}

async function uploadPendingPhotos(trip) {
  trip.tripPhoto = await uploadInlinePhoto(trip, trip.tripPhoto, "cover");
  for (const memory of trip.memories || []) {
    memory.photo = await uploadInlinePhoto(trip, memory.photo, "memory");
  }
}

async function resolveCloudPhoto(value) {
  if (!isStoragePhoto(value) || !cloudClient || !cloudSession) return value || "";
  const path = value.slice("storage:".length);
  if (signedPhotoCache.has(path)) return signedPhotoCache.get(path);
  const { data, error } = await cloudClient.storage.from(CLOUD_BUCKET).createSignedUrl(path, 3600);
  if (error) throw error;
  signedPhotoCache.set(path, data.signedUrl);
  return data.signedUrl;
}

async function setCloudImageSource(image, value) {
  if (!image) return;
  image.dataset.photoRef = value || "";
  try {
    const url = await resolveCloudPhoto(value);
    if (image.dataset.photoRef === (value || "")) image.src = url;
  } catch {
    image.removeAttribute("src");
  }
}

function cloudPayload(trip) {
  const payload = JSON.parse(JSON.stringify(trip));
  delete payload.cloudId;
  return payload;
}

async function saveTripRecord(trip, payload) {
  const { error } = await cloudClient.rpc("save_first_note_trip", {
    p_id: trip.cloudId,
    p_title: trip.tripName || "新しい旅",
    p_trip_data: payload
  });
  if (error) throw error;
}

async function syncOneTrip(trip) {
  if (!cloudSession?.user) return;
  if (!trip.cloudId) trip.cloudId = crypto.randomUUID();

  // 写真のStorage権限は旅行本体の存在を確認するため、先に旅行を作る。
  const initialPayload = cloudPayload(trip);
  initialPayload.tripPhoto = isInlinePhoto(initialPayload.tripPhoto) ? "" : initialPayload.tripPhoto;
  initialPayload.memories = (initialPayload.memories || []).map((memory) => ({
    ...memory,
    photo: isInlinePhoto(memory.photo) ? "" : memory.photo
  }));
  await saveTripRecord(trip, initialPayload);

  await uploadPendingPhotos(trip);
  await saveTripRecord(trip, cloudPayload(trip));
}

async function syncAllLocalTrips() {
  for (const trip of trips) await syncOneTrip(trip);
  saveTrips();
}

function tripFromCloudRow(row) {
  const data = row.trip_data || {};
  return { ...blankTrip(), ...data, id: data.id || `trip_${row.id}`, cloudId: row.id };
}

async function fetchCloudTrips() {
  const { data, error } = await cloudClient.from("trips").select("id,title,trip_data,updated_at").order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

function hasMeaningfulLocalData() {
  return trips.some((trip) => trip.tripName || trip.destination || trip.startDate || trip.tripPhoto || trip.concept || trip.schedule?.length || trip.checklist?.length || trip.memos?.length || trip.memories?.length);
}

function applyCloudRows(rows) {
  if (!rows.length) return;
  const previousId = activeTripId;
  trips = rows.map(tripFromCloudRow);
  activeTripId = trips.some((trip) => trip.id === previousId) ? previousId : trips[0].id;
  saveTrips();
  loadActiveTrip();
  refreshFromState();
}

async function firstCloudLink() {
  const userId = cloudSession.user.id;
  const linkedKey = CLOUD_LINK_PREFIX + userId;
  let rows = await fetchCloudTrips();
  if (!localStorage.getItem(linkedKey) && rows.length && hasMeaningfulLocalData()) {
    localStorage.setItem(LOCAL_BACKUP_PREFIX + Date.now(), JSON.stringify(trips));
    const addLocal = confirm("クラウドには既に旅行があります。\n\n［OK］この端末の旅行もクラウドへ追加する\n［キャンセル］クラウドの旅行をこの端末で使う\n\n現在の端末データは念のためバックアップされます。");
    if (addLocal) {
      trips.forEach((trip) => { delete trip.cloudId; });
      await syncAllLocalTrips();
      rows = await fetchCloudTrips();
    }
  } else if (!rows.length) {
    await syncAllLocalTrips();
    rows = await fetchCloudTrips();
  } else {
    const unsynced = trips.filter((trip) => !trip.cloudId);
    for (const trip of unsynced) await syncOneTrip(trip);
    if (unsynced.length) {
      saveTrips();
      rows = await fetchCloudTrips();
    }
  }
  localStorage.setItem(linkedKey, "1");
  applyCloudRows(rows);
}

async function runCloudSave() {
  if (!cloudSession?.user) return;
  if (cloudBusy) {
    cloudQueued = true;
    return;
  }
  cloudBusy = true;
  setSyncStatus("syncing", "保存中…");
  try {
    const currentTrip = trips.find((trip) => trip.id === activeTripId);
    if (currentTrip) await syncOneTrip(currentTrip);
    saveTrips();
    setSyncStatus("online", "同期済み");
  } catch (error) {
    console.error(error);
    setSyncStatus("error", "同期エラー");
  } finally {
    cloudBusy = false;
    if (cloudQueued) {
      cloudQueued = false;
      runCloudSave();
    }
  }
}

function scheduleCloudSave() {
  if (!cloudSession?.user) return;
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(runCloudSave, 800);
}

async function pullCloudNow(pushLocalFirst = true) {
  if (!cloudSession?.user) return;
  const button = document.getElementById("syncNowBtn");
  if (button) {
    button.disabled = true;
    button.textContent = "同期中…";
  }
  if (cloudSaveTimer) {
    clearTimeout(cloudSaveTimer);
    cloudSaveTimer = null;
    await runCloudSave();
  }
  if (cloudBusy) {
    if (button) {
      button.disabled = false;
      button.textContent = "今すぐ同期";
    }
    return;
  }
  setSyncStatus("syncing", "読込中…");
  try {
    // 手動同期は、まずこの端末の全旅行を確実にクラウドへ送る。
    if (pushLocalFirst === true) await syncAllLocalTrips();
    const rows = await fetchCloudTrips();
    applyCloudRows(rows);
    lastCloudPullAt = Date.now();
    setSyncStatus("online", "同期済み");
    if (button) button.textContent = "同期完了 ✓";
  } catch (error) {
    console.error(error);
    setSyncStatus("error", "同期エラー");
    if (button) button.textContent = "同期失敗・再試行";
    alert("同期に失敗しました。\n\n" + (error?.message || String(error)));
  } finally {
    if (button) {
      button.disabled = false;
      setTimeout(() => {
        if (button.textContent === "同期完了 ✓") button.textContent = "今すぐ同期";
      }, 1800);
    }
  }
}

function autoPullCloud() {
  if (!cloudSession?.user || document.hidden || Date.now() - lastCloudPullAt < 5000) return;
  pullCloudNow(false);
}

async function signIn() {
  const email = document.getElementById("authEmail").value.trim();
  const password = document.getElementById("authPassword").value;
  if (!email || password.length < 6) return alert("メールアドレスと6文字以上のパスワードを入力してください。");
  const { error } = await cloudClient.auth.signInWithPassword({ email, password });
  if (error) alert("ログインできませんでした：" + error.message);
}

async function signUp() {
  const email = document.getElementById("authEmail").value.trim();
  const password = document.getElementById("authPassword").value;
  if (!email || password.length < 6) return alert("メールアドレスと6文字以上のパスワードを入力してください。");
  const { data, error } = await cloudClient.auth.signUp({ email, password, options: { emailRedirectTo: "https://ymt-tool.github.io/first-note/" } });
  if (error) return alert("登録できませんでした：" + error.message);
  if (!data.session) alert("確認メールを送りました。メール内のリンクを押してからログインしてください。");
}

async function initCloudSync() {
  if (!window.supabase?.createClient) {
    setSyncStatus("error", "接続準備エラー");
    return;
  }
  cloudClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  document.getElementById("accountBtn").addEventListener("click", openAuthPanel);
  document.getElementById("closeAuthBtn").addEventListener("click", closeAuthPanel);
  document.getElementById("authBackdrop").addEventListener("click", closeAuthPanel);
  document.getElementById("signInBtn").addEventListener("click", signIn);
  document.getElementById("signUpBtn").addEventListener("click", signUp);
  document.getElementById("syncNowBtn").addEventListener("click", () => pullCloudNow(true));
  document.getElementById("signOutBtn").addEventListener("click", () => cloudClient.auth.signOut());
  document.addEventListener("visibilitychange", autoPullCloud);
  window.addEventListener("focus", autoPullCloud);

  const { data } = await cloudClient.auth.getSession();
  cloudSession = data.session;
  updateAuthPanel();
  if (cloudSession) {
    try {
      setSyncStatus("syncing", "接続中…");
      await firstCloudLink();
      setSyncStatus("online", "同期済み");
    } catch (error) {
      console.error(error);
      setSyncStatus("error", "同期エラー");
    }
  }

  cloudClient.auth.onAuthStateChange((event, session) => {
    const wasSignedIn = Boolean(cloudSession);
    cloudSession = session;
    updateAuthPanel();
    if (session && !wasSignedIn && event === "SIGNED_IN") {
      closeAuthPanel();
      setTimeout(async () => {
        try {
          setSyncStatus("syncing", "接続中…");
          await firstCloudLink();
          setSyncStatus("online", "同期済み");
        } catch (error) {
          console.error(error);
          setSyncStatus("error", "同期エラー");
        alert("クラウド同期の開始に失敗しました。\n\n" + (error?.message || String(error)) + "\n\n右上の同期表示を押して再度お試しください。");
        }
      }, 0);
    }
  });
}
