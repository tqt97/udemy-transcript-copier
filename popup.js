const EXPORT_KEY = "courseExport";
const el = id => document.getElementById(id);
const I18N = {
  vi: {
    subtitle: "Xuất transcript khóa học", diagnostics: "Chẩn đoán", openLesson: "Hãy mở một bài học Udemy.", exportLabel: "XUẤT",
    courseTranscripts: "Transcript khóa học", refresh: "Làm mới", scope: "Phạm vi", entireCourse: "Toàn khóa học",
    selectedSections: "Các section đã chọn", lessonRange: "Khoảng bài học", sections: "Sections", all: "Tất cả", none: "Bỏ chọn", to: "đến",
    transcriptLanguage: "Ngôn ngữ transcript", autoCurrent: "Tự động / hiện tại", fileFormat: "Định dạng", plainText: "Văn bản",
    organization: "Cách tổ chức file", perLesson: "Mỗi bài một file (.zip)", perSection: "Mỗi section một file (.zip)", singleFile: "Một file tổng hợp",
    advanced: "Tùy chọn nâng cao", timestamps: "Kèm timestamp", normalize: "Chuẩn hóa và loại filler", toc: "Mục lục Markdown",
    start: "Bắt đầu xuất", progressLabel: "TIẾN ĐỘ", estimating: "Đang ước tính…", pause: "Tạm dừng", resume: "Tiếp tục", download: "Tải xuống",
    autosaved: "Tự lưu sau mỗi bài", reset: "Xóa tiến trình", attention: "CẦN XỬ LÝ", retry: "Thử lại", searchLabel: "TÌM KIẾM",
    collected: "Transcript đã thu thập", searchPlaceholder: "Tìm tiêu đề và nội dung…", currentTools: "Công cụ cho bài hiện tại",
    copy: "Sao chép transcript", saveTxt: "Lưu .txt"
  },
  en: {
    subtitle: "Course transcript export", diagnostics: "Diagnostics", openLesson: "Open a Udemy course lesson.", exportLabel: "EXPORT",
    courseTranscripts: "Course transcripts", refresh: "Refresh", scope: "Export scope", entireCourse: "Entire course",
    selectedSections: "Selected sections", lessonRange: "Lesson range", sections: "Sections", all: "All", none: "None", to: "to",
    transcriptLanguage: "Transcript language", autoCurrent: "Auto / current", fileFormat: "File format", plainText: "Plain text",
    organization: "File organization", perLesson: "One file per lesson (.zip)", perSection: "One file per section (.zip)", singleFile: "Single combined file",
    advanced: "Advanced options", timestamps: "Include timestamps", normalize: "Normalize text and remove fillers", toc: "Markdown table of contents",
    start: "Start export", progressLabel: "PROGRESS", estimating: "Estimating time…", pause: "Pause", resume: "Resume", download: "Download",
    autosaved: "Saved after every lesson", reset: "Reset progress", attention: "NEEDS ATTENTION", retry: "Retry failed", searchLabel: "SEARCH",
    collected: "Collected transcripts", searchPlaceholder: "Search titles and transcript text…", currentTools: "Current lesson tools",
    copy: "Copy transcript", saveTxt: "Save .txt"
  }
};
let uiLanguage = "vi";
const t = (vi, en) => uiLanguage === "vi" ? vi : en;

function applyLanguage() {
  document.documentElement.lang = uiLanguage;
  el("uiLanguage").value = uiLanguage;
  for (const node of document.querySelectorAll("[data-i18n]")) node.textContent = I18N[uiLanguage][node.dataset.i18n] || node.textContent;
  for (const node of document.querySelectorAll("[data-i18n-title]")) {
    const value = I18N[uiLanguage][node.dataset.i18nTitle];
    if (value) { node.title = value; node.setAttribute("aria-label", value); }
  }
  for (const node of document.querySelectorAll("[data-i18n-placeholder]")) node.placeholder = I18N[uiLanguage][node.dataset.i18nPlaceholder] || node.placeholder;
  if (renderedState) renderProgress(renderedState);
}
const statusEl = el("status");
const refreshBtn = el("refreshBtn");
const scopeMode = el("scopeMode");
const sectionsField = el("sectionsField");
const sectionsSelect = el("sectionsSelect");
const rangeField = el("rangeField");
const rangeFrom = el("rangeFrom");
const rangeTo = el("rangeTo");
const languageSelect = el("languageSelect");
const formatSelect = el("formatSelect");
const layoutSelect = el("layoutSelect");
const timestampsCheck = el("timestampsCheck");
const normalizeCheck = el("normalizeCheck");
const tocCheck = el("tocCheck");
const startBtn = el("startBtn");
const progressArea = el("progressArea");
const progressText = el("progressText");
const progressPercent = el("progressPercent");
const progressBar = el("progressBar");
const etaText = el("etaText");
const watchdogText = el("watchdogText");
const currentLessonEl = el("currentLesson");
const pauseBtn = el("pauseBtn");
const resumeBtn = el("resumeBtn");
const exportBtn = el("exportBtn");
const failedArea = el("failedArea");
const failedHeading = el("failedHeading");
const failedList = el("failedList");
const retryFailedBtn = el("retryFailedBtn");
const searchArea = el("searchArea");
const searchInput = el("searchInput");
const searchSummary = el("searchSummary");
const searchResults = el("searchResults");
const copyBtn = el("copyBtn");
const downloadBtn = el("downloadBtn");
const cueCountEl = el("cueCount");
const charCountEl = el("charCount");
const resetBtn = el("resetBtn");

let latestText = "";
let currentOutline = null;
let activeTab = null;
let renderedState = null;

function setStatus(message, type = "") {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`.trim();
}

function sendMessage(message) {
  return new Promise(resolve => chrome.runtime.sendMessage(message, resolve));
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, response => {
      if (chrome.runtime.lastError) return reject(new Error(t("Không thể đọc trang. Hãy tải lại tab Udemy rồi thử lại.", "Could not read this page. Refresh the Udemy tab and try again.")));
      resolve(response);
    });
  });
}

async function getActiveUdemyTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !/^https:\/\/(?:[^/]+\.)*udemy\.com\//i.test(tab.url)) throw new Error(t("Hãy mở một bài học Udemy trước.", "Open a Udemy course lesson first."));
  return tab;
}

function renderScopeControls() {
  sectionsField.classList.toggle("hidden", scopeMode.value !== "sections");
  rangeField.classList.toggle("hidden", scopeMode.value !== "range");
}

function syncFormatOptions() {
  tocCheck.disabled = formatSelect.value !== "markdown";
}

async function loadOutline() {
  refreshBtn.disabled = true;
  scopeMode.disabled = true;
  startBtn.disabled = true;
  setStatus(t("Đang đọc danh sách bài và ngôn ngữ…", "Reading course outline and transcript languages…"));
  try {
    activeTab = await getActiveUdemyTab();
    const [outline, languageResult] = await Promise.all([
      sendTabMessage(activeTab.id, { type: "GET_COURSE_OUTLINE" }),
      sendTabMessage(activeTab.id, { type: "GET_TRANSCRIPT_LANGUAGES" }).catch(() => ({ languages: [] }))
    ]);
    if (!outline?.ok) throw new Error(outline?.error || t("Không tìm thấy bài học.", "Course lessons were not found."));
    currentOutline = outline;

    sectionsSelect.textContent = "";
    for (const section of outline.sections) {
      const option = document.createElement("option");
      option.value = section.key;
      option.textContent = `${section.title} (${section.count})`;
      option.selected = true;
      sectionsSelect.appendChild(option);
    }
    rangeFrom.max = outline.lessons.length;
    rangeTo.max = outline.lessons.length;
    rangeTo.value = outline.lessons.length;

    languageSelect.textContent = "";
    const automatic = document.createElement("option");
    automatic.value = "auto";
    automatic.textContent = I18N[uiLanguage].autoCurrent;
    languageSelect.appendChild(automatic);
    for (const language of languageResult?.languages || []) {
      const option = document.createElement("option");
      option.value = language.code;
      option.textContent = language.label || language.code;
      languageSelect.appendChild(option);
    }

    scopeMode.disabled = false;
    startBtn.disabled = false;
    setStatus(t(`Đã tìm thấy ${outline.lessons.length} bài trong ${outline.sections.length} section.`, `Found ${outline.lessons.length} lessons in ${outline.sections.length} sections.`), "success");
  } catch (error) {
    setStatus(error.message || t("Không thể đọc danh sách khóa học.", "Unable to read the course outline."), "error");
  } finally {
    refreshBtn.disabled = false;
  }
}

function selectedLessons() {
  if (!currentOutline) return [];
  if (scopeMode.value === "sections") {
    const selected = new Set(Array.from(sectionsSelect.selectedOptions, option => option.value));
    return currentOutline.lessons.filter(lesson => selected.has(lesson.sectionKey));
  }
  if (scopeMode.value === "range") {
    const from = Math.max(1, Number(rangeFrom.value) || 1);
    const to = Math.min(currentOutline.lessons.length, Number(rangeTo.value) || currentOutline.lessons.length);
    return currentOutline.lessons.slice(Math.min(from, to) - 1, Math.max(from, to));
  }
  return currentOutline.lessons;
}

function scopeLabelFor(lessons) {
  if (scopeMode.value === "all") return t("Toàn khóa học", "Entire course");
  if (scopeMode.value === "range") return t(`Bài ${rangeFrom.value}-${rangeTo.value}`, `Lessons ${rangeFrom.value}-${rangeTo.value}`);
  const selected = Array.from(sectionsSelect.selectedOptions, option => option.textContent.replace(/\s+\(\d+\)$/, ""));
  return selected.length === 1 ? selected[0] : t(`${selected.length} section (${lessons.length} bài)`, `${selected.length} selected sections (${lessons.length} lessons)`);
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return I18N[uiLanguage].estimating;
  const rounded = Math.max(1, Math.round(seconds));
  if (rounded < 60) return t(`Còn khoảng ${rounded} giây`, `About ${rounded}s remaining`);
  const minutes = Math.ceil(rounded / 60);
  return t(`Còn khoảng ${minutes} phút`, `About ${minutes} min remaining`);
}

function resultCount(state) {
  return (state.results || []).filter(Boolean).length;
}

function renderFailures(state) {
  const failed = (state.results || []).filter(item => item && !item.available);
  failedArea.classList.toggle("hidden", failed.length === 0);
  failedHeading.textContent = t(`${failed.length} bài bị bỏ qua`, `${failed.length} skipped lesson${failed.length === 1 ? "" : "s"}`);
  failedList.textContent = "";
  for (const item of failed) {
    const li = document.createElement("li");
    const title = document.createElement("strong");
    title.textContent = item.title;
    const error = document.createElement("span");
    error.textContent = item.error || t("Không có transcript", "Transcript unavailable");
    li.append(title, error);
    failedList.appendChild(li);
  }
  retryFailedBtn.disabled = state.status === "running";
}

function renderProgress(state) {
  renderedState = state;
  if (!state?.lessons?.length) return progressArea.classList.add("hidden");
  progressArea.classList.remove("hidden");
  const total = state.lessons.length;
  const done = Math.min(resultCount(state), total);
  const percent = Math.round((done / total) * 100);
  progressText.textContent = t(`${done}/${total} bài`, `${done}/${total} lessons`);
  progressPercent.textContent = `${percent}%`;
  progressBar.max = total;
  progressBar.value = done;
  const averageMs = state.processingSamples ? state.totalProcessingMs / state.processingSamples : 0;
  const remaining = Array.isArray(state.retryQueue)
    ? Math.max(0, state.retryQueue.length - (state.retryPosition || 0))
    : Math.max(0, total - done);
  etaText.textContent = state.status === "completed" ? t("Đã hoàn tất", "Export complete") : formatDuration((averageMs * remaining) / 1000);
  watchdogText.textContent = state.watchdogRestarts ? t(`Đã tự phục hồi ${state.watchdogRestarts} lần`, `Recovered ${state.watchdogRestarts} stall${state.watchdogRestarts === 1 ? "" : "s"}`) : "";

  if (state.status === "running") {
    const retry = state.lastRetryAttempt > 1 ? t(` · lần ${state.lastRetryAttempt}/3`, ` · attempt ${state.lastRetryAttempt}/3`) : "";
    currentLessonEl.textContent = state.currentLessonTitle ? t(`Đang xử lý: ${state.currentLessonTitle}${retry}`, `Processing: ${state.currentLessonTitle}${retry}`) : t("Đang mở bài tiếp theo…", "Opening the next lesson…");
  } else if (state.status === "paused") {
    currentLessonEl.textContent = state.error || t("Đã tạm dừng. Mở đúng khóa học rồi tiếp tục.", "Export paused. Open the same course and resume when ready.");
  } else {
    currentLessonEl.textContent = t(`Đã lưu ${done} bài. Có thể tải xuống hoặc thử lại bài lỗi.`, `${done} lessons saved. Download or retry skipped lessons.`);
  }

  pauseBtn.classList.toggle("hidden", state.status !== "running");
  resumeBtn.classList.toggle("hidden", state.status !== "paused");
  exportBtn.disabled = done === 0;
  exportBtn.textContent = state.status === "completed" ? t("Tải bản xuất", "Download export") : t("Tải phần đã lưu", "Download saved progress");
  startBtn.disabled = state.status === "running" || state.status === "paused";
  searchArea.classList.toggle("hidden", done === 0);
  renderFailures(state);
  if (searchInput.value) runSearch();
}

function runSearch() {
  const query = searchInput.value.trim().toLowerCase();
  searchResults.textContent = "";
  if (!query || !renderedState) {
    searchSummary.textContent = "";
    return;
  }
  const matches = [];
  for (const item of renderedState.results || []) {
    if (!item) continue;
    const haystack = `${item.title}\n${item.transcript}`.toLowerCase();
    const index = haystack.indexOf(query);
    if (index < 0) continue;
    const raw = `${item.title}\n${item.transcript}`;
    matches.push({ item, snippet: raw.slice(Math.max(0, index - 55), index + query.length + 95).replace(/\s+/g, " ") });
  }
  searchSummary.textContent = t(`${matches.length} bài phù hợp`, `${matches.length} matching lesson${matches.length === 1 ? "" : "s"}`);
  for (const match of matches.slice(0, 50)) {
    const li = document.createElement("li");
    const title = document.createElement("strong");
    title.textContent = match.item.title;
    const snippet = document.createElement("span");
    snippet.textContent = match.snippet;
    li.append(title, snippet);
    searchResults.appendChild(li);
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

scopeMode.addEventListener("change", renderScopeControls);
formatSelect.addEventListener("change", syncFormatOptions);
refreshBtn.addEventListener("click", loadOutline);
searchInput.addEventListener("input", runSearch);
el("diagnosticsBtn").addEventListener("click", () => chrome.runtime.openOptionsPage());
el("uiLanguage").addEventListener("change", async event => {
  uiLanguage = event.target.value === "en" ? "en" : "vi";
  await chrome.storage.local.set({ uiLanguage });
  await sendMessage({ type: "SET_UI_LANGUAGE", language: uiLanguage });
  applyLanguage();
});
el("selectAllSections").addEventListener("click", () => {
  for (const option of sectionsSelect.options) option.selected = true;
});
el("clearSections").addEventListener("click", () => {
  for (const option of sectionsSelect.options) option.selected = false;
});

startBtn.addEventListener("click", async () => {
  const lessons = selectedLessons();
  if (!lessons.length) return setStatus(t("Hãy chọn ít nhất một section hoặc bài học.", "Select at least one section or lesson."), "error");
  startBtn.disabled = true;
  const response = await sendMessage({
    type: "START_COURSE_EXPORT",
    tabId: activeTab.id,
    courseKey: currentOutline.courseKey,
    courseTitle: currentOutline.courseTitle,
    scopeLabel: scopeLabelFor(lessons),
    format: formatSelect.value,
    layout: layoutSelect.value,
    language: languageSelect.value,
    includeTimestamps: timestampsCheck.checked,
    normalizeText: normalizeCheck.checked,
    includeToc: tocCheck.checked,
    lessons
  });
  if (!response?.ok) {
    setStatus(response?.error || t("Không thể bắt đầu xuất.", "Could not start the export."), "error");
    startBtn.disabled = false;
  } else {
    renderProgress(response.state);
    setStatus(t("Đã bắt đầu. Bạn có thể đóng popup.", "Export started. You can close this popup."), "success");
  }
});

pauseBtn.addEventListener("click", async () => {
  const response = await sendMessage({ type: "PAUSE_COURSE_EXPORT" });
  if (response?.state) renderProgress(response.state);
});

async function activeTabIdOrNull() {
  try { return (await getActiveUdemyTab()).id; } catch (_) { return null; }
}

resumeBtn.addEventListener("click", async () => {
  const response = await sendMessage({ type: "RESUME_COURSE_EXPORT", tabId: await activeTabIdOrNull() });
  if (response?.ok) {
    renderProgress(response.state);
    setStatus(t("Đã tiếp tục xuất.", "Export resumed."), "success");
  } else setStatus(response?.error || t("Không thể tiếp tục.", "Could not resume the export."), "error");
});

retryFailedBtn.addEventListener("click", async () => {
  retryFailedBtn.disabled = true;
  const response = await sendMessage({ type: "RETRY_FAILED_LESSONS", tabId: await activeTabIdOrNull() });
  if (response?.ok) {
    renderProgress(response.state);
    setStatus(t("Đang thử lại các bài bị bỏ qua.", "Retrying skipped lessons."), "success");
  } else {
    setStatus(response?.error || t("Không thể thử lại các bài lỗi.", "Could not retry skipped lessons."), "error");
    retryFailedBtn.disabled = false;
  }
});

exportBtn.addEventListener("click", async () => {
  const stored = await chrome.storage.local.get(EXPORT_KEY);
  const state = stored[EXPORT_KEY];
  if (!state) return;
  const output = ExportUtils.buildExport(state, {
    format: formatSelect.value,
    layout: layoutSelect.value,
    includeTimestamps: timestampsCheck.checked,
    normalizeText: normalizeCheck.checked,
    includeToc: tocCheck.checked
  });
  downloadBlob(output.blob, output.filename);
  setStatus(t(`Đã tải ${output.filename}.`, `Downloaded ${output.filename}.`), "success");
});

resetBtn.addEventListener("click", async () => {
  const armed = resetBtn.dataset.armed === "true";
  if (!armed) {
    resetBtn.dataset.armed = "true";
    resetBtn.textContent = t("Bấm lại để xác nhận", "Click again to confirm");
    setTimeout(() => {
      resetBtn.dataset.armed = "false";
      resetBtn.textContent = I18N[uiLanguage].reset;
    }, 3500);
    return;
  }
  const response = await sendMessage({ type: "RESET_COURSE_EXPORT" });
  if (!response?.ok) return setStatus(response?.error || t("Không thể xóa tiến trình.", "Could not reset progress."), "error");
  renderedState = null;
  progressArea.classList.add("hidden");
  failedArea.classList.add("hidden");
  searchArea.classList.add("hidden");
  startBtn.disabled = !currentOutline;
  resetBtn.dataset.armed = "false";
  resetBtn.textContent = I18N[uiLanguage].reset;
  setStatus(t("Đã xóa tiến trình cũ. Có thể bắt đầu bản xuất mới.", "Previous progress cleared. You can start a new export."), "success");
});

copyBtn.addEventListener("click", async () => {
  copyBtn.disabled = true;
  try {
    const tab = await getActiveUdemyTab();
    const result = await sendTabMessage(tab.id, { type: "GET_UDEMY_TRANSCRIPT" });
    if (!result?.ok || !result.text?.trim()) throw new Error(result?.error || t("Transcript đang trống.", "The transcript panel is empty."));
    latestText = result.text;
    cueCountEl.textContent = t(`${result.count} đoạn`, `${result.count} segments`);
    charCountEl.textContent = t(`${result.text.length.toLocaleString()} ký tự`, `${result.text.length.toLocaleString()} characters`);
    downloadBtn.disabled = false;
    await navigator.clipboard.writeText(result.text);
    setStatus(t(`Đã sao chép ${result.count} đoạn transcript.`, `Copied ${result.count} transcript segments.`), "success");
  } catch (error) {
    setStatus(error.message || t("Không thể sao chép transcript.", "Could not copy transcript."), "error");
  } finally { copyBtn.disabled = false; }
});

downloadBtn.addEventListener("click", () => {
  if (latestText) downloadBlob(new Blob([latestText], { type: "text/plain;charset=utf-8" }), "udemy-transcript.txt");
});

chrome.storage.onChanged.addListener(changes => {
  if (changes[EXPORT_KEY]?.newValue) renderProgress(changes[EXPORT_KEY].newValue);
});

(async () => {
  const preferences = await chrome.storage.local.get("uiLanguage");
  uiLanguage = preferences.uiLanguage === "en" ? "en" : "vi";
  applyLanguage();
  renderScopeControls();
  const stored = await chrome.storage.local.get(EXPORT_KEY);
  const state = stored[EXPORT_KEY];
  if (state) {
    renderProgress(state);
    formatSelect.value = state.format || "markdown";
    layoutSelect.value = state.layout || "lesson-zip";
    timestampsCheck.checked = Boolean(state.includeTimestamps);
    normalizeCheck.checked = Boolean(state.normalizeText);
    tocCheck.checked = state.includeToc !== false;
  }
  syncFormatOptions();
  if (state?.status === "running" || state?.status === "paused") {
    setStatus(state.status === "running" ? t("Đang xuất trong tab Udemy.", "Course export is running in the Udemy tab.") : t("Tiến trình đang tạm dừng.", "Course export is paused."), "success");
    return;
  }
  await loadOutline();
})();
