(() => {
  if (window.__udemyTranscriptCopierInstalled) return;
  window.__udemyTranscriptCopierInstalled = true;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const cleanText = value => String(value || "").replace(/\s+/g, " ").trim();

  function extractCueEntries(panel) {
    const cueTextNodes = Array.from(panel.querySelectorAll('[data-purpose="cue-text"]'));
    const nodes = cueTextNodes.length ? cueTextNodes : Array.from(panel.querySelectorAll('[data-purpose="transcript-cue"]'));
    return nodes.map(node => {
      const wrapper = node.closest('[data-purpose="transcript-cue"]') || node;
      const textNode = node.matches('[data-purpose="cue-text"]') ? node : node.querySelector('[data-purpose="cue-text"]');
      const text = cleanText(textNode?.innerText || textNode?.textContent || node.innerText || node.textContent);
      const timestamp = cleanText(wrapper.querySelector?.('[data-purpose="cue-time"], [data-purpose="transcript-cue-time"]')?.textContent);
      const identity = wrapper.id || wrapper.getAttribute?.("data-index") || wrapper.getAttribute?.("data-start-time") || "";
      const key = identity || timestamp ? `${identity}|${timestamp}|${text}` : text;
      return { key, text, timestamp };
    }).filter(entry => entry.text);
  }

  function extractTranscriptFromPanel(panel) {
    const segments = [];
    for (const entry of extractCueEntries(panel)) {
      if (segments[segments.length - 1] !== entry.text) segments.push(entry.text);
    }
    return segments;
  }

  function extractTranscript() {
    const panel = document.querySelector('[data-purpose="transcript-panel"]');
    if (!panel) return { ok: false, error: "Transcript panel not found. Open the course Transcript panel first." };
    const segments = extractTranscriptFromPanel(panel);
    return { ok: true, count: segments.length, text: segments.join("\n") };
  }

  function showToast(message, isError = false) {
    document.getElementById("udemy-transcript-copier-toast")?.remove();
    const toast = document.createElement("div");
    toast.id = "udemy-transcript-copier-toast";
    toast.textContent = message;
    Object.assign(toast.style, {
      position: "fixed", top: "20px", right: "20px", zIndex: "2147483647",
      padding: "10px 14px", borderRadius: "8px", background: isError ? "#b42318" : "#1c1d1f",
      color: "#fff", font: "600 14px/1.4 system-ui, sans-serif", boxShadow: "0 4px 16px rgba(0, 0, 0, .25)"
    });
    document.documentElement.appendChild(toast);
    setTimeout(() => toast.remove(), 2200);
  }

  async function copyTranscript() {
    const result = extractTranscript();
    if (!result.ok) throw new Error(result.error);
    if (!result.text.trim()) throw new Error("No transcript text was detected.");
    try {
      await navigator.clipboard.writeText(result.text);
    } catch (_) {
      const textarea = document.createElement("textarea");
      textarea.value = result.text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      if (!copied) throw new Error("Could not copy the transcript.");
    }
    showToast(`Copied ${result.count} transcript segments`);
    return result;
  }

  function changePlaybackSpeed(action, value) {
    const video = document.querySelector("video");
    if (!video) throw new Error("Udemy video was not found on this page.");
    let nextRate = video.playbackRate;
    if (action === "increase") nextRate += 0.25;
    if (action === "decrease") nextRate -= 0.25;
    if (action === "reset") nextRate = 1;
    if (action === "set") nextRate = Number(value);
    nextRate = Math.min(4, Math.max(0.25, Math.round(nextRate * 4) / 4));
    video.defaultPlaybackRate = nextRate;
    video.playbackRate = nextRate;
    showToast(`Playback speed: ${nextRate}×`);
    return nextRate;
  }

  function findCourseTitle() {
    for (const selector of ['[data-purpose="course-header-title"]', '[data-purpose="course-title"]', "h1"]) {
      const text = cleanText(document.querySelector(selector)?.textContent);
      if (text) return text;
    }
    return cleanText(document.title.replace(/\s*[|–-]\s*Udemy.*$/i, "")) || "Udemy course";
  }

  function getCourseIdentity() {
    const slug = location.pathname.match(/\/course\/([^/]+)/i)?.[1] || "";
    const host = location.hostname.toLowerCase();
    return {
      ok: Boolean(slug),
      courseKey: slug ? `${host}:${slug.toLowerCase()}` : "",
      courseTitle: findCourseTitle(),
      host,
      slug
    };
  }

  function availableTranscriptLanguages() {
    const languages = new Map();
    const video = document.querySelector("video");
    for (const track of Array.from(video?.textTracks || [])) {
      const code = track.language || track.label;
      if (code) languages.set(code, { code, label: track.label || track.language, source: "text-track" });
    }
    const selectors = document.querySelectorAll('select[data-purpose*="transcript" i] option, select[aria-label*="language" i] option');
    for (const option of selectors) {
      const code = option.value || cleanText(option.textContent);
      if (code) languages.set(code, { code, label: cleanText(option.textContent) || code, source: "selector" });
    }
    return Array.from(languages.values());
  }

  async function selectTranscriptLanguage(preference) {
    if (!preference || preference === "auto") return null;
    const normalized = preference.toLowerCase();
    const video = document.querySelector("video");
    let selectedTrack = null;
    for (const track of Array.from(video?.textTracks || [])) {
      const matches = [track.language, track.label].some(value => String(value || "").toLowerCase() === normalized);
      if (matches) selectedTrack = track;
    }
    if (selectedTrack) {
      for (const track of Array.from(video.textTracks)) track.mode = track === selectedTrack ? "hidden" : "disabled";
      await sleep(650);
    }

    const selects = document.querySelectorAll('select[data-purpose*="transcript" i], select[aria-label*="language" i]');
    for (const select of selects) {
      const option = Array.from(select.options).find(item =>
        String(item.value).toLowerCase() === normalized || cleanText(item.textContent).toLowerCase() === normalized
      );
      if (option) {
        select.value = option.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        await sleep(800);
      }
    }
    return selectedTrack;
  }

  function formatTimestamp(seconds) {
    if (!Number.isFinite(seconds)) return "";
    const total = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    return hours
      ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
      : `${minutes}:${String(secs).padStart(2, "0")}`;
  }

  function cuesFromTextTrack(track) {
    if (!track?.cues?.length) return [];
    return Array.from(track.cues).map(cue => ({
      timestamp: formatTimestamp(cue.startTime),
      startTime: cue.startTime,
      text: cleanText(cue.text)
    })).filter(cue => cue.text);
  }

  function curriculumRoots() {
    const roots = Array.from(document.querySelectorAll(
      '[data-purpose*="curriculum"], [data-purpose*="course-content"], [class*="curriculum"], aside'
    ));
    return roots.filter((root, index) => !roots.some((other, otherIndex) => otherIndex !== index && other.contains(root)));
  }

  async function expandCurriculumSections(settleMs = 120) {
    const roots = curriculumRoots();
    const buttons = Array.from(document.querySelectorAll('button[aria-expanded="false"]'));
    let expanded = 0;
    for (const button of buttons) {
      const purpose = String(button.getAttribute("data-purpose") || "").toLowerCase();
      const label = cleanText(button.getAttribute("aria-label") || button.textContent).toLowerCase();
      const insideCurriculum = roots.some(root => root.contains(button));
      const insideSection = Boolean(button.closest('[data-purpose*="section"], [class*="section"]'));
      const looksLikeSection = /section|chapter|curriculum|chương|phần/i.test(`${purpose} ${label}`);
      if (insideCurriculum && (insideSection || looksLikeSection)) {
        button.click();
        expanded += 1;
        await sleep(60);
      }
    }
    if (expanded) await sleep(settleMs);
    return expanded;
  }

  function sectionInfoFor(node, sectionIndex = null) {
    const section = node.closest('[data-purpose="section-panel"], [data-purpose^="section-panel-"], [data-purpose="curriculum-section"]');
    if (!section) {
      const fallbackIndex = sectionIndex ?? 0;
      return { title: `Section ${fallbackIndex + 1}`, key: `section-${fallbackIndex}` };
    }
    const heading = section.querySelector('[data-purpose="section-heading"], [data-purpose="section-title"], h2, h3, button');
    const title = cleanText(heading?.textContent) || "Untitled section";
    const allSections = Array.from(document.querySelectorAll('[data-purpose="section-panel"], [data-purpose^="section-panel-"], [data-purpose="curriculum-section"]'));
    const index = sectionIndex ?? Math.max(0, allSections.indexOf(section));
    return { title, key: `section-${index}` };
  }

  function lessonTitleFor(node) {
    const container = node.closest('[data-purpose^="curriculum-item"]') || node;
    const titleNode = container.querySelector?.(
      '[data-purpose="item-title"], [data-purpose="curriculum-item-title"], [class*="item-title"], [class*="lecture-title"]'
    );
    const raw = titleNode?.textContent || container.getAttribute("aria-label") || container.getAttribute("title") || container.innerText || container.textContent;
    return cleanText(raw).split(/\s+(?:\d{1,2}:\d{2}|Preview)$/i)[0];
  }

  function curriculumScrollContainers() {
    const candidates = new Set();
    const firstItem = document.querySelector('[data-purpose^="curriculum-item-"]');
    let parent = firstItem?.parentElement;
    while (parent && parent !== document.body) {
      if (parent.scrollHeight > parent.clientHeight + 60) candidates.add(parent);
      parent = parent.parentElement;
    }
    for (const root of curriculumRoots()) {
      if (root.scrollHeight > root.clientHeight + 60) candidates.add(root);
      for (const child of root.querySelectorAll("div")) {
        if (child.scrollHeight > child.clientHeight + 60) candidates.add(child);
      }
    }
    return Array.from(candidates)
      .map(node => {
        const style = getComputedStyle(node);
        const scrollableStyle = /auto|scroll|overlay/i.test(style.overflowY || style.overflow);
        const score = (scrollableStyle ? 1_000_000 : 0) + (node.scrollHeight - node.clientHeight);
        return { node, score };
      })
      .sort((a, b) => b.score - a.score)
      .map(item => item.node);
  }

  function curriculumScrollContainer() {
    return curriculumScrollContainers()[0] || null;
  }

  function collectVisibleLessons(collected) {
    const rowSelector = '[data-purpose^="curriculum-item-"], [data-purpose*="lecture-item"]';
    for (const row of document.querySelectorAll(rowSelector)) {
      const purpose = row.getAttribute("data-purpose") || "";
      const indices = purpose.match(/curriculum-item-(\d+)-(\d+)/);
      const anchor = row.matches("a[href]") ? row : row.querySelector('a[href*="/lecture/"]');
      const url = anchor ? new URL(anchor.href, location.href).href : "";
      const lecture = url.match(/\/lecture\/(\d+)/)?.[1] || "";
      if (!indices && !lecture) continue;

      const sectionIndex = indices ? Number(indices[1]) : 0;
      const itemIndex = indices ? Number(indices[2]) : collected.size;
      const locator = indices ? `curriculum-item-${sectionIndex}-${itemIndex}` : purpose;
      const key = lecture || locator || url;
      if (!key || collected.has(key)) continue;
      const title = lessonTitleFor(row);
      if (!title) continue;
      const section = sectionInfoFor(row, sectionIndex);
      collected.set(key, {
        id: lecture || locator,
        url,
        locator,
        sectionIndex,
        itemIndex,
        title,
        sectionKey: section.key,
        sectionTitle: section.title
      });
    }

    for (const anchor of document.querySelectorAll('a[href*="/learn/lecture/"]')) {
      const url = new URL(anchor.href, location.href).href;
      const lecture = url.match(/\/lecture\/(\d+)/)?.[1];
      if (!lecture || collected.has(lecture)) continue;
      const title = lessonTitleFor(anchor);
      if (!title) continue;
      const section = sectionInfoFor(anchor, 0);
      collected.set(lecture, {
        id: lecture, url, locator: anchor.closest('[data-purpose^="curriculum-item-"]')?.getAttribute("data-purpose") || "",
        sectionIndex: 0, itemIndex: collected.size, title, sectionKey: section.key, sectionTitle: section.title
      });
    }
  }

  async function discoverCourse() {
    await expandCurriculumSections();
    const collected = new Map();
    const scroller = curriculumScrollContainer();
    const originalTop = scroller?.scrollTop || 0;
    collectVisibleLessons(collected);

    if (scroller) {
      scroller.scrollTop = 0;
      await sleep(180);
      let unchanged = 0;
      let previousSize = -1;
      for (let i = 0; i < 180; i += 1) {
        await expandCurriculumSections(80);
        collectVisibleLessons(collected);
        unchanged = collected.size === previousSize ? unchanged + 1 : 0;
        previousSize = collected.size;
        const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4;
        if (atBottom && unchanged >= 3) break;
        scroller.scrollTop = Math.min(scroller.scrollHeight, scroller.scrollTop + Math.max(220, scroller.clientHeight * 0.8));
        await sleep(100);
      }
      scroller.scrollTop = originalTop;
    }

    const lessons = Array.from(collected.values())
      .sort((a, b) => a.sectionIndex - b.sectionIndex || a.itemIndex - b.itemIndex)
      .map((lesson, order) => ({ ...lesson, order }));

    const sections = [];
    const sectionMap = new Map();
    for (const lesson of lessons) {
      if (!sectionMap.has(lesson.sectionKey)) {
        const section = { key: lesson.sectionKey, title: lesson.sectionTitle, count: 0 };
        sectionMap.set(lesson.sectionKey, section);
        sections.push(section);
      }
      sectionMap.get(lesson.sectionKey).count += 1;
    }
    return {
      ok: lessons.length > 0,
      courseTitle: findCourseTitle(), courseKey: getCourseIdentity().courseKey, lessons, sections,
      error: lessons.length ? "" : "No lesson items were found. Keep the course-content sidebar open and try Refresh again."
    };
  }

  async function findLessonElement(lesson) {
    const selector = lesson.locator ? `[data-purpose="${lesson.locator}"]` : "";
    const normalizedTitle = cleanText(lesson.title).toLocaleLowerCase();
    const findVisible = () => {
      const exact = selector ? document.querySelector(selector) : null;
      if (exact) return exact;
      if (!normalizedTitle) return null;
      return Array.from(document.querySelectorAll('[data-purpose^="curriculum-item-"], [data-purpose*="lecture-item"]'))
        .find(candidate => cleanText(lessonTitleFor(candidate)).toLocaleLowerCase() === normalizedTitle) || null;
    };

    let row = findVisible();
    if (row) return row;

    // Udemy often collapses or re-virtualizes the sidebar after a lesson opens.
    // Expand newly rendered section headers while walking every plausible
    // scroll container; this is especially important from section 2 onward.
    await expandCurriculumSections(180);
    row = findVisible();
    if (row) return row;

    const scrollers = curriculumScrollContainers().slice(0, 3);
    for (const scroller of scrollers) {
      scroller.scrollTop = 0;
      await sleep(140);
      let bottomRounds = 0;
      for (let i = 0; i < 220; i += 1) {
        await expandCurriculumSections(70);
        row = findVisible();
        if (row) return row;

        const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4;
        bottomRounds = atBottom ? bottomRounds + 1 : 0;
        if (bottomRounds >= 3) break;
        const step = Math.max(180, Math.floor(scroller.clientHeight * 0.65));
        scroller.scrollTop = Math.min(scroller.scrollHeight, scroller.scrollTop + step);
        await sleep(90);
      }
    }
    return null;
  }

  async function openCourseLesson(lesson) {
    const row = await findLessonElement(lesson);
    if (!row) return { ok: false, error: `Could not find lesson: ${lesson.title}` };
    const target = row.matches('a, button, [role="button"]')
      ? row
      : row.querySelector('a[href*="/lecture/"], button, [role="button"]') || row;
    const previousUrl = location.href;
    const previousTitle = currentLessonTitle("");
    row.scrollIntoView({ block: "center" });
    target.click();
    const started = Date.now();
    while (Date.now() - started < 12000) {
      const titleChanged = currentLessonTitle("") !== previousTitle;
      if (location.href !== previousUrl || titleChanged) break;
      await sleep(200);
    }
    await sleep(1400);
    const active = row.matches('[aria-current="true"], [data-current="true"]') || row.querySelector('[aria-current="true"], [data-current="true"]');
    const titleMatches = cleanText(currentLessonTitle("")).toLowerCase().includes(cleanText(lesson.title).toLowerCase());
    if (location.href === previousUrl && !active && !titleMatches) {
      return { ok: false, error: `Udemy did not open lesson: ${lesson.title}` };
    }
    return { ok: true, url: location.href };
  }

  async function waitForTranscriptPanel(timeoutMs = 18000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const panel = document.querySelector('[data-purpose="transcript-panel"]');
      if (panel) return panel;
      await sleep(250);
    }
    return null;
  }

  async function openTranscriptPanel() {
    let panel = document.querySelector('[data-purpose="transcript-panel"]');
    if (panel) return panel;
    const selectors = [
      '[data-purpose="transcript-toggle"]', '[data-purpose="show-transcript"]',
      'button[aria-label*="transcript" i]', 'button[data-purpose*="transcript" i]'
    ];
    let button = null;
    for (const selector of selectors) {
      button = document.querySelector(selector);
      if (button) break;
    }
    if (!button) {
      button = Array.from(document.querySelectorAll("button")).find(candidate =>
        /transcript|bản chép lời|bản ghi/i.test(cleanText(candidate.textContent))
      );
    }
    if (!button) return null;
    button.click();
    panel = await waitForTranscriptPanel();
    return panel;
  }

  function findScrollContainer(panel) {
    const nodes = [panel, ...panel.querySelectorAll("div")];
    return nodes.find(node => node.scrollHeight > node.clientHeight + 40) || panel;
  }

  async function collectFullTranscript(panel) {
    const container = findScrollContainer(panel);
    const originalTop = container.scrollTop;
    const collected = [];
    const seen = new Set();
    let stableRounds = 0;
    container.scrollTop = 0;
    await sleep(200);

    for (let i = 0; i < 160; i += 1) {
      for (const entry of extractCueEntries(panel)) {
        if (!seen.has(entry.key)) {
          seen.add(entry.key);
          collected.push({ timestamp: entry.timestamp || "", text: entry.text });
        }
      }
      const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 4;
      stableRounds = atBottom ? stableRounds + 1 : 0;
      if (stableRounds >= 3) break;
      const nextTop = Math.min(container.scrollHeight, container.scrollTop + Math.max(240, Math.floor(container.clientHeight * 0.75)));
      if (nextTop === container.scrollTop) stableRounds += 1;
      container.scrollTop = nextTop;
      await sleep(160);
    }
    container.scrollTop = originalTop;
    return collected;
  }

  function currentLessonTitle(fallback) {
    for (const selector of ['[data-purpose="course-content-title"]', '[data-purpose="lecture-title"]', '[data-purpose="current-lecture-title"]']) {
      const text = cleanText(document.querySelector(selector)?.textContent);
      if (text) return text;
    }
    return fallback || "Untitled lesson";
  }

  async function captureCourseLesson(lesson, language = "auto") {
    await sleep(1200);
    const panel = await openTranscriptPanel();
    if (!panel) {
      return { ok: true, available: false, title: currentLessonTitle(lesson?.title), count: 0, text: "", cues: [], error: "Transcript is not available for this lesson." };
    }
    const selectedTrack = await selectTranscriptLanguage(language);
    let cues = cuesFromTextTrack(selectedTrack);
    if (!cues.length) cues = await collectFullTranscript(panel);
    return {
      ok: true, available: cues.length > 0, title: currentLessonTitle(lesson?.title), count: cues.length,
      text: cues.map(cue => cue.text).join("\n"), cues, language: selectedTrack?.language || language,
      error: cues.length ? "" : "Transcript panel was empty."
    };
  }

  function getDiagnostics() {
    const purposeCounts = {};
    for (const node of document.querySelectorAll("[data-purpose]")) {
      const purpose = node.getAttribute("data-purpose");
      purposeCounts[purpose] = (purposeCounts[purpose] || 0) + 1;
    }
    const selectors = {
      transcriptPanel: document.querySelectorAll('[data-purpose="transcript-panel"]').length,
      cueText: document.querySelectorAll('[data-purpose="cue-text"]').length,
      transcriptCue: document.querySelectorAll('[data-purpose="transcript-cue"]').length,
      curriculumItems: document.querySelectorAll('[data-purpose^="curriculum-item-"]').length,
      sectionPanels: document.querySelectorAll('[data-purpose="section-panel"], [data-purpose^="section-panel-"]').length,
      lectureLinks: document.querySelectorAll('a[href*="/learn/lecture/"]').length,
      collapsedSections: document.querySelectorAll('button[aria-expanded="false"]').length,
      curriculumScrollers: curriculumScrollContainers().length,
      videos: document.querySelectorAll("video").length
    };
    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      url: location.href,
      title: document.title,
      identity: getCourseIdentity(),
      selectors,
      languages: availableTranscriptLanguages(),
      topDataPurpose: Object.entries(purposeCounts).sort((a, b) => b[1] - a[1]).slice(0, 80)
    };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    try {
      if (message?.type === "GET_UDEMY_TRANSCRIPT") {
        sendResponse(extractTranscript());
        return true;
      }
      if (message?.type === "COPY_UDEMY_TRANSCRIPT") {
        copyTranscript().then(result => sendResponse({ ok: true, count: result.count })).catch(error => {
          showToast(error?.message || "Unable to copy transcript.", true);
          sendResponse({ ok: false, error: error?.message });
        });
        return true;
      }
      if (message?.type === "CHANGE_PLAYBACK_SPEED") {
        const rate = changePlaybackSpeed(message.action, message.value);
        sendResponse({ ok: true, rate });
        return true;
      }
      if (message?.type === "GET_COURSE_OUTLINE") {
        discoverCourse().then(sendResponse).catch(error => sendResponse({ ok: false, error: error.message }));
        return true;
      }
      if (message?.type === "GET_COURSE_IDENTITY") {
        sendResponse(getCourseIdentity());
        return true;
      }
      if (message?.type === "GET_TRANSCRIPT_LANGUAGES") {
        openTranscriptPanel()
          .then(() => sendResponse({ ok: true, languages: availableTranscriptLanguages() }))
          .catch(error => sendResponse({ ok: false, languages: [], error: error.message }));
        return true;
      }
      if (message?.type === "GET_DIAGNOSTICS") {
        sendResponse(getDiagnostics());
        return true;
      }
      if (message?.type === "CAPTURE_COURSE_LESSON") {
        captureCourseLesson(message.lesson, message.language).then(sendResponse).catch(error => sendResponse({ ok: false, error: error.message }));
        return true;
      }
      if (message?.type === "OPEN_COURSE_LESSON") {
        openCourseLesson(message.lesson).then(sendResponse).catch(error => sendResponse({ ok: false, error: error.message }));
        return true;
      }
      if (message?.type === "SHOW_EXPORT_TOAST") {
        showToast(message.message || "Course export complete");
        sendResponse({ ok: true });
        return true;
      }
    } catch (error) {
      showToast(error?.message || "Something went wrong.", true);
      sendResponse({ ok: false, error: error?.message || "Unable to complete the action." });
      return true;
    }
  });

  setTimeout(() => {
    chrome.runtime.sendMessage({ type: "COURSE_EXPORT_PAGE_READY" }).catch(() => {});
  }, 900);
})();
