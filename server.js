import http from "node:http";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const port = Number(process.env.PORT || 4173);
const jobs = new Map();
const MAX_BODY_SIZE = 32_768;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml"
};

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > MAX_BODY_SIZE) throw new Error("Request is too large.");
  }
  return JSON.parse(body || "{}");
}

function normalizeStartUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) throw new Error("Enter a website URL.");
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const url = new URL(candidate);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only HTTP and HTTPS websites are supported.");
  url.hash = "";
  return url.toString();
}

function canonicalize(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid"].forEach((key) => url.searchParams.delete(key));
    url.searchParams.sort();
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return null;
  }
}

function safeFileName(urlValue, index) {
  const url = new URL(urlValue);
  const raw = url.pathname === "/" ? "home" : url.pathname.replace(/^\/|\/$/g, "").replace(/\//g, "--");
  let decoded = raw;
  try { decoded = decodeURIComponent(raw); } catch { /* Keep the encoded path. */ }
  const slug = decoded
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 110) || "page";
  const queryHash = url.search ? `-${crypto.createHash("sha1").update(url.search).digest("hex").slice(0, 7)}` : "";
  return `${String(index).padStart(3, "0")}-${slug}${queryHash}.png`;
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function emit(job) {
  job.updatedAt = Date.now();
  const payload = `data: ${JSON.stringify({
    id: job.id,
    status: job.status,
    total: job.total,
    completed: job.completed,
    failed: job.failed,
    scanned: job.scanned,
    duplicateCount: job.duplicateCount,
    screenshotCount: job.screenshotCount,
    stage: job.stage,
    currentUrl: job.currentUrl,
    message: job.message,
    results: job.results.slice(-12),
    capturedTypes: job.capturedTypes
  })}\n\n`;
  for (const client of job.clients) client.write(payload);
}

function shouldInclude(url, root, includeSubdomains) {
  if (url.origin === root.origin) return true;
  return includeSubdomains && url.hostname.endsWith(`.${root.hostname}`);
}

function matchesFilters(url, includePattern, excludePattern) {
  const pathname = `${url.pathname}${url.search}`;
  if (includePattern && !pathname.toLowerCase().includes(includePattern.toLowerCase())) return false;
  if (excludePattern && pathname.toLowerCase().includes(excludePattern.toLowerCase())) return false;
  return !/\.(?:pdf|jpe?g|png|gif|webp|avif|svg|ico|zip|rar|7z|mp4|webm|mp3|wav|css|js|xml|json|txt)(?:$|\?)/i.test(pathname);
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let distance = 0;
      const step = Math.max(500, Math.floor(window.innerHeight * 0.8));
      const timer = setInterval(() => {
        window.scrollBy(0, step);
        distance += step;
        if (distance >= document.documentElement.scrollHeight || distance > 60_000) {
          clearInterval(timer);
          window.scrollTo(0, 0);
          resolve();
        }
      }, 80);
    });
  });
}

const DEVICE_PROFILES = {
  desktop: {
    viewport: { width: 1440, height: 1000 },
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130 Safari/537.36 SiteSnapshotter/2.0"
  },
  tablet: {
    viewport: { width: 834, height: 1112 },
    userAgent: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1 SiteSnapshotter/2.0",
    isMobile: true,
    hasTouch: true
  },
  mobile: {
    viewport: { width: 390, height: 844 },
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1 SiteSnapshotter/2.0",
    isMobile: true,
    hasTouch: true
  }
};

const TYPE_LABELS = {
  home: "Homepage",
  category: "Category / archive",
  "blog-index": "Blog listing",
  "single-post": "Single blog post",
  about: "About page",
  contact: "Contact page",
  legal: "Privacy / legal",
  faq: "FAQ page",
  pricing: "Pricing page",
  services: "Services page",
  portfolio: "Portfolio / gallery",
  shop: "Shop listing",
  product: "Single product",
  "standard-page": "General page"
};

function selectedDevices(viewport) {
  if (viewport === "all") return ["desktop", "tablet", "mobile"];
  if (viewport === "both") return ["desktop", "mobile"];
  return [viewport];
}

async function openDevicePage(browser, url, device, options) {
  const profile = DEVICE_PROFILES[device];
  const context = await browser.newContext({ ...profile, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.setDefaultTimeout(options.timeoutMs);
  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: options.timeoutMs });
    if (!response) throw new Error("No response received");
    if (response.status() >= 400) throw new Error(`HTTP ${response.status()}`);
    await page.waitForLoadState("networkidle", { timeout: Math.min(6000, options.timeoutMs) }).catch(() => {});
    return { context, page, status: response.status() };
  } catch (error) {
    await context.close().catch(() => {});
    throw error;
  }
}

async function inspectLoadedPage(page) {
  return page.evaluate(() => {
    const classes = document.body?.classList || [];
    const pathname = location.pathname.toLowerCase().replace(/\/+$/, "") || "/";
    const segments = pathname.split("/").filter(Boolean);
    const first = segments[0] || "";
    const hasClass = (...names) => names.some((name) => classes.contains(name));
    const containsPath = (...parts) => parts.some((part) => segments.includes(part));
    const bodyMarksListing = hasClass("home", "blog", "archive", "category", "tag", "search", "post-type-archive");
    const bodyMarksSinglePost = hasClass("single-post", "single-article") ||
      (hasClass("single") && Boolean(document.querySelector("article")));
    const hasPublishedTime = Boolean(
      document.querySelector("meta[property='article:published_time'], article time[datetime], .entry-date, .post-date, .published")
    );
    const hasArticleSchema = [...document.querySelectorAll("script[type='application/ld+json']")]
      .some((script) => /\"@type\"\s*:\s*\"(?:BlogPosting|NewsArticle|Article)\"/i.test(script.textContent || ""));
    const isSinglePost = bodyMarksSinglePost || (!bodyMarksListing && hasPublishedTime && hasArticleSchema);
    const isProduct = hasClass("single-product") || Boolean(document.querySelector("[itemtype*='Product'], .product_title"));

    let pageType = "standard-page";
    if (pathname === "/") pageType = "home";
    else if (isSinglePost) pageType = "single-post";
    else if (isProduct) pageType = "product";
    else if (hasClass("category", "tag", "archive", "author", "date") || ["category", "tag", "author"].includes(first)) pageType = "category";
    else if (hasClass("blog") || ["blog", "blogs", "news", "articles"].includes(first)) pageType = "blog-index";
    else if (containsPath("about", "about-us", "our-story", "team")) pageType = "about";
    else if (containsPath("contact", "contact-us", "get-in-touch")) pageType = "contact";
    else if (containsPath("privacy", "privacy-policy", "terms", "terms-of-service", "cookie-policy", "disclaimer")) pageType = "legal";
    else if (containsPath("faq", "faqs", "help")) pageType = "faq";
    else if (containsPath("pricing", "plans")) pageType = "pricing";
    else if (containsPath("services", "service")) pageType = "services";
    else if (containsPath("portfolio", "gallery", "projects", "work")) pageType = "portfolio";
    else if (containsPath("shop", "store", "products")) pageType = "shop";

    const links = [...document.querySelectorAll("a[href]")].map((anchor) => {
      let hrefPath = "";
      try { hrefPath = new URL(anchor.href).pathname.toLowerCase(); } catch { /* Invalid links are filtered by the server. */ }
      const isUsefulPage = /\/(?:category|blog|blogs|news|about|contact|privacy|terms|services?|shop|products?)(?:\/|$)/.test(hrefPath);
      const locationPriority = anchor.closest("header, nav, footer") ? 0 : anchor.closest("main") ? 1 : 2;
      return {
        href: anchor.href,
        priority: locationPriority * 10 + (isUsefulPage ? 0 : 5),
        likelyArticle: Boolean(
          anchor.closest("article, .post, .blog-post, .entry, [class*='post-card'], [class*='blog-card']") ||
          anchor.getAttribute("rel")?.split(/\s+/).includes("bookmark")
        )
      };
    });

    return { title: document.title || "", pageType, links };
  });
}

async function captureRepresentative(browser, url, outputPaths, options, claimType, releaseType) {
  const startedAt = Date.now();
  const devices = selectedDevices(options.viewport);
  const files = {};
  const deviceErrors = {};
  let metadata = { title: "", pageType: "standard-page", links: [] };
  let status = 0;
  let claimed = false;
  let primarySession = null;

  try {
    primarySession = await openDevicePage(browser, url, devices[0], options);
    status = primarySession.status;
    metadata = await inspectLoadedPage(primarySession.page);

    if (!claimType(metadata.pageType)) {
      return {
        ok: true,
        skipped: true,
        skipReason: `Another ${TYPE_LABELS[metadata.pageType] || "page type"} is already represented`,
        status,
        ...metadata,
        durationMs: Date.now() - startedAt
      };
    }
    claimed = true;

    if (options.autoScroll) await autoScroll(primarySession.page).catch(() => {});
    await primarySession.page.waitForTimeout(options.delayMs);
    await primarySession.page.screenshot({ path: outputPaths[devices[0]].absolute, fullPage: true, animations: "disabled" });
    files[devices[0]] = outputPaths[devices[0]].relative;
    await primarySession.context.close();
    primarySession = null;

    for (const device of devices.slice(1)) {
      let session = null;
      try {
        session = await openDevicePage(browser, url, device, options);
        if (options.autoScroll) await autoScroll(session.page).catch(() => {});
        await session.page.waitForTimeout(options.delayMs);
        await session.page.screenshot({ path: outputPaths[device].absolute, fullPage: true, animations: "disabled" });
        files[device] = outputPaths[device].relative;
      } catch (error) {
        deviceErrors[device] = error.message;
      } finally {
        await session?.context.close().catch(() => {});
      }
    }

    return { ok: true, status, ...metadata, files, deviceErrors, durationMs: Date.now() - startedAt };
  } catch (error) {
    if (claimed) releaseType(metadata.pageType);
    return { ok: false, status, ...metadata, files, durationMs: Date.now() - startedAt, error: error.message };
  } finally {
    await primarySession?.context.close().catch(() => {});
  }
}

async function createZip(sourceDir, outputFile) {
  await new Promise((resolve, reject) => {
    const child = spawn("zip", ["-rq", outputFile, path.basename(sourceDir)], { cwd: path.dirname(sourceDir) });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr || `zip exited with code ${code}`)));
  });
}

async function runJob(job) {
  const root = new URL(job.options.url);
  const workRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "site-snapshotter-"));
  const folderName = `${root.hostname.replace(/[^a-z0-9.-]/gi, "-")}-screenshots`;
  const exportDir = path.join(workRoot, folderName);
  const screenshotDir = path.join(exportDir, "screenshots");
  const devices = selectedDevices(job.options.viewport);
  await Promise.all(devices.map((device) => fsPromises.mkdir(path.join(screenshotDir, device), { recursive: true })));
  job.workRoot = workRoot;
  job.exportDir = exportDir;

  const browser = await chromium.launch({ headless: true });
  const queue = [canonicalize(job.options.url)];
  const seen = new Set(queue);
  let cursor = 0;
  let active = 0;
  let fileIndex = 0;
  const claimedTypes = new Set();
  let likelySinglePostsQueued = 0;

  const claimType = (pageType) => {
    if (claimedTypes.has(pageType)) return false;
    if (claimedTypes.size >= 5) return false;
    if (pageType !== "single-post" && [...claimedTypes].filter(type => type !== "single-post").length >= 4) return false;
    claimedTypes.add(pageType);
    return true;
  };
  const releaseType = (pageType) => claimedTypes.delete(pageType);

  job.status = "running";
  job.stage = "discovering";
  job.message = "Mapping the website structure…";
  job.total = 1;
  emit(job);

  const worker = async () => {
    while (true) {
      if (job.cancelled || job.completed >= 5) return;
      if (cursor >= queue.length) {
        if (active === 0) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }
      const url = queue[cursor++];
      active += 1;
      fileIndex += 1;
      const outputName = safeFileName(url, fileIndex);
      const outputPaths = Object.fromEntries(devices.map((device) => [device, {
        absolute: path.join(screenshotDir, device, `${device}-${outputName}`),
        relative: `screenshots/${device}/${device}-${outputName}`
      }]));
      job.currentUrl = url;
      job.message = `Inspecting page ${job.scanned + 1} of up to ${job.options.maxPages}`;
      emit(job);

      const result = await captureRepresentative(browser, url, outputPaths, job.options, claimType, releaseType);
      job.scanned += 1;

      if (result.ok) {
        const regularLinks = [];
        const likelyArticleLinks = [];
        for (const discovered of result.links || []) {
          const normalized = canonicalize(discovered.href);
          if (!normalized || seen.has(normalized)) continue;
          const candidate = new URL(normalized);
          if (!shouldInclude(candidate, root, job.options.includeSubdomains)) continue;
          if (!matchesFilters(candidate, job.options.includePattern, job.options.excludePattern)) continue;
          seen.add(normalized);
          if (/\/(?:wp-admin|wp-login\.php|feed)(?:\/|$)/i.test(candidate.pathname) || /^\/\d{4}\/\d{1,2}(?:\/\d{1,2})?\/?$/.test(candidate.pathname)) continue;
          if (discovered.likelyArticle) likelyArticleLinks.push({ url: normalized, priority: discovered.priority });
          else regularLinks.push({ url: normalized, priority: discovered.priority });
        }
        regularLinks.sort((a, b) => a.priority - b.priority);
        likelyArticleLinks.sort((a, b) => a.priority - b.priority);
        for (const discovered of likelyArticleLinks) {
          if (queue.length >= job.options.maxPages || likelySinglePostsQueued >= 3 || claimedTypes.has("single-post")) break;
          likelySinglePostsQueued += 1;
          queue.push(discovered.url);
        }
        for (const discovered of regularLinks) {
          if (queue.length >= job.options.maxPages) break;
          queue.push(discovered.url);
        }
      }

      if (result.ok && !result.skipped) {
        job.completed += 1;
        const screenshotCount = Object.keys(result.files || {}).length;
        job.screenshotCount += screenshotCount;
        const item = {
          url,
          files: result.files,
          status: result.status,
          title: result.title,
          durationMs: result.durationMs,
          pageType: result.pageType,
          pageTypeLabel: TYPE_LABELS[result.pageType] || "Page",
          deviceErrors: result.deviceErrors
        };
        job.results.push(item);
        job.capturedTypes.push(item);
        job.stage = "capturing";
        job.message = `Saved ${item.pageTypeLabel} on ${screenshotCount} device${screenshotCount === 1 ? "" : "s"}`;
      } else if (result.ok && result.skipped) {
        job.duplicateCount += 1;
        job.results.push({ url, files: {}, status: result.status, title: result.title, durationMs: result.durationMs, skipped: true, error: result.skipReason, pageType: result.pageType, pageTypeLabel: TYPE_LABELS[result.pageType] || "Page" });
        job.message = result.skipReason;
      } else {
        job.failed += 1;
        job.results.push({ url, files: {}, status: result.status || 0, title: result.title || "", durationMs: result.durationMs, error: result.error, pageType: result.pageType || "unknown", pageTypeLabel: "Unavailable" });
        job.message = `Could not inspect page: ${result.error}`;
      }
      active -= 1;
      job.total = Math.min(queue.length, job.options.maxPages);
      emit(job);
    }
  };

  try {
    await Promise.all(Array.from({ length: job.options.concurrency }, () => worker()));
  } finally {
    await browser.close();
  }

  if (job.cancelled) {
    job.status = "cancelled";
    job.message = "Capture stopped.";
    emit(job);
    return;
  }

  const report = {
    website: job.options.url,
    createdAt: new Date().toISOString(),
    viewport: job.options.viewport,
    mode: "representative-pages",
    scanLimit: job.options.maxPages,
    representativeLimit: 5,
    singlePostLimit: 1,
    captured: job.completed,
    screenshots: job.screenshotCount,
    scanned: job.scanned,
    repeatedTemplatesIgnored: job.duplicateCount,
    failed: job.failed,
    representatives: job.capturedTypes,
    scanLog: job.results
  };
  const representativeCsv = [
    ["Page type", "URL", "Desktop screenshot", "Tablet screenshot", "Mobile screenshot", "HTTP status", "Page title", "Capture time (ms)"].map(csvCell).join(","),
    ...job.capturedTypes.map((item) => [item.pageTypeLabel, item.url, item.files?.desktop || "", item.files?.tablet || "", item.files?.mobile || "", item.status, item.title, item.durationMs].map(csvCell).join(","))
  ].join("\n");
  const scanCsv = [
    ["URL", "Page type", "Captured", "HTTP status", "Page title", "Capture time (ms)", "Note"].map(csvCell).join(","),
    ...job.results.map((item) => [item.url, item.pageTypeLabel, item.files && Object.keys(item.files).length ? "yes" : "no", item.status, item.title, item.durationMs, item.error || ""].map(csvCell).join(","))
  ].join("\n");
  const readme = `SITE SNAPSHOTTER — FIVE-PAGE REPRESENTATIVE EXPORT\n\nWebsite: ${job.options.url}\nCreated: ${report.createdAt}\nRepresentative pages: ${job.completed}\nScreenshots: ${job.screenshotCount}\nPages inspected: ${job.scanned} of ${job.options.maxPages} maximum\nRepeated templates ignored: ${job.duplicateCount}\nDevice mode: ${job.options.viewport}\n\nThe crawler inspects up to 30 URLs to select up to five distinct page types. One slot is reserved for a blog post; fewer pages may be returned when unavailable. It prioritizes one single blog post when one is discoverable. All Screens mode separates screenshots into desktop, tablet, and mobile folders.\n`;
  await Promise.all([
    fsPromises.writeFile(path.join(exportDir, "report.json"), JSON.stringify(report, null, 2)),
    fsPromises.writeFile(path.join(exportDir, "representatives.csv"), representativeCsv),
    fsPromises.writeFile(path.join(exportDir, "scan-log.csv"), scanCsv),
    fsPromises.writeFile(path.join(exportDir, "README.txt"), readme)
  ]);

  job.zipPath = path.join(workRoot, `${folderName}.zip`);
  job.stage = "packaging";
  job.message = "Creating your ZIP folder…";
  emit(job);
  await createZip(exportDir, job.zipPath);
  job.status = "complete";
  job.stage = "complete";
  job.message = `${job.completed} representative page${job.completed === 1 ? "" : "s"} ready to download.`;
  job.currentUrl = "";
  emit(job);
}

function startJob(options) {
  const id = crypto.randomUUID();
  const job = {
    id,
    status: "queued",
    total: 1,
    completed: 0,
    failed: 0,
    scanned: 0,
    duplicateCount: 0,
    screenshotCount: 0,
    stage: "starting",
    currentUrl: "",
    message: "Preparing the browser…",
    results: [],
    capturedTypes: [],
    clients: new Set(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    cancelled: false,
    options
  };
  jobs.set(id, job);
  runJob(job).catch((error) => {
    job.status = "error";
    job.message = error.message || "Capture failed.";
    emit(job);
  });
  return job;
}

async function serveStatic(req, res) {
  const requestPath = new URL(req.url, `http://${req.headers.host || "localhost"}`).pathname;
  const relative = requestPath === "/" ? "index.html" : requestPath.slice(1);
  const filePath = path.resolve(publicDir, relative);
  if (!filePath.startsWith(publicDir + path.sep) && filePath !== path.join(publicDir, "index.html")) {
    res.writeHead(403); res.end("Forbidden"); return;
  }
  try {
    res.setHeader("Cache-Control", "no-store");
    const stat = await fsPromises.stat(filePath);
    if (!stat.isFile()) throw new Error("Not a file");
    res.writeHead(200, { "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream" });
    fs.createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404); res.end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "POST" && url.pathname === "/api/jobs") {
    try {
      const body = await readJson(req);
      const options = {
        url: normalizeStartUrl(body.url),
        maxPages: 30,
        concurrency: Math.min(5, Math.max(1, Number(body.concurrency) || 3)),
        viewport: ["desktop", "tablet", "mobile", "all", "both"].includes(body.viewport) ? body.viewport : "all",
        timeoutMs: Math.min(60_000, Math.max(8_000, Number(body.timeoutSeconds) * 1000 || 30_000)),
        delayMs: Math.min(5_000, Math.max(0, Number(body.delayMs) || 500)),
        includeSubdomains: Boolean(body.includeSubdomains),
        autoScroll: body.autoScroll !== false,
        includePattern: String(body.includePattern || "").trim(),
        excludePattern: String(body.excludePattern || "").trim()
      };
      const job = startJob(options);
      sendJson(res, 202, { id: job.id });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  const eventMatch = url.pathname.match(/^\/api\/jobs\/([a-f0-9-]+)\/events$/);
  if (req.method === "GET" && eventMatch) {
    const job = jobs.get(eventMatch[1]);
    if (!job) return sendJson(res, 404, { error: "Job not found." });
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    });
    job.clients.add(res);
    emit(job);
    req.on("close", () => job.clients.delete(res));
    return;
  }

  const downloadMatch = url.pathname.match(/^\/api\/jobs\/([a-f0-9-]+)\/download$/);
  if (req.method === "GET" && downloadMatch) {
    const job = jobs.get(downloadMatch[1]);
    if (!job || job.status !== "complete" || !job.zipPath) return sendJson(res, 404, { error: "Download is not ready." });
    const filename = path.basename(job.zipPath);
    const stat = await fsPromises.stat(job.zipPath);
    res.writeHead(200, {
      "Content-Type": "application/zip",
      "Content-Length": stat.size,
      "Content-Disposition": `attachment; filename="${filename}"`
    });
    fs.createReadStream(job.zipPath).pipe(res);
    return;
  }

  const cancelMatch = url.pathname.match(/^\/api\/jobs\/([a-f0-9-]+)\/cancel$/);
  if (req.method === "POST" && cancelMatch) {
    const job = jobs.get(cancelMatch[1]);
    if (!job) return sendJson(res, 404, { error: "Job not found." });
    job.cancelled = true;
    job.message = "Stopping after the current pages…";
    emit(job);
    return sendJson(res, 200, { ok: true });
  }

  await serveStatic(req, res);
});

setInterval(async () => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, job] of jobs) {
    if (job.updatedAt < cutoff) {
      jobs.delete(id);
      if (job.workRoot) await fsPromises.rm(job.workRoot, { recursive: true, force: true }).catch(() => {});
    }
  }
}, 10 * 60 * 1000).unref();


const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Site Snapshotter is ready on port ${PORT}`);
});