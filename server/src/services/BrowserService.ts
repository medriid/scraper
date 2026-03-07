import https from "https";
import http from "http";
import { chromium, Browser, BrowserContext, Page } from "playwright-core";

export interface InterceptedRequest {
  url: string;
  method: string;
  contentType: string;
  statusCode: number;
  sampleData: string;
  isJsonApi: boolean;
}

export interface BrowseResult {
  html: string;
  title: string;
  links: string[];
  interceptedRequests: InterceptedRequest[];
  finalUrl: string;
}

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.4; rv:124.0) Gecko/20100101 Firefox/124.0",
];

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1536, height: 864 },
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
];

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Returns true if the error is a "browser executable not installed" error. */
function isBrowserNotInstalledError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("executable doesn't exist") ||
    msg.includes("executable does not exist") ||
    msg.includes("no such file") ||
    (msg.includes("executable") && msg.includes("playwright"))
  );
}

// ─── HTTP fallback ────────────────────────────────────────────────────────────

function httpFetch(targetUrl: string, redirectsLeft = 5): Promise<string> {
  return new Promise((resolve, reject) => {
    if (redirectsLeft <= 0) {
      reject(new Error("Too many HTTP redirects"));
      return;
    }
    const parsedUrl = new URL(targetUrl);
    const transport = parsedUrl.protocol === "https:" ? https : http;
    const ua = pickRandom(USER_AGENTS);

    const req = transport.get(
      targetUrl,
      {
        headers: {
          "User-Agent": ua,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        timeout: 15_000,
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          httpFetch(new URL(res.headers.location, targetUrl).href, redirectsLeft - 1).then(resolve).catch(reject);
          res.resume();
          return;
        }
        const MAX_BODY = 512_000;
        const chunks: Buffer[] = [];
        let totalSize = 0;
        res.on("data", (c: Buffer) => {
          totalSize += c.length;
          if (totalSize <= MAX_BODY) chunks.push(c);
          else if (totalSize - c.length < MAX_BODY) {
            // Push only the remaining portion up to the limit
            chunks.push(c.subarray(0, MAX_BODY - (totalSize - c.length)));
          }
        });
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("HTTP fetch timed out")); });
  });
}

function extractLinksFromHtml(html: string, base: string): string[] {
  const links: string[] = [];
  const re = /href=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const abs = new URL(m[1], base).href;
      if (abs.startsWith("http")) links.push(abs);
    } catch { /* skip */ }
  }
  return [...new Set(links)].slice(0, 200);
}

function extractTitleFromHtml(html: string): string {
  const m = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  return m ? m[1].trim() : "";
}

async function httpFallbackBrowse(url: string): Promise<BrowseResult> {
  const html = await httpFetch(url);
  return {
    html,
    title: extractTitleFromHtml(html),
    links: extractLinksFromHtml(html, url),
    interceptedRequests: [],
    finalUrl: url,
  };
}

// ─── Main browse function ─────────────────────────────────────────────────────

export async function browseUrl(
  url: string,
  opts: {
    autoExplore?: boolean;
    timeout?: number;
    waitFor?: "domcontentloaded" | "networkidle" | "load";
  } = {}
): Promise<BrowseResult> {
  const { autoExplore = false, timeout = 30_000, waitFor = "domcontentloaded" } = opts;

  const ua = pickRandom(USER_AGENTS);
  const viewport = pickRandom(VIEWPORTS);

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;

  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
        "--disable-infobars",
      ],
    });

    context = await browser.newContext({
      userAgent: ua,
      viewport,
      locale: "en-US",
      timezoneId: "America/New_York",
      extraHTTPHeaders: {
        "Accept-Language": "en-US,en;q=0.9",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
      },
    });

    // Remove webdriver fingerprint
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).navigator.__proto__.webdriver;
    });

    const page = await context.newPage();
    const interceptedRequests: InterceptedRequest[] = [];
    const seenUrls = new Set<string>();

    // Intercept XHR/fetch responses
    page.on("response", async (response) => {
      const reqUrl = response.url();
      if (seenUrls.has(reqUrl)) return;
      const ct = response.headers()["content-type"] ?? "";

      if (
        (ct.includes("application/json") || ct.includes("text/json")) &&
        !reqUrl.includes("analytics") &&
        !reqUrl.includes("tracking") &&
        !reqUrl.includes("beacon")
      ) {
        seenUrls.add(reqUrl);
        try {
          const body = await response.text().catch(() => "");
          if (body.length > 10 && body.length < 500_000) {
            interceptedRequests.push({
              url: reqUrl,
              method: response.request().method(),
              contentType: ct,
              statusCode: response.status(),
              sampleData: body.slice(0, 2000),
              isJsonApi: true,
            });
          }
        } catch {
          // ignore
        }
      }
    });

    await page.goto(url, { waitUntil: waitFor, timeout });

    if (autoExplore) {
      await autoExploreInteractions(page);
    }

    const html = await page.content();
    const title = await page.title().catch(() => "");
    const finalUrl = page.url();

    // Extract links
    const links = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll("a[href]"));
      return anchors
        .map((a) => (a as HTMLAnchorElement).href)
        .filter((h) => h.startsWith("http") && !h.includes("javascript:"))
        .slice(0, 200);
    });

    return { html, title, links, interceptedRequests, finalUrl };
  } catch (err) {
    if (isBrowserNotInstalledError(err)) {
      console.warn("[BrowserService] Playwright browser not installed — falling back to HTTP fetch");
      return httpFallbackBrowse(url);
    }
    throw err;
  } finally {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
}

async function autoExploreInteractions(page: Page): Promise<void> {
  // Scroll gradually to trigger lazy loading and infinite scroll
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      let totalScrolled = 0;
      const maxScroll = Math.min(document.body.scrollHeight, 8000);
      const timer = setInterval(() => {
        window.scrollBy(0, 300);
        totalScrolled += 300;
        if (totalScrolled >= maxScroll) {
          clearInterval(timer);
          resolve();
        }
      }, 150);
    });
  }).catch(() => {});

  await page.waitForTimeout(800).catch(() => {});

  // Try clicking "Load More" / "Show More" buttons
  const loadMoreSelectors = [
    'button:has-text("Load More")',
    'button:has-text("Show More")',
    'button:has-text("See More")',
    'button:has-text("View More")',
    '[data-testid*="load-more"]',
    '[class*="load-more"]',
    '[class*="loadmore"]',
    '[class*="show-more"]',
    ".infinite-scroll-trigger",
  ];

  for (const sel of loadMoreSelectors) {
    try {
      const btn = await page.$(sel);
      if (btn) {
        await btn.click({ timeout: 3000 });
        await page.waitForTimeout(1000);
        break;
      }
    } catch {
      // ignore, try next
    }
  }

  // Try expanding shadow DOM elements
  try {
    await page.evaluate(() => {
      const shadowHosts = document.querySelectorAll("*");
      shadowHosts.forEach((el) => {
        if ((el as Element & { shadowRoot?: ShadowRoot }).shadowRoot) {
          // Shadow DOM detected — content is already accessible via Playwright
        }
      });
    });
  } catch {
    // ignore
  }

  // Scroll back up
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await page.waitForTimeout(300).catch(() => {});
}
