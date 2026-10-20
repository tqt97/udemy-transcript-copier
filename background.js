const MENU_ROOT = "udemy-helper";
const EXPORT_KEY = "courseExport";
const WATCHDOG_ALARM = "course-export-watchdog";
const WATCHDOG_STALE_MS = 90_000;
const processingTabs = new Set();

async function createMenus() {
  const stored = await chrome.storage.local.get("uiLanguage");
  const vi = stored.uiLanguage !== "en";
  const label = (viText, enText) => vi ? viText : enText;
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_ROOT, title: "Udemy Transcript Copier", contexts: ["page", "video"], documentUrlPatterns: ["https://udemy.com/*", "https://*.udemy.com/*"] });
    chrome.contextMenus.create({ id: "copy-transcript", parentId: MENU_ROOT, title: label("Sao chép transcript hiện tại", "Copy current transcript"), contexts: ["page", "video"] });
    chrome.contextMenus.create({ id: "speed-increase", parentId: MENU_ROOT, title: label("Tăng tốc độ (+0.25×)", "Increase speed (+0.25×)"), contexts: ["page", "video"] });
    chrome.contextMenus.create({ id: "speed-decrease", parentId: MENU_ROOT, title: label("Giảm tốc độ (−0.25×)", "Decrease speed (−0.25×)"), contexts: ["page", "video"] });
    chrome.contextMenus.create({ id: "speed-reset", parentId: MENU_ROOT, title: label("Đặt lại tốc độ (1×)", "Reset speed (1×)"), contexts: ["page", "video"] });
    chrome.contextMenus.create({ id: "speed-separator", parentId: MENU_ROOT, type: "separator", contexts: ["page", "video"] });
    for (const rate of [0.5, 1, 1.25, 1.5, 1.75, 2]) {
      chrome.contextMenus.create({ id: `speed-set-${rate}`, parentId: MENU_ROOT, title: label(`Đặt tốc độ ${rate}×`, `Set speed to ${rate}×`), contexts: ["page", "video"] });
    }
  });
}

function ensureWatchdog() {
  chrome.alarms.create(WATCHDOG_ALARM, { periodInMinutes: 1 });
}

async function getExportState() {
  const stored = await chrome.storage.local.get(EXPORT_KEY);
  return stored[EXPORT_KEY] || null;
}

async function saveExportState(state) {
  state.updatedAt = new Date().toISOString();
  await chrome.storage.local.set({ [EXPORT_KEY]: state });
  return state;
}

function lectureId(url = "") {
  return String(url).match(/\/lecture\/(\d+)/)?.[1] || "";
}

function isSameLesson(urlA, urlB) {
  const idA = lectureId(urlA);
  const idB = lectureId(urlB);
  return idA && idB ? idA === idB : urlA.split("#")[0] === urlB.split("#")[0];
}

function workIndex(state) {
  return Array.isArray(state.retryQueue) ? state.retryQueue[state.retryPosition || 0] : state.currentIndex;
}

function workFinished(state) {
  return Array.isArray(state.retryQueue)
    ? (state.retryPosition || 0) >= state.retryQueue.length
    : state.currentIndex >= state.lessons.length;
}

function advanceWork(state) {
  if (Array.isArray(state.retryQueue)) state.retryPosition = (state.retryPosition || 0) + 1;
  else state.currentIndex += 1;
}

function finishExport(state) {
  state.status = "completed";
  state.completedAt = new Date().toISOString();
  state.currentLessonTitle = "";
  state.captureStartedAt = null;
  state.captureToken = null;
  state.lastRetryAttempt = 0;
  state.retryQueue = null;
  state.retryPosition = 0;
}

function sendToTab(tabId, message, timeoutMs = 45_000) {
  return new Promise(resolve => {
    if (!tabId) return resolve(null);
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      resolve(null);
    }, timeoutMs);
    chrome.tabs.sendMessage(tabId, message, response => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (chrome.runtime.lastError) return resolve(null);
      resolve(response || null);
    });
  });
}

async function captureLessonWithRetry(tabId, lesson, state, attempts = 3) {
  let response = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const current = await getExportState();
    if (!current || current.status !== "running") return { aborted: true };
    current.lastRetryAttempt = attempt;
    await saveExportState(current);
    response = await sendToTab(tabId, {
      type: "CAPTURE_COURSE_LESSON",
      lesson,
      language: current.language || state.language || "auto"
    }, 40_000);
    if (response?.ok) return response;
    if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, 1_000 * attempt));
  }
  return response;
}

async function navigateToCurrent(state) {
  if (!state || state.status !== "running") return;
  if (workFinished(state)) {
    finishExport(state);
    await saveExportState(state);
    return;
  }

  const index = workIndex(state);
  const lesson = state.lessons[index];
  if (!lesson) {
    advanceWork(state);
    await saveExportState(state);
    return navigateToCurrent(state);
  }

  state.navigationStartedAt = new Date().toISOString();
  await saveExportState(state);
  if (lesson.url) {
    await chrome.tabs.update(state.tabId, { url: lesson.url, active: true });
    return;
  }

  // A virtualized Udemy Business sidebar may need to expand and scan several
  // sections before the requested row exists in the DOM.
  const response = await sendToTab(state.tabId, { type: "OPEN_COURSE_LESSON", lesson }, 70_000);
  if (!response?.ok) {
    state.results[index] = {
      ...lesson, transcript: "", cues: [], segmentCount: 0, available: false,
      error: response?.error || "Could not open this lesson.", capturedAt: new Date().toISOString()
    };
    advanceWork(state);
    await saveExportState(state);
    return navigateToCurrent(state);
  }

  if (response.url) lesson.url = response.url;
  await saveExportState(state);
  setTimeout(() => processCurrentPage(state.tabId, response.url || ""), 700);
}

async function processCurrentPage(tabId, currentUrl) {
  if (processingTabs.has(tabId)) return;
  const state = await getExportState();
  if (!state || state.status !== "running" || state.tabId !== tabId || workFinished(state)) return;

  const index = workIndex(state);
  const lesson = state.lessons[index];
  if (!lesson) return;
  if (lesson.url && !isSameLesson(currentUrl || "", lesson.url)) {
    await navigateToCurrent(state);
    return;
  }

  processingTabs.add(tabId);
  try {
    state.currentLessonTitle = lesson.title;
    state.captureStartedAt = new Date().toISOString();
    const captureToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    state.captureToken = captureToken;
    const captureStartedMs = Date.now();
    await saveExportState(state);

    const response = await captureLessonWithRetry(tabId, lesson, state);
    if (response?.aborted) return;
    const latest = await getExportState();
    if (!latest || latest.tabId !== tabId || workIndex(latest) !== index || latest.captureToken !== captureToken) return;

    latest.results[index] = response?.ok
      ? {
          ...lesson,
          // The curriculum title is authoritative. Page-level headings can be the
          // course name on some Udemy layouts and must not replace the lesson name.
          title: lesson.title,
          transcript: response.text || "",
          cues: Array.isArray(response.cues) ? response.cues : [],
          language: response.language || latest.language || "auto",
          segmentCount: response.count || 0,
          available: Boolean(response.available),
          error: response.error || "",
          capturedAt: new Date().toISOString()
        }
      : {
          ...lesson, transcript: "", cues: [], segmentCount: 0, available: false,
          error: "Transcript capture timed out after three attempts.", capturedAt: new Date().toISOString()
        };

    const elapsed = Date.now() - captureStartedMs;
    latest.totalProcessingMs = (latest.totalProcessingMs || 0) + elapsed;
    latest.processingSamples = (latest.processingSamples || 0) + 1;
    latest.lastLessonMs = elapsed;
    latest.captureStartedAt = null;
    latest.captureToken = null;
    latest.currentLessonTitle = "";
    latest.lastRetryAttempt = 0;
    advanceWork(latest);

    if (workFinished(latest)) {
      finishExport(latest);
      await saveExportState(latest);
      const failed = latest.results.filter(item => item && !item.available).length;
      await sendToTab(tabId, {
        type: "SHOW_EXPORT_TOAST",
        message: failed ? `Export complete with ${failed} skipped lessons` : `Course export complete: ${latest.lessons.length} lessons`
      });
      return;
    }

    await saveExportState(latest);
    if (latest.status === "running") {
      await new Promise(resolve => setTimeout(resolve, 1_000));
      const refreshed = await getExportState();
      if (refreshed?.status === "running" && workIndex(refreshed) === workIndex(latest)) await navigateToCurrent(refreshed);
    }
  } finally {
    processingTabs.delete(tabId);
  }
}

async function startExport(message) {
  const lessons = Array.isArray(message.lessons) ? message.lessons : [];
  if (!lessons.length) throw new Error("No lessons were found for this selection.");
  const state = {
    schemaVersion: 2,
    status: "running",
    tabId: message.tabId,
    courseKey: message.courseKey || "",
    courseTitle: message.courseTitle || "Udemy course",
    scopeLabel: message.scopeLabel || "Selected lessons",
    format: message.format || "markdown",
    layout: message.layout || "lesson-zip",
    language: message.language || "auto",
    includeTimestamps: Boolean(message.includeTimestamps),
    normalizeText: Boolean(message.normalizeText),
    includeToc: message.includeToc !== false,
    lessons,
    results: [],
    currentIndex: 0,
    retryQueue: null,
    retryPosition: 0,
    currentLessonTitle: "",
    captureToken: null,
    totalProcessingMs: 0,
    processingSamples: 0,
    watchdogRestarts: 0,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null
  };
  await saveExportState(state);
  ensureWatchdog();
  await navigateToCurrent(state);
  return state;
}

async function resumeExport(message) {
  const state = await getExportState();
  if (!state || workFinished(state)) throw new Error("There is no paused export to resume.");
  if (message.tabId) {
    const identity = await sendToTab(message.tabId, { type: "GET_COURSE_IDENTITY" }, 8_000);
    if (!identity?.ok) throw new Error("Open the original Udemy course before resuming.");
    if (state.courseKey && identity.courseKey && state.courseKey !== identity.courseKey) {
      throw new Error(`This tab contains a different course (${identity.courseTitle || "unknown course"}).`);
    }
    state.tabId = message.tabId;
  }
  state.status = "running";
  state.captureStartedAt = null;
  state.captureToken = null;
  state.error = "";
  await saveExportState(state);
  ensureWatchdog();
  await navigateToCurrent(state);
  return state;
}

async function retryFailed(message) {
  const state = await getExportState();
  if (!state) throw new Error("No saved export was found.");
  const failed = state.results.map((item, index) => item && !item.available ? index : -1).filter(index => index >= 0);
  if (!failed.length) throw new Error("There are no failed lessons to retry.");
  if (message.tabId) {
    const identity = await sendToTab(message.tabId, { type: "GET_COURSE_IDENTITY" }, 8_000);
    if (state.courseKey && identity?.courseKey && state.courseKey !== identity.courseKey) throw new Error("Open the same course before retrying failed lessons.");
    state.tabId = message.tabId;
  }
  state.retryQueue = failed;
  state.retryPosition = 0;
  state.status = "running";
  state.completedAt = null;
  state.error = "";
  await saveExportState(state);
  ensureWatchdog();
  await navigateToCurrent(state);
  return state;
}

async function resetExport() {
  const state = await getExportState();
  if (state?.tabId) processingTabs.delete(state.tabId);
  await chrome.storage.local.remove(EXPORT_KEY);
  return null;
}

chrome.runtime.onInstalled.addListener(() => { createMenus(); ensureWatchdog(); });
chrome.runtime.onStartup.addListener(async () => {
  createMenus();
  ensureWatchdog();
  const state = await getExportState();
  if (state?.status === "running") await navigateToCurrent(state);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "copy-transcript") return void sendToTab(tab?.id, { type: "COPY_UDEMY_TRANSCRIPT" });
  const actions = { "speed-increase": "increase", "speed-decrease": "decrease", "speed-reset": "reset" };
  if (actions[info.menuItemId]) return void sendToTab(tab?.id, { type: "CHANGE_PLAYBACK_SPEED", action: actions[info.menuItemId] });
  if (String(info.menuItemId).startsWith("speed-set-")) {
    sendToTab(tab?.id, { type: "CHANGE_PLAYBACK_SPEED", action: "set", value: Number(String(info.menuItemId).replace("speed-set-", "")) });
  }
});

chrome.commands.onCommand.addListener(async command => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const actions = { "increase-playback-speed": "increase", "decrease-playback-speed": "decrease", "reset-playback-speed": "reset" };
  if (actions[command]) sendToTab(tab?.id, { type: "CHANGE_PLAYBACK_SPEED", action: actions[command] });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "COURSE_EXPORT_PAGE_READY") {
    processCurrentPage(sender.tab?.id, sender.tab?.url).catch(() => {});
    return;
  }
  if (message?.type === "START_COURSE_EXPORT") {
    startExport(message).then(state => sendResponse({ ok: true, state })).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "PAUSE_COURSE_EXPORT") {
    getExportState().then(async state => {
      if (state?.status === "running") { state.status = "paused"; await saveExportState(state); }
      sendResponse({ ok: true, state });
    });
    return true;
  }
  if (message?.type === "RESUME_COURSE_EXPORT") {
    resumeExport(message).then(state => sendResponse({ ok: true, state })).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "RETRY_FAILED_LESSONS") {
    retryFailed(message).then(state => sendResponse({ ok: true, state })).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "RESET_COURSE_EXPORT") {
    resetExport().then(() => sendResponse({ ok: true })).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "SET_UI_LANGUAGE") {
    chrome.storage.local.set({ uiLanguage: message.language === "en" ? "en" : "vi" }).then(() => {
      createMenus();
      sendResponse({ ok: true });
    });
    return true;
  }
});

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name !== WATCHDOG_ALARM) return;
  const state = await getExportState();
  if (!state || state.status !== "running") return;
  const staleMs = Date.now() - new Date(state.updatedAt || 0).getTime();
  if (staleMs < WATCHDOG_STALE_MS) return;
  processingTabs.delete(state.tabId);
  state.watchdogRestarts = (state.watchdogRestarts || 0) + 1;
  state.captureStartedAt = null;
  state.captureToken = null;
  state.error = "The watchdog restarted a stalled lesson.";
  await saveExportState(state);
  await navigateToCurrent(state);
});

chrome.tabs.onRemoved.addListener(async tabId => {
  const state = await getExportState();
  if (state?.tabId === tabId && state.status === "running") {
    state.status = "paused";
    state.error = "The export tab was closed. Open the same course in a new tab and press Resume.";
    await saveExportState(state);
  }
});
