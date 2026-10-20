const EXPORT_KEY = "courseExport";
const notice = document.getElementById("notice");
const identityEl = document.getElementById("identity");
const stateEl = document.getElementById("state");
const languagesEl = document.getElementById("languages");
const selectorsEl = document.getElementById("selectors");
const purposesEl = document.getElementById("purposes");
const rawEl = document.getElementById("raw");
let currentReport = null;

function setNotice(message, type = "") {
  notice.textContent = message;
  notice.className = `notice ${type}`.trim();
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, response => {
      if (chrome.runtime.lastError) return reject(new Error("The extension could not inspect this tab. Refresh the Udemy page first."));
      resolve(response);
    });
  });
}

function addDefinition(list, term, value) {
  const dt = document.createElement("dt");
  const dd = document.createElement("dd");
  dt.textContent = term;
  dd.textContent = value ?? "—";
  list.append(dt, dd);
}

function render(report) {
  currentReport = report;
  identityEl.textContent = "";
  stateEl.textContent = "";
  languagesEl.textContent = "";
  selectorsEl.textContent = "";
  purposesEl.textContent = "";

  addDefinition(identityEl, "Course", report.page.identity.courseTitle);
  addDefinition(identityEl, "Course key", report.page.identity.courseKey);
  addDefinition(identityEl, "Host", report.page.identity.host);
  addDefinition(identityEl, "URL", report.page.url);

  addDefinition(stateEl, "Status", report.export.status);
  addDefinition(stateEl, "Lessons", report.export.total);
  addDefinition(stateEl, "Saved", report.export.saved);
  addDefinition(stateEl, "Failed", report.export.failed);
  addDefinition(stateEl, "Watchdog", report.export.watchdogRestarts);

  for (const language of report.page.languages || []) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = `${language.label} (${language.code})`;
    languagesEl.appendChild(chip);
  }
  if (!languagesEl.children.length) languagesEl.textContent = "No transcript languages detected on the current lesson.";

  for (const [name, count] of Object.entries(report.page.selectors || {})) {
    const item = document.createElement("div");
    item.className = `selector ${count ? "good" : ""}`;
    const strong = document.createElement("strong");
    strong.textContent = count;
    const label = document.createElement("span");
    label.textContent = name;
    item.append(strong, label);
    selectorsEl.appendChild(item);
  }

  for (const [purpose, count] of report.page.topDataPurpose || []) {
    const row = document.createElement("div");
    row.className = "purpose-row";
    const name = document.createElement("span");
    name.textContent = purpose;
    const value = document.createElement("strong");
    value.textContent = count;
    row.append(name, value);
    purposesEl.appendChild(row);
  }
  rawEl.textContent = JSON.stringify(report, null, 2);
}

async function refresh() {
  setNotice("Inspecting the active Udemy tab…");
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https:\/\/(?:[^/]+\.)*udemy\.com\//i.test(tab.url || "")) throw new Error("Open a Udemy course tab and try again.");
    const [page, stored] = await Promise.all([
      sendTabMessage(tab.id, { type: "GET_DIAGNOSTICS" }),
      chrome.storage.local.get(EXPORT_KEY)
    ]);
    if (!page?.ok) throw new Error(page?.error || "Diagnostic collection failed.");
    const state = stored[EXPORT_KEY] || {};
    const results = Array.isArray(state.results) ? state.results : [];
    render({
      page,
      export: {
        status: state.status || "none",
        total: state.lessons?.length || 0,
        saved: results.filter(Boolean).length,
        failed: results.filter(item => item && !item.available).length,
        watchdogRestarts: state.watchdogRestarts || 0,
        courseKey: state.courseKey || "",
        updatedAt: state.updatedAt || null
      }
    });
    setNotice("Diagnostic report updated.", "success");
  } catch (error) {
    setNotice(error.message || "Unable to collect diagnostics.", "error");
  }
}

document.getElementById("refreshBtn").addEventListener("click", refresh);
document.getElementById("copyBtn").addEventListener("click", async () => {
  if (!currentReport) return;
  await navigator.clipboard.writeText(JSON.stringify(currentReport, null, 2));
  setNotice("Diagnostic report copied to clipboard.", "success");
});

refresh();
