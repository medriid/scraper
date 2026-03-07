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
