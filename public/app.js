const form = document.querySelector("#capture-form");
const submitButton = form.querySelector("button[type='submit']");
const errorBox = document.querySelector("#form-error");
const progressPanel = document.querySelector("#progress-panel");
const progressTitle = document.querySelector("#progress-title");
const visualStatus = document.querySelector("#visual-status-text");
const meterBar = document.querySelector("#meter-bar");
const meterLabel = document.querySelector("#meter-label");
const meterPercent = document.querySelector("#meter-percent");
const scannedCount = document.querySelector("#scanned-count");
const capturedCount = document.querySelector("#captured-count");
const screenshotCount = document.querySelector("#screenshot-count");
const duplicateCount = document.querySelector("#duplicate-count");
const currentUrl = document.querySelector("#current-url");
const capturedList = document.querySelector("#captured-list");
const recentPages = document.querySelector("#recent-pages");
const cancelButton = document.querySelector("#cancel-button");
const downloadButton = document.querySelector("#download-button");
const flowSteps = [...document.querySelectorAll(".flow-step")];
const flowLines = [...document.querySelectorAll(".flow-line")];
const previewButtons = [...document.querySelectorAll("[data-preview-device]")];
const deviceScenes = [...document.querySelectorAll("[data-device-scene]")];
const loaderSlots = [...document.querySelectorAll("#loader-slots i")];
const loaderCounter = document.querySelector("#loader-counter");
const elapsedTime = document.querySelector("#elapsed-time");

let activeJobId = null;
let events = null;
let previewTimer = null;
let elapsedTimer = null;
let previewIndex = 0;
let captureStartedAt = 0;
const previewOrder = ["desktop", "tablet", "mobile"];

function formValues() {
  const data = new FormData(form);
  return {
    url: data.get("url"),
    maxPages: 5,
    concurrency: Number(data.get("concurrency")),
    viewport: data.get("viewport"),
    timeoutSeconds: Number(data.get("timeoutSeconds")),
    includeSubdomains: data.has("includeSubdomains"),
    autoScroll: data.has("autoScroll")
  };
}

function selectPreview(device) {
  previewButtons.forEach((button) => button.classList.toggle("active", button.dataset.previewDevice === device));
  deviceScenes.forEach((scene) => scene.classList.toggle("active", scene.dataset.deviceScene === device));
  previewIndex = Math.max(0, previewOrder.indexOf(device));
}

function updateElapsed() {
  const elapsed = Math.max(0, Math.floor((Date.now() - captureStartedAt) / 1000));
  const minutes = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const seconds = String(elapsed % 60).padStart(2, "0");
  elapsedTime.textContent = `${minutes}:${seconds}`;
}

function startLoaderMotion() {
  clearInterval(previewTimer);
  clearInterval(elapsedTimer);
  captureStartedAt = Date.now();
  previewIndex = 0;
  selectPreview(previewOrder[previewIndex]);
  updateElapsed();
  previewTimer = setInterval(() => {
    previewIndex = (previewIndex + 1) % previewOrder.length;
    selectPreview(previewOrder[previewIndex]);
  }, 2400);
  elapsedTimer = setInterval(updateElapsed, 1000);
}

function stopLoaderMotion() {
  clearInterval(previewTimer);
  clearInterval(elapsedTimer);
  previewTimer = null;
  elapsedTimer = null;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function stageIndex(stage) {
  if (stage === "packaging") return 3;
  if (stage === "complete") return 4;
  if (stage === "capturing") return 2;
  if (stage === "discovering") return 1;
  return 0;
}

function updateStages(stage) {
  const current = stageIndex(stage);
  flowSteps.forEach((step, index) => {
    step.classList.toggle("done", index < current || current === 4);
    step.classList.toggle("active", index === current && current < 4);
  });
  flowLines.forEach((line, index) => line.classList.toggle("done", index < current || current === 4));
}

function renderCaptured(items) {
  if (!items?.length) {
    capturedList.innerHTML = "";
    return;
  }
  capturedList.innerHTML = items.map((item, index) => {
    const devices = Object.keys(item.files || {});
    const deviceInitial = { desktop: "D", tablet: "T", mobile: "M" };
    return `
      <div class="captured-item">
        <span>${String(index + 1).padStart(2, "0")}</span>
        <p><small>${escapeHtml(item.pageTypeLabel || item.pageType)}</small><strong title="${escapeHtml(item.title || item.url)}">${escapeHtml(item.title || item.url)}</strong></p>
        <div class="device-tags">${devices.map((device) => `<b title="${device}">${deviceInitial[device] || "?"}</b>`).join("")}</div>
      </div>`;
  }).join("");
}

function renderRecent(items) {
  recentPages.innerHTML = (items || []).slice().reverse().map((item) => {
    const state = item.skipped ? "skip" : item.error ? "fail" : "ok";
    const icon = item.skipped ? "−" : item.error ? "×" : "✓";
    return `<div class="scan-item"><span class="${state}">${icon}</span><span title="${escapeHtml(item.url)}">${escapeHtml(item.url)}</span></div>`;
  }).join("");
}

function render(data) {
  const scanned = data.scanned || 0;
  const captured = data.completed || 0;
  const total = 5;
  let percent = Math.round((captured / total) * 88);
  if (data.stage === "packaging") percent = 96;
  if (data.status === "complete") percent = 100;
  percent = Math.max(data.status === "queued" ? 2 : 5, Math.min(100, percent));

  progressPanel.dataset.state = ["complete", "error", "cancelled"].includes(data.status) ? data.status : "running";
  progressTitle.textContent = data.message || "Inspecting the website…";
  visualStatus.textContent = data.status === "complete" ? "Representative set complete" : data.stage === "packaging" ? "Building download folder" : "Scanning and comparing layouts";
  meterBar.style.width = `${percent}%`;
  meterPercent.textContent = `${percent}%`;
  meterLabel.textContent = data.status === "complete" ? "Ready to download" : `${captured} / 5 representative pages · ${scanned} URLs inspected`;
  scannedCount.textContent = scanned;
  capturedCount.textContent = data.completed || 0;
  screenshotCount.textContent = data.screenshotCount || 0;
  duplicateCount.textContent = data.duplicateCount || 0;
  loaderCounter.textContent = `${Math.min(captured, 5)} / 5`;
  loaderSlots.forEach((slot, index) => {
    slot.classList.toggle("done", index < captured);
    slot.classList.toggle("active", index === captured && captured < 5 && data.status !== "complete");
  });
  currentUrl.textContent = data.currentUrl || (data.status === "complete" ? "All representative pages are ready" : "Waiting for the next page…");
  updateStages(data.stage);
  renderCaptured(data.capturedTypes);
  const counts = {desktop: 0, tablet: 0, mobile: 0};
  let missing = 0;
  for (const item of data.capturedTypes || []) {
    for (const device of Object.keys(item.files || {})) counts[device]++;
    missing += Object.keys(item.deviceErrors || {}).length;
  }
  document.querySelector("#export-summary").textContent = "ZIP folders: Desktop " + counts.desktop + " · Tablet " + counts.tablet + " · Mobile " + counts.mobile + (missing ? " — " + missing + " device captures failed; see report.json." : "") + (data.status === "complete" && captured < 5 ? " — Fewer than five page types were found within the 30-URL discovery limit." : "");
  renderRecent(data.results);

  if (data.status === "complete") {
    stopLoaderMotion();
    events?.close();
    submitButton.disabled = false;
    submitButton.querySelector("span").textContent = "Start another capture";
    cancelButton.hidden = true;
    downloadButton.hidden = false;
    downloadButton.href = `/api/jobs/${data.id}/download`;
    downloadButton.querySelector("span").textContent = `Download ${data.screenshotCount || 0} screenshots (.zip)`;
    downloadButton.focus({ preventScroll: true });
  } else if (data.status === "error" || data.status === "cancelled") {
    stopLoaderMotion();
    events?.close();
    submitButton.disabled = false;
    submitButton.querySelector("span").textContent = "Try another capture";
    cancelButton.hidden = true;
    errorBox.textContent = data.message;
  }
}

async function beginCapture() {
  errorBox.textContent = "";
  downloadButton.hidden = true;
  cancelButton.hidden = false;
  cancelButton.disabled = false;
  submitButton.disabled = true;
  submitButton.querySelector("span").textContent = "Capture in progress…";
  capturedList.innerHTML = "";
  recentPages.innerHTML = "";
  loaderCounter.textContent = "0 / 5";
  loaderSlots.forEach((slot, index) => {
    slot.classList.remove("done");
    slot.classList.toggle("active", index === 0);
  });

  const response = await fetch("/api/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(formValues())
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Could not start the capture.");

  activeJobId = result.id;
  progressPanel.hidden = false;
  startLoaderMotion();
  progressPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  events?.close();
  events = new EventSource(`/api/jobs/${activeJobId}/events`);
  events.onmessage = (event) => render(JSON.parse(event.data));
  events.onerror = () => {
    if (!downloadButton.hidden) return;
    errorBox.textContent = "The progress connection was interrupted. The capture may still be running.";
  };
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await beginCapture();
  } catch (error) {
    stopLoaderMotion();
    errorBox.textContent = error.message;
    submitButton.disabled = false;
    submitButton.querySelector("span").textContent = "Start representative capture";
  }
});

previewButtons.forEach((button) => {
  button.addEventListener("click", () => {
    selectPreview(button.dataset.previewDevice);
    if (!previewTimer) return;
    clearInterval(previewTimer);
    previewTimer = setInterval(() => {
      previewIndex = (previewIndex + 1) % previewOrder.length;
      selectPreview(previewOrder[previewIndex]);
    }, 2400);
  });
});

cancelButton.addEventListener("click", async () => {
  if (!activeJobId) return;
  cancelButton.disabled = true;
  await fetch(`/api/jobs/${activeJobId}/cancel`, { method: "POST" }).catch(() => {});
});

document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !submitButton.disabled) form.requestSubmit();
});
