(() => {
  const encoder = new TextEncoder();

  function slugify(value) {
    return String(value || "untitled")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d").replace(/Đ/g, "D")
      .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "")
      .toLowerCase() || "untitled";
  }

  function removeFillers(text) {
    return String(text || "")
      .replace(/\b(?:um+|uh+|erm+|hmm+|you know)\b[,.]?/gi, " ")
      .replace(/(^|[\s,.;!?])(?:ừm+|ờm+)(?=$|[\s,.;!?])/giu, "$1")
      .replace(/\s+([,.;!?])/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
  }

  function cueList(lesson, normalizeText) {
    const cues = Array.isArray(lesson.cues) && lesson.cues.length
      ? lesson.cues
      : String(lesson.transcript || "").split(/\n+/).filter(Boolean).map(text => ({ timestamp: "", text }));
    return cues.map(cue => ({
      timestamp: cue.timestamp || "",
      text: normalizeText ? removeFillers(cue.text) : String(cue.text || "").trim()
    })).filter(cue => cue.text);
  }

  function mergeSentences(cues) {
    const paragraphs = [];
    let buffer = "";
    for (const cue of cues) {
      buffer = `${buffer} ${cue.text}`.trim();
      if (/[.!?…]["')\]]?$/.test(buffer) || buffer.length >= 500) {
        paragraphs.push(buffer);
        buffer = "";
      }
    }
    if (buffer) paragraphs.push(buffer);
    return paragraphs;
  }

  function transcriptBody(lesson, options) {
    const cues = cueList(lesson, options.normalizeText);
    if (!cues.length) return `[${lesson.error || "Transcript unavailable."}]`;
    if (options.includeTimestamps) {
      return cues.map(cue => `${cue.timestamp ? `[${cue.timestamp}] ` : ""}${cue.text}`).join("\n");
    }
    return options.normalizeText ? mergeSentences(cues).join("\n\n") : cues.map(cue => cue.text).join("\n");
  }

  function lessonPayload(lesson, options) {
    return {
      title: lesson.title,
      section: lesson.sectionTitle,
      source: lesson.url,
      language: lesson.language || "auto",
      available: Boolean(lesson.available),
      error: lesson.error || "",
      transcript: transcriptBody(lesson, options),
      cues: options.includeTimestamps ? cueList(lesson, options.normalizeText) : undefined
    };
  }

  function lessonDocument(lesson, format, options) {
    const body = transcriptBody(lesson, options);
    if (format === "json") return JSON.stringify(lessonPayload(lesson, options), null, 2);
    if (format === "markdown") return `# ${lesson.title}\n\n**Section:** ${lesson.sectionTitle}\n\n**Source:** ${lesson.url || "Unavailable"}\n\n${body}\n`;
    return `${lesson.title}\nSection: ${lesson.sectionTitle}\nSource: ${lesson.url || "Unavailable"}\n\n${body}\n`;
  }

  function sectionDocument(sectionTitle, lessons, format, options) {
    if (format === "json") return JSON.stringify({ section: sectionTitle, lessons: lessons.map(item => lessonPayload(item, options)) }, null, 2);
    const lines = [format === "markdown" ? `# ${sectionTitle}` : `=== ${sectionTitle} ===`, ""];
    for (const lesson of lessons) {
      lines.push(format === "markdown" ? `## ${lesson.title}` : lesson.title, "");
      if (format === "markdown") lines.push(`Source: ${lesson.url || "Unavailable"}`, "");
      lines.push(transcriptBody(lesson, options), "");
    }
    return lines.join("\n");
  }

  function singleDocument(state, lessons, format, options) {
    if (format === "json") {
      return JSON.stringify({
        courseTitle: state.courseTitle,
        scope: state.scopeLabel,
        exportedAt: new Date().toISOString(),
        lessons: lessons.map(item => lessonPayload(item, options))
      }, null, 2);
    }

    const lines = [format === "markdown" ? `# ${state.courseTitle}` : state.courseTitle, ""];
    if (format === "markdown" && options.includeToc) {
      lines.push("## Table of contents", "");
      let lastSection = null;
      for (const lesson of lessons) {
        if (lesson.sectionTitle !== lastSection) {
          lastSection = lesson.sectionTitle;
          lines.push(`- [${lastSection}](#${slugify(lastSection)})`);
        }
        lines.push(`  - [${lesson.title}](#${slugify(lesson.title)})`);
      }
      lines.push("");
    }

    let lastSection = null;
    for (const lesson of lessons) {
      if (lesson.sectionTitle !== lastSection) {
        lastSection = lesson.sectionTitle;
        if (format === "markdown") lines.push(`<a id="${slugify(lastSection)}"></a>`, `## ${lastSection}`, "");
        else lines.push(`=== ${lastSection} ===`, "");
      }
      if (format === "markdown") lines.push(`<a id="${slugify(lesson.title)}"></a>`, `### ${lesson.title}`, "");
      else lines.push(lesson.title, "");
      if (format === "markdown") lines.push(`Source: ${lesson.url || "Unavailable"}`, "");
      lines.push(transcriptBody(lesson, options), "");
    }
    return lines.join("\n");
  }

  function extensionFor(format) {
    return format === "markdown" ? "md" : format === "json" ? "json" : "txt";
  }

  function mimeFor(format) {
    return format === "markdown" ? "text/markdown;charset=utf-8" : format === "json" ? "application/json;charset=utf-8" : "text/plain;charset=utf-8";
  }

  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function header(size) {
    const bytes = new Uint8Array(size);
    return { bytes, view: new DataView(bytes.buffer) };
  }

  function dosDateTime(date = new Date()) {
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    const day = Math.max(1, date.getDate());
    const value = ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | day;
    return { time, date: value };
  }

  function createZip(files) {
    const chunks = [];
    const central = [];
    let offset = 0;
    const stamp = dosDateTime();

    for (const file of files) {
      const name = encoder.encode(file.name);
      const data = encoder.encode(file.content);
      const crc = crc32(data);
      const local = header(30);
      local.view.setUint32(0, 0x04034b50, true);
      local.view.setUint16(4, 20, true);
      local.view.setUint16(6, 0x0800, true);
      local.view.setUint16(8, 0, true);
      local.view.setUint16(10, stamp.time, true);
      local.view.setUint16(12, stamp.date, true);
      local.view.setUint32(14, crc, true);
      local.view.setUint32(18, data.length, true);
      local.view.setUint32(22, data.length, true);
      local.view.setUint16(26, name.length, true);
      chunks.push(local.bytes, name, data);

      const entry = header(46);
      entry.view.setUint32(0, 0x02014b50, true);
      entry.view.setUint16(4, 20, true);
      entry.view.setUint16(6, 20, true);
      entry.view.setUint16(8, 0x0800, true);
      entry.view.setUint16(10, 0, true);
      entry.view.setUint16(12, stamp.time, true);
      entry.view.setUint16(14, stamp.date, true);
      entry.view.setUint32(16, crc, true);
      entry.view.setUint32(20, data.length, true);
      entry.view.setUint32(24, data.length, true);
      entry.view.setUint16(28, name.length, true);
      entry.view.setUint32(42, offset, true);
      central.push(entry.bytes, name);
      offset += local.bytes.length + name.length + data.length;
    }

    const centralSize = central.reduce((sum, item) => sum + item.length, 0);
    const end = header(22);
    end.view.setUint32(0, 0x06054b50, true);
    end.view.setUint16(8, files.length, true);
    end.view.setUint16(10, files.length, true);
    end.view.setUint32(12, centralSize, true);
    end.view.setUint32(16, offset, true);
    return new Blob([...chunks, ...central, end.bytes], { type: "application/zip" });
  }

  function uniqueName(base, used) {
    let name = base;
    let number = 2;
    while (used.has(name)) name = `${base}-${number++}`;
    used.add(name);
    return name;
  }

  function buildExport(state, options) {
    const lessons = state.lessons.map((lesson, index) => state.results[index] || {
      ...lesson, transcript: "", cues: [], available: false, error: "Not processed yet."
    });
    const extension = extensionFor(options.format);
    const courseSlug = slugify(state.courseTitle);

    if (options.layout === "single") {
      const content = singleDocument(state, lessons, options.format, options);
      return { filename: `${courseSlug}-transcripts.${extension}`, blob: new Blob([content], { type: mimeFor(options.format) }) };
    }

    const files = [];
    const used = new Set();
    if (options.layout === "section-zip") {
      const groups = new Map();
      for (const lesson of lessons) {
        if (!groups.has(lesson.sectionKey)) groups.set(lesson.sectionKey, { title: lesson.sectionTitle, lessons: [] });
        groups.get(lesson.sectionKey).lessons.push(lesson);
      }
      for (const group of groups.values()) {
        const base = uniqueName(slugify(group.title), used);
        files.push({ name: `${base}.${extension}`, content: sectionDocument(group.title, group.lessons, options.format, options) });
      }
    } else {
      const usedByFolder = new Map();
      for (const lesson of lessons) {
        const sectionFolder = slugify(lesson.sectionTitle);
        if (!usedByFolder.has(sectionFolder)) usedByFolder.set(sectionFolder, new Set());
        // Udemy lesson titles commonly include their own sequence number.
        // Preserve that title instead of adding a second artificial prefix.
        const base = uniqueName(slugify(lesson.title), usedByFolder.get(sectionFolder));
        files.push({ name: `${sectionFolder}/${base}.${extension}`, content: lessonDocument(lesson, options.format, options) });
      }
    }
    return { filename: `${courseSlug}-transcripts.zip`, blob: createZip(files) };
  }

  window.ExportUtils = { buildExport, slugify, transcriptBody, createZip };
})();
