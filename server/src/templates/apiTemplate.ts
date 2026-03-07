// ─── Helper functions (used by all template generators) ──────────────────────

function buildInterfaceFields(schema: Record<string, unknown>): string {
  return Object.entries(schema)
    .map(([key, value]) => {
      const tsType = inferTsType(value);
      return `  ${key}: ${tsType};`;
    })
    .join("\n");
}

function inferTsType(value: unknown): string {
  if (value === null || value === undefined) return "string";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (Array.isArray(value)) {
    if (value.length === 0) return "string[]";
    return `${inferTsType(value[0])}[]`;
  }
  if (typeof value === "object") {
    return "Record<string, unknown>";
  }
  return "string";
}

function inferPyType(value: unknown): string {
  if (value === null || value === undefined) return "str";
  if (typeof value === "boolean") return "bool";
  if (typeof value === "number") return "float";
  if (Array.isArray(value)) {
    if (value.length === 0) return "list[str]";
    return `list[${inferPyType(value[0])}]`;
  }
  if (typeof value === "object") {
    return "dict";
  }
  return "str";
}

function classifyField(key: string, value: unknown): { type: string; selectors: string[] } {
  const lk = key.toLowerCase();

  if (Array.isArray(value)) {
    if (lk.includes("image") || lk.includes("img") || lk.includes("photo") || lk.includes("picture") || lk.includes("thumbnail")) {
      return {
        type: "imageArray",
        selectors: ["img[src]", "[data-src]", "picture source[srcset]", "[class*='image'] img", "[class*='thumb'] img"],
      };
    }
    if (lk.includes("genre") || lk.includes("tag") || lk.includes("categor")) {
      return {
        type: "array",
        selectors: [
          "[class*='genre'] a", "[class*='tag'] a", "[class*='category'] a",
          "[itemprop='genre']", "[class*='genre'] span", "[class*='tag'] span",
          "[class*='genre']", "[class*='tag']",
        ],
      };
    }
    return { type: "array", selectors: [] };
  }

  if (lk.includes("url") || lk === "link" || lk === "href") {
    return { type: "url", selectors: ["a[href]", "[class*='link'] a", "[class*='title'] a", "h2 a", "h3 a"] };
  }
  if (lk.includes("image") || lk.includes("img") || lk.includes("thumbnail") || lk.includes("avatar") || lk.includes("cover") || lk.includes("poster")) {
    return { type: "image", selectors: ["img[src]", "[data-src]", "[class*='cover'] img", "[class*='thumb'] img", "[class*='poster'] img"] };
  }
  if (lk.includes("title") || lk.includes("name") || lk === "heading") {
    return { type: "text", selectors: ["h1", "h2", "h3", "h4", "[class*='title']", "[class*='name']", "[itemprop='name']", "[itemprop='headline']"] };
  }
  if (lk.includes("description") || lk.includes("summary") || lk.includes("synopsis") || lk.includes("content") || lk.includes("body") || lk.includes("text")) {
    return { type: "text", selectors: ["[class*='description']", "[class*='summary']", "[class*='synopsis']", "[itemprop='description']", "p"] };
  }
  if (lk.includes("price") || lk.includes("cost")) {
    return { type: "text", selectors: ["[class*='price']", "[itemprop='price']", "[data-price]"] };
  }
  if (lk.includes("rating") || lk.includes("score") || lk.includes("stars")) {
    return { type: "text", selectors: ["[class*='rating']", "[class*='score']", "[itemprop='ratingValue']", "[class*='star']"] };
  }
  if (lk.includes("author") || lk.includes("artist") || lk.includes("creator") || lk.includes("writer")) {
    return { type: "text", selectors: ["[class*='author']", "[class*='artist']", "[itemprop='author']", "[class*='creator']"] };
  }
  if (lk.includes("date") || lk.includes("time") || lk.includes("updated") || lk.includes("published") || lk.includes("created")) {
    return { type: "text", selectors: ["time[datetime]", "[class*='date']", "[class*='time']", "[itemprop='datePublished']", "[itemprop='dateModified']"] };
  }
  if (lk.includes("status")) {
    return { type: "text", selectors: ["[class*='status']", "[class*='state']"] };
  }
  if (lk.includes("chapter") || lk.includes("episode") || lk.includes("volume")) {
    return { type: "text", selectors: ["[class*='chapter']", "[class*='episode']", "[class*='volume']", "[class*='latest']"] };
  }
  if (lk.includes("count") || lk.includes("views") || lk.includes("likes") || lk.includes("comments")) {
    return { type: "text", selectors: ["[class*='view']", "[class*='count']", "[class*='like']", "[class*='comment']"] };
  }

  return { type: "text", selectors: [] };
}

function buildFieldHints(schema: Record<string, unknown>): string {
  const hints: Record<string, { type: string; selectors: string[] }> = {};
  for (const [key, value] of Object.entries(schema)) {
    hints[key] = classifyField(key, value);
  }
  return JSON.stringify(hints, null, 2);
}

function buildPyFieldHints(schema: Record<string, unknown>): string {
  const hints: Record<string, { type: string; selectors: string[] }> = {};
  for (const [key, value] of Object.entries(schema)) {
    hints[key] = classifyField(key, value);
  }
  // Python dict literal
  const entries = Object.entries(hints).map(([key, hint]) => {
    const sels = hint.selectors.map((s) => `"${s}"`).join(", ");
    return `    "${key}": {"type": "${hint.type}", "selectors": [${sels}]}`;
  });
  return `{\n${entries.join(",\n")}\n}`;
}

function hostnameToClassName(websiteUrl: string): { hostname: string; className: string } {
  const hostname = (() => {
    try {
      return new URL(websiteUrl).hostname;
    } catch {
      return websiteUrl;
    }
  })();
  const className = hostname
    .replace(/[^a-zA-Z0-9]/g, "_")
    .replace(/^_+|_+$/g, "")
    .split("_")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");
  return { hostname, className };
}

// ─── TypeScript scraper template ─────────────────────────────────────────────

export function generateApiFileTemplate(
  websiteUrl: string,
  schema: Record<string, unknown>,
  instructions: string
): string {
  const schemaStr = JSON.stringify(schema, null, 2);
  const { hostname, className } = hostnameToClassName(websiteUrl);
  const fieldHints = buildFieldHints(schema);

  return `import { chromium, Browser, Page } from "playwright";
import * as fs from "fs";

export interface ScrapedItem {
${buildInterfaceFields(schema)}
}

const CONFIG = {
  startUrl: "${websiteUrl}",
  requestDelay: 1500,
  maxPages: 10,
  headless: true,
  provider: "${hostname}",
} as const;

const SCHEMA_HINT = ${schemaStr} as const;

const FIELD_HINTS: Record<string, { type: string; selectors: string[] }> = ${fieldHints};

export class ${className}Scraper {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private results: ScrapedItem[] = [];
  private interceptedData: Record<string, unknown>[] = [];

  async init(): Promise<void> {
    this.browser = await chromium.launch({
      headless: CONFIG.headless,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const context = await this.browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 900 },
    });
    this.page = await context.newPage();

    this.page.on("response", async (response) => {
      const url = response.url();
      const ct = response.headers()["content-type"] ?? "";
      if (ct.includes("application/json") && !url.includes("analytics")) {
        try {
          const json = await response.json();
          this.interceptedData.push({ url, data: json });
        } catch {}
      }
    });
  }

  private generateId(input: string): string {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      hash = ((hash << 5) - hash) + input.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }

  private async safeExtract(selectors: string, attr?: string): Promise<string> {
    const sels = selectors.split(",").map((s: string) => s.trim());
    for (const sel of sels) {
      try {
        const el = await this.page!.$(sel);
        if (el) {
          if (attr) {
            const val = await el.getAttribute(attr);
            if (val) return val;
          }
          const text = await el.textContent();
          if (text?.trim()) return text.trim();
        }
      } catch {}
    }
    return "";
  }

  private async extractImages(): Promise<string[]> {
    return this.page!.evaluate(() => {
      const imgs: Element[] = Array.from(
        document.querySelectorAll("img[src], [data-src], picture source[srcset], [class*='image'] img, [class*='thumb'] img")
      );
      return imgs
        .map((img: Element) =>
          img.getAttribute("src") ??
          img.getAttribute("data-src") ??
          img.getAttribute("srcset")?.split(" ")[0] ??
          ""
        )
        .filter((url: string) => url.length > 0 && !url.includes("data:image/svg"));
    });
  }

  private async extractGenres(): Promise<string[]> {
    return this.page!.evaluate(() => {
      const selectors = [
        "[class*='genre'] a", "[class*='tag'] a", "[class*='category'] a",
        "[itemprop='genre']", "[class*='genre'] span", "[class*='tag'] span",
      ];
      for (const sel of selectors) {
        const els: Element[] = Array.from(document.querySelectorAll(sel));
        if (els.length > 0) {
          return els.map((el: Element) => el.textContent?.trim() ?? "").filter(Boolean);
        }
      }
      return [];
    });
  }

  private async goto(url: string, retries = 3): Promise<void> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await this.page!.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
        return;
      } catch (err) {
        if (attempt === retries) throw err;
        console.log(\`[Scraper] Retry \${attempt}/\${retries} for \${url}\`);
        await sleep(attempt * 2000);
      }
    }
  }

  private async getDetailLinks(): Promise<string[]> {
    return this.page!.evaluate(() => {
      const selectors = [
        "article a[href]", "[class*='card'] a[href]", "[class*='item'] a[href]",
        "[class*='title'] a[href]", "[class*='entry'] a[href]", "[class*='post'] a[href]",
        "[class*='comic'] a[href]", "[class*='manga'] a[href]",
        "h2 a[href]", "h3 a[href]", "h4 a[href]",
      ];
      const links = new Set<string>();
      for (const sel of selectors) {
        const els: Element[] = Array.from(document.querySelectorAll(sel));
        els.forEach((el: Element) => {
          const href = el.getAttribute("href");
          if (href && !href.startsWith("#") && !href.startsWith("javascript:") && !href.startsWith("mailto:")) {
            try {
              links.add(new URL(href, location.href).href);
            } catch {}
          }
        });
        if (links.size > 0) break;
      }
      return [...links].slice(0, 50);
    });
  }

  private async extractItems(): Promise<ScrapedItem[]> {
    await this.page!.waitForLoadState("domcontentloaded");

    const items = await this.page!.evaluate((args: { schema: Record<string, unknown>; fieldHints: Record<string, { type: string; selectors: string[] }> }) => {
      const { schema, fieldHints } = args;

      function findContainers(): Element[] {
        const selectors = [
          "article",
          "[class*='card']",
          "[class*='item']:not(nav [class*='item'])",
          "[class*='product']",
          "[class*='result']",
          "[class*='listing']",
          "[class*='entry']",
          "[class*='post']",
          "[class*='comic']",
          "[class*='manga']",
          "[class*='chapter']",
        ];
        const candidates = Array.from(
          document.querySelectorAll(selectors.join(", "))
        ).filter(
          (el: Element) =>
            el.children.length > 0 &&
            el.textContent!.trim().length > 10 &&
            el.querySelectorAll("a, img").length > 0
        );
        if (candidates.length > 0) return candidates;

        const lists = Array.from(document.querySelectorAll("ul, ol")).filter(
          (ul: Element) => ul.children.length >= 2
        );
        for (const list of lists) {
          const lis: Element[] = Array.from(list.querySelectorAll(":scope > li")).filter(
            (li: Element) => li.querySelectorAll("a").length > 0
          );
          if (lis.length >= 2) return lis;
        }

        return Array.from(document.querySelectorAll("li, tr")).filter(
          (el: Element) => el.children.length > 0 && el.textContent!.trim().length > 10
        );
      }

      function extractField(
        container: Element,
        key: string,
        hint: { type: string; selectors: string[] }
      ): unknown {
        for (const sel of hint.selectors) {
          try {
            if (hint.type === "imageArray" || hint.type === "array") {
              const els: Element[] = Array.from(container.querySelectorAll(sel));
              if (els.length > 0) {
                if (hint.type === "imageArray") {
                  return els
                    .map((el: Element) => el.getAttribute("src") ?? el.getAttribute("data-src") ?? "")
                    .filter(Boolean);
                }
                return els.map((el: Element) => el.textContent?.trim() ?? "").filter(Boolean);
              }
            } else {
              const el = container.querySelector(sel);
              if (el) {
                if (hint.type === "url") return el.getAttribute("href") ?? el.textContent?.trim() ?? "";
                if (hint.type === "image") return el.getAttribute("src") ?? el.getAttribute("data-src") ?? "";
                return el.getAttribute("content") ?? el.textContent?.trim() ?? "";
              }
            }
          } catch {}
        }

        const explicit = [
          "[class*='" + key + "']",
          "[data-" + key + "]",
          "." + key,
          "#" + key,
          "[itemprop='" + key + "']",
        ];
        for (const sel of explicit) {
          try {
            const el = container.querySelector(sel);
            if (el) {
              if (hint.type === "url") return el.getAttribute("href") ?? el.textContent?.trim() ?? "";
              if (hint.type === "image") return el.getAttribute("src") ?? el.getAttribute("data-src") ?? "";
              return el.textContent?.trim() ?? "";
            }
          } catch {}
        }

        if (hint.type === "array" || hint.type === "imageArray") return [];
        return "";
      }

      const containers = findContainers();
      const data: Record<string, unknown>[] = [];

      if (containers.length > 0) {
        for (const container of containers) {
          const entry: Record<string, unknown> = {};
          for (const key of Object.keys(schema)) {
            const hint = fieldHints[key] ?? { type: "text", selectors: [] };
            entry[key] = extractField(container, key, hint);
          }
          const nonEmpty = Object.values(entry).filter(
            (v: unknown) => v !== "" && !(Array.isArray(v) && v.length === 0)
          );
          if (nonEmpty.length >= 2) data.push(entry);
        }
      }

      if (data.length === 0) {
        const entry: Record<string, unknown> = {};
        for (const key of Object.keys(schema)) {
          const hint = fieldHints[key] ?? { type: "text", selectors: [] };
          entry[key] = extractField(document.body, key, hint);
        }
        data.push(entry);
      }

      return data;
    }, { schema: SCHEMA_HINT, fieldHints: FIELD_HINTS });

    return items as ScrapedItem[];
  }

  private async extractDetailPage(url: string): Promise<ScrapedItem | null> {
    try {
      await this.goto(url);
      const schemaKeys = Object.keys(SCHEMA_HINT);

      const basicData: Record<string, unknown> = {};
      for (const key of schemaKeys) {
        const hint = FIELD_HINTS[key] ?? { type: "text", selectors: [] };
        if (hint.type === "imageArray") {
          basicData[key] = await this.extractImages();
        } else if (hint.type === "array" && (key.toLowerCase().includes("genre") || key.toLowerCase().includes("tag"))) {
          basicData[key] = await this.extractGenres();
        } else if (hint.selectors.length > 0) {
          basicData[key] = await this.safeExtract(hint.selectors.join(", "));
        } else {
          basicData[key] = await this.safeExtract(
            \`[class*='\${key}'], [data-\${key}], .\${key}, #\${key}, [itemprop='\${key}']\`
          );
        }
      }

      return this.fillMissingFields(basicData, url);
    } catch (err) {
      console.log(\`[Scraper] Failed to extract detail page \${url}: \${err}\`);
      return null;
    }
  }

  private async tryInterceptedData(): Promise<ScrapedItem[]> {
    if (this.interceptedData.length === 0) return [];
    const schemaKeys = Object.keys(SCHEMA_HINT);

    for (const { data } of this.interceptedData) {
      const items = Array.isArray(data)
        ? data
        : typeof data === "object" && data !== null
        ? (Object.values(data as Record<string, unknown>).find(Array.isArray) as unknown[] | undefined)
        : undefined;

      if (!items || !Array.isArray(items) || items.length === 0) continue;
      if (typeof items[0] !== "object" || items[0] === null) continue;

      const sampleKeys = Object.keys(items[0] as Record<string, unknown>);
      const overlap = schemaKeys.filter((k: string) =>
        sampleKeys.some((sk: string) => sk.toLowerCase() === k.toLowerCase())
      );

      if (overlap.length >= Math.min(2, schemaKeys.length)) {
        return items.map((item: unknown) => {
          const record = item as Record<string, unknown>;
          const entry: Record<string, unknown> = {};
          for (const key of schemaKeys) {
            const matchingKey = Object.keys(record).find(
              (k: string) => k.toLowerCase() === key.toLowerCase()
            );
            entry[key] = matchingKey ? record[matchingKey] ?? "" : "";
          }
          return this.fillMissingFields(entry, CONFIG.startUrl);
        });
      }
    }
    return [];
  }

  private fillMissingFields(item: Record<string, unknown>, url: string): ScrapedItem {
    const now = new Date().toISOString();
    const entry = { ...item };

    for (const [key, val] of Object.entries(entry)) {
      if (val === "" || val === undefined || val === null) {
        const lk = key.toLowerCase();
        if (lk.includes("id")) {
          entry[key] = this.generateId(url + key);
        } else if (lk === "provider" || lk === "source" || lk === "site") {
          entry[key] = CONFIG.provider;
        } else if (lk === "url" || lk === "link" || lk === "href") {
          entry[key] = url;
        } else if (lk.includes("createdat") || lk.includes("created_at") || lk.includes("created")) {
          entry[key] = now;
        } else if (
          lk.includes("updatedat") ||
          lk.includes("updated_at") ||
          lk.includes("lastupdated") ||
          lk.includes("last_updated") ||
          lk.includes("modified")
        ) {
          entry[key] = now;
        }
      }
    }

    return entry as ScrapedItem;
  }

  private async getNextPageUrl(): Promise<string | null> {
    return this.page!.evaluate(() => {
      const selectors = [
        "a[rel='next']",
        "a[aria-label*='next' i]",
        "a[class*='next']",
        "a:has(> [class*='next'])",
        "[class*='pagination'] a:last-child",
        ".pagination a:last-child",
        "[class*='pager'] a:last-child",
        "a:has(> svg[class*='chevron-right'])",
        "a:has(> [class*='arrow-right'])",
      ];
      for (const sel of selectors) {
        try {
          const el = document.querySelector(sel) as HTMLAnchorElement | null;
          if (el?.href) return el.href;
        } catch {}
      }
      return null;
    });
  }

  getInterceptedData(): Record<string, unknown>[] {
    return this.interceptedData;
  }

  async scrape(): Promise<ScrapedItem[]> {
    if (!this.page) throw new Error("Scraper not initialized. Call init() first.");

    let currentUrl: string | null = CONFIG.startUrl;
    let pageNum = 0;

    while (currentUrl && pageNum < CONFIG.maxPages) {
      pageNum++;
      console.log(\`[Scraper] Page \${pageNum}: \${currentUrl}\`);

      await this.goto(currentUrl);

      const apiItems = await this.tryInterceptedData();
      if (apiItems.length > 0) {
        console.log(\`[Scraper] Extracted \${apiItems.length} item(s) from intercepted API data\`);
        this.results.push(...apiItems);
      } else {
        const listingItems = await this.extractItems();
        if (listingItems.length > 0) {
          console.log(\`[Scraper] Extracted \${listingItems.length} item(s) from listing page\`);
          this.results.push(...listingItems.map((item: ScrapedItem) => this.fillMissingFields(item, currentUrl!)));
        }

        const detailLinks = await this.getDetailLinks();
        if (detailLinks.length > 0 && listingItems.length <= detailLinks.length) {
          console.log(\`[Scraper] Found \${detailLinks.length} detail link(s), extracting...\`);
          for (const link of detailLinks.slice(0, 20)) {
            const detailItem = await this.extractDetailPage(link);
            if (detailItem) {
              this.results.push(detailItem);
            }
            await sleep(CONFIG.requestDelay);
          }
        }
      }

      currentUrl = await this.getNextPageUrl();

      if (currentUrl && pageNum < CONFIG.maxPages) {
        await sleep(CONFIG.requestDelay);
      }
    }

    console.log(\`[Scraper] Done. Total records: \${this.results.length}\`);
    return this.results;
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = null;
    this.page = null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const scraper = new ${className}Scraper();
  try {
    await scraper.init();
    const data = await scraper.scrape();

    const timestamp = new Date().toISOString().slice(0, 10);
    const outputFile = \`output-\${timestamp}.json\`;
    fs.writeFileSync(outputFile, JSON.stringify(data, null, 2));
    console.log(\`[Scraper] Saved \${data.length} records to \${outputFile}\`);

    console.log(JSON.stringify(data, null, 2));
  } finally {
    await scraper.close();
  }
}

main().catch((err) => {
  console.error("[Scraper] Fatal error:", err);
  process.exit(1);
});
`;
}

// ─── Python scraper template ─────────────────────────────────────────────────

export function generatePyFileTemplate(
  websiteUrl: string,
  schema: Record<string, unknown>,
  instructions: string
): string {
  const { hostname, className } = hostnameToClassName(websiteUrl);

  const fields = Object.entries(schema)
    .map(([key, value]) => {
      const pyType = inferPyType(value);
      return `    ${key}: ${pyType}`;
    })
    .join("\n");

  const pyFieldHints = buildPyFieldHints(schema);

  return `import json
import time
import hashlib
from dataclasses import dataclass, asdict, field
from datetime import datetime
from playwright.sync_api import sync_playwright, Page, Browser

@dataclass
class ScrapedItem:
${fields || "    pass"}

CONFIG = {
    "start_url": "${websiteUrl}",
    "request_delay": 1.5,
    "max_pages": 10,
    "headless": True,
    "provider": "${hostname}",
}

SCHEMA_KEYS = ${JSON.stringify(Object.keys(schema))}

FIELD_HINTS = ${pyFieldHints}


class ${className}Scraper:
    def __init__(self):
        self.browser: Browser | None = None
        self.page: Page | None = None
        self.results: list[dict] = []
        self.intercepted_data: list[dict] = []

    def init(self):
        pw = sync_playwright().start()
        self.browser = pw.chromium.launch(
            headless=CONFIG["headless"],
            args=["--no-sandbox", "--disable-setuid-sandbox"],
        )
        context = self.browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1280, "height": 900},
        )
        self.page = context.new_page()

        def handle_response(response):
            ct = response.headers.get("content-type", "")
            if "application/json" in ct and "analytics" not in response.url:
                try:
                    self.intercepted_data.append({"url": response.url, "data": response.json()})
                except Exception:
                    pass

        self.page.on("response", handle_response)

    @staticmethod
    def generate_id(input_str: str) -> str:
        return hashlib.md5(input_str.encode()).hexdigest()[:12]

    def safe_extract(self, selectors: str, attr: str | None = None) -> str:
        for sel in selectors.split(","):
            sel = sel.strip()
            try:
                el = self.page.query_selector(sel)
                if el:
                    if attr:
                        val = el.get_attribute(attr)
                        if val:
                            return val
                    text = el.text_content()
                    if text and text.strip():
                        return text.strip()
            except Exception:
                pass
        return ""

    def extract_images(self) -> list[str]:
        return self.page.evaluate("""() => {
            const imgs = Array.from(document.querySelectorAll(
                "img[src], [data-src], picture source[srcset], [class*='image'] img, [class*='thumb'] img"
            ));
            return imgs
                .map(img => img.getAttribute("src") || img.getAttribute("data-src") || img.getAttribute("srcset")?.split(" ")[0] || "")
                .filter(url => url.length > 0 && !url.includes("data:image/svg"));
        }""")

    def extract_genres(self) -> list[str]:
        return self.page.evaluate("""() => {
            const selectors = [
                "[class*='genre'] a", "[class*='tag'] a", "[class*='category'] a",
                "[itemprop='genre']", "[class*='genre'] span", "[class*='tag'] span"
            ];
            for (const sel of selectors) {
                const els = Array.from(document.querySelectorAll(sel));
                if (els.length > 0) {
                    return els.map(el => el.textContent?.trim() || "").filter(Boolean);
                }
            }
            return [];
        }""")

    def goto(self, url: str, retries: int = 3):
        for attempt in range(1, retries + 1):
            try:
                self.page.goto(url, wait_until="networkidle", timeout=30000)
                return
            except Exception:
                if attempt == retries:
                    raise
                print(f"[Scraper] Retry {attempt}/{retries} for {url}")
                time.sleep(attempt * 2)

    def get_detail_links(self) -> list[str]:
        return self.page.evaluate("""() => {
            const selectors = [
                "article a[href]", "[class*='card'] a[href]", "[class*='item'] a[href]",
                "[class*='title'] a[href]", "[class*='entry'] a[href]", "[class*='post'] a[href]",
                "[class*='comic'] a[href]", "[class*='manga'] a[href]",
                "h2 a[href]", "h3 a[href]", "h4 a[href]"
            ];
            const links = new Set();
            for (const sel of selectors) {
                const els = Array.from(document.querySelectorAll(sel));
                els.forEach(el => {
                    const href = el.getAttribute("href");
                    if (href && !href.startsWith("#") && !href.startsWith("javascript:") && !href.startsWith("mailto:")) {
                        try { links.add(new URL(href, location.href).href); } catch {}
                    }
                });
                if (links.size > 0) break;
            }
            return [...links].slice(0, 50);
        }""")

    def extract_items(self) -> list[dict]:
        self.page.wait_for_load_state("domcontentloaded")
        items = self.page.evaluate("""(args) => {
            const schemaKeys = args.schemaKeys;
            const fieldHints = args.fieldHints;

            function findContainers() {
                const selectors = [
                    "article",
                    "[class*='card']",
                    "[class*='item']:not(nav [class*='item'])",
                    "[class*='product']",
                    "[class*='result']",
                    "[class*='listing']",
                    "[class*='entry']",
                    "[class*='post']",
                    "[class*='comic']",
                    "[class*='manga']",
                    "[class*='chapter']"
                ];
                const candidates = Array.from(
                    document.querySelectorAll(selectors.join(", "))
                ).filter(el =>
                    el.children.length > 0 &&
                    el.textContent.trim().length > 10 &&
                    el.querySelectorAll("a, img").length > 0
                );
                if (candidates.length > 0) return candidates;

                const lists = Array.from(document.querySelectorAll("ul, ol")).filter(
                    ul => ul.children.length >= 2
                );
                for (const list of lists) {
                    const items = Array.from(list.querySelectorAll(":scope > li")).filter(
                        li => li.querySelectorAll("a").length > 0
                    );
                    if (items.length >= 2) return items;
                }

                return Array.from(document.querySelectorAll("li, tr")).filter(el =>
                    el.children.length > 0 && el.textContent.trim().length > 10
                );
            }

            function extractField(container, key, hint) {
                for (const sel of hint.selectors) {
                    try {
                        if (hint.type === "imageArray" || hint.type === "array") {
                            const els = Array.from(container.querySelectorAll(sel));
                            if (els.length > 0) {
                                if (hint.type === "imageArray") {
                                    return els.map(el => el.getAttribute("src") || el.getAttribute("data-src") || "").filter(Boolean);
                                }
                                return els.map(el => el.textContent?.trim() || "").filter(Boolean);
                            }
                        } else {
                            const el = container.querySelector(sel);
                            if (el) {
                                if (hint.type === "url") return el.getAttribute("href") || el.textContent.trim();
                                if (hint.type === "image") return el.getAttribute("src") || el.getAttribute("data-src") || "";
                                return el.getAttribute("content") || el.textContent.trim();
                            }
                        }
                    } catch(e) {}
                }
                const explicit = [
                    "[class*='" + key + "']",
                    "[data-" + key + "]",
                    "." + key,
                    "#" + key,
                    "[itemprop='" + key + "']"
                ];
                for (const sel of explicit) {
                    try {
                        const el = container.querySelector(sel);
                        if (el) {
                            if (hint.type === "url") return el.getAttribute("href") || el.textContent.trim();
                            if (hint.type === "image") return el.getAttribute("src") || el.getAttribute("data-src") || "";
                            return el.textContent.trim();
                        }
                    } catch(e) {}
                }
                if (hint.type === "array" || hint.type === "imageArray") return [];
                return "";
            }

            const containers = findContainers();
            const data = [];

            if (containers.length > 0) {
                for (const container of containers) {
                    const entry = {};
                    for (const key of schemaKeys) {
                        const hint = fieldHints[key] || { type: "text", selectors: [] };
                        entry[key] = extractField(container, key, hint);
                    }
                    const nonEmpty = Object.values(entry).filter(
                        v => v !== "" && !(Array.isArray(v) && v.length === 0)
                    );
                    if (nonEmpty.length >= 2) data.push(entry);
                }
            }

            if (data.length === 0) {
                const entry = {};
                for (const key of schemaKeys) {
                    const hint = fieldHints[key] || { type: "text", selectors: [] };
                    entry[key] = extractField(document.body, key, hint);
                }
                data.push(entry);
            }

            return data;
        }""", {"schemaKeys": SCHEMA_KEYS, "fieldHints": FIELD_HINTS})
        return items

    def extract_detail_page(self, url: str) -> dict | None:
        try:
            self.goto(url)
            data = {}
            for key in SCHEMA_KEYS:
                hint = FIELD_HINTS.get(key, {"type": "text", "selectors": []})
                if hint["type"] == "imageArray":
                    data[key] = self.extract_images()
                elif hint["type"] == "array" and ("genre" in key.lower() or "tag" in key.lower()):
                    data[key] = self.extract_genres()
                elif hint["selectors"]:
                    data[key] = self.safe_extract(", ".join(hint["selectors"]))
                else:
                    data[key] = self.safe_extract(
                        f"[class*='{key}'], [data-{key}], .{key}, #{key}, [itemprop='{key}']"
                    )
            return self.fill_missing_fields(data, url)
        except Exception as e:
            print(f"[Scraper] Failed to extract detail page {url}: {e}")
            return None

    def try_intercepted_data(self) -> list[dict]:
        if not self.intercepted_data:
            return []
        for entry in self.intercepted_data:
            data = entry.get("data")
            items = None
            if isinstance(data, list):
                items = data
            elif isinstance(data, dict):
                for v in data.values():
                    if isinstance(v, list) and len(v) > 0:
                        items = v
                        break
            if not items or len(items) == 0:
                continue
            if not isinstance(items[0], dict):
                continue
            sample_keys = [k.lower() for k in items[0].keys()]
            overlap = [k for k in SCHEMA_KEYS if k.lower() in sample_keys]
            if len(overlap) >= min(2, len(SCHEMA_KEYS)):
                results = []
                for item in items:
                    mapped = {}
                    for key in SCHEMA_KEYS:
                        matching = next((k for k in item.keys() if k.lower() == key.lower()), None)
                        mapped[key] = item[matching] if matching else ""
                    results.append(self.fill_missing_fields(mapped, CONFIG["start_url"]))
                return results
        return []

    def fill_missing_fields(self, item: dict, url: str) -> dict:
        now = datetime.utcnow().isoformat() + "Z"
        entry = {**item}
        for key, val in entry.items():
            if val == "" or val is None:
                lk = key.lower()
                if "id" in lk:
                    entry[key] = self.generate_id(url + key)
                elif lk in ("provider", "source", "site"):
                    entry[key] = CONFIG["provider"]
                elif lk in ("url", "link", "href"):
                    entry[key] = url
                elif "createdat" in lk or "created_at" in lk or lk == "created":
                    entry[key] = now
                elif "updatedat" in lk or "updated_at" in lk or "lastupdated" in lk or "last_updated" in lk or "modified" in lk:
                    entry[key] = now
        return entry

    def get_next_page_url(self) -> str | None:
        return self.page.evaluate("""() => {
            const selectors = [
                "a[rel='next']",
                "a[aria-label*='next' i]",
                "a[class*='next']",
                "a:has(> [class*='next'])",
                "[class*='pagination'] a:last-child",
                ".pagination a:last-child",
                "[class*='pager'] a:last-child"
            ];
            for (const sel of selectors) {
                try {
                    const el = document.querySelector(sel);
                    if (el && el.href) return el.href;
                } catch {}
            }
            return null;
        }""")

    def scrape(self) -> list[dict]:
        if not self.page:
            raise RuntimeError("Scraper not initialized. Call init() first.")

        current_url = CONFIG["start_url"]
        page_num = 0

        while current_url and page_num < CONFIG["max_pages"]:
            page_num += 1
            print(f"[Scraper] Page {page_num}: {current_url}")

            self.goto(current_url)

            api_items = self.try_intercepted_data()
            if api_items:
                print(f"[Scraper] Extracted {len(api_items)} item(s) from intercepted API data")
                self.results.extend(api_items)
            else:
                listing_items = self.extract_items()
                if listing_items:
                    print(f"[Scraper] Extracted {len(listing_items)} item(s) from listing page")
                    self.results.extend([self.fill_missing_fields(item, current_url) for item in listing_items])

                detail_links = self.get_detail_links()
                if detail_links and len(listing_items) <= len(detail_links):
                    print(f"[Scraper] Found {len(detail_links)} detail link(s), extracting...")
                    for link in detail_links[:20]:
                        detail_item = self.extract_detail_page(link)
                        if detail_item:
                            self.results.append(detail_item)
                        time.sleep(CONFIG["request_delay"])

            current_url = self.get_next_page_url()
            if current_url and page_num < CONFIG["max_pages"]:
                time.sleep(CONFIG["request_delay"])

        print(f"[Scraper] Done. Total records: {len(self.results)}")
        return self.results

    def close(self):
        if self.browser:
            self.browser.close()
            self.browser = None
            self.page = None


def main():
    scraper = ${className}Scraper()
    try:
        scraper.init()
        data = scraper.scrape()

        timestamp = datetime.utcnow().strftime("%Y-%m-%d")
        output_file = f"output-{timestamp}.json"
        with open(output_file, "w") as f:
            json.dump(data, f, indent=2, default=str)
        print(f"[Scraper] Saved {len(data)} records to {output_file}")

        print(json.dumps(data, indent=2, default=str))
    finally:
        scraper.close()


if __name__ == "__main__":
    main()
`;
}

// ─── Auth credentials interface ──────────────────────────────────────────────

interface AuthCredentials {
  email?: string;
  password?: string;
  token?: string;
  cookies?: string;
}

// ─── TypeScript data API template ────────────────────────────────────────────

export function generateDataApiTemplate(
  websiteUrl: string,
  schema: Record<string, unknown>,
  instructions: string,
  credentials?: AuthCredentials
): string {
  const schemaStr = JSON.stringify(schema, null, 2);
  const { hostname, className } = hostnameToClassName(websiteUrl);

  return `import { chromium, Browser, Page } from "playwright";

export interface ExtractedItem {
${buildInterfaceFields(schema)}
}

interface AuthConfig {
  email?: string;
  password?: string;
  token?: string;
  cookies?: string;
}

const CONFIG = {
  baseUrl: "${websiteUrl}",
  requestDelay: 1500,
  maxPages: 10,
  headless: true,
} as const;

const AUTH: AuthConfig = {
  email: process.env.AUTH_EMAIL ?? "",
  password: process.env.AUTH_PASSWORD ?? "",
  token: process.env.AUTH_TOKEN ?? "",
  cookies: process.env.AUTH_COOKIES ?? "",
};

const SCHEMA_HINT = ${schemaStr} as const;

export class ${className}DataApi {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private results: ExtractedItem[] = [];
  private sessionToken: string | null = null;
  private sessionCookies: string[] = [];

  async init(): Promise<void> {
    this.browser = await chromium.launch({
      headless: CONFIG.headless,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const context = await this.browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 900 },
    });
    this.page = await context.newPage();
  }

  async authenticate(): Promise<boolean> {
    if (AUTH.token) {
      this.sessionToken = AUTH.token;
      return true;
    }

    if (AUTH.cookies) {
      const cookieParts = AUTH.cookies.split(";").map((c: string) => {
        const [name, ...rest] = c.trim().split("=");
        return {
          name: name.trim(),
          value: rest.join("=").trim(),
          domain: new URL(CONFIG.baseUrl).hostname,
          path: "/",
        };
      });
      await this.page!.context().addCookies(cookieParts);
      return true;
    }

    if (AUTH.email && AUTH.password) {
      console.log("[DataAPI] Authenticating via browser login…");
      await this.page!.goto(CONFIG.baseUrl, { waitUntil: "networkidle", timeout: 30_000 });
      return true;
    }

    console.error("[DataAPI] No authentication credentials provided");
    return false;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "application/json",
    };
    if (this.sessionToken) {
      headers["Authorization"] = \`Bearer \${this.sessionToken}\`;
    }
    if (this.sessionCookies.length > 0) {
      headers["Cookie"] = this.sessionCookies.join("; ");
    }
    return headers;
  }

  async fetchData(): Promise<ExtractedItem[]> {
    if (!this.page) throw new Error("Not initialized. Call init() first.");

    const authenticated = await this.authenticate();
    if (!authenticated) {
      throw new Error("Authentication failed");
    }

    await this.page!.goto(CONFIG.baseUrl, { waitUntil: "networkidle", timeout: 30_000 });

    const items = await this.page!.evaluate(() => {
      return [] as Record<string, unknown>[];
    });

    this.results = items as ExtractedItem[];
    return this.results;
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = null;
    this.page = null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const api = new ${className}DataApi();
  try {
    await api.init();
    const data = await api.fetchData();
    console.log(JSON.stringify(data, null, 2));
  } finally {
    await api.close();
  }
}

main().catch((err) => {
  console.error("[DataAPI] Fatal error:", err);
  process.exit(1);
});
`;
}

// ─── Python data API template ────────────────────────────────────────────────

export function generateDataApiPyTemplate(
  websiteUrl: string,
  schema: Record<string, unknown>,
  instructions: string,
  credentials?: AuthCredentials
): string {
  const { hostname, className } = hostnameToClassName(websiteUrl);

  const fields = Object.entries(schema)
    .map(([key, value]) => {
      const pyType = inferPyType(value);
      return `    ${key}: ${pyType}`;
    })
    .join("\n");

  return `import json
import os
import time
from dataclasses import dataclass, asdict
from playwright.sync_api import sync_playwright, Page, Browser

@dataclass
class ExtractedItem:
${fields || "    pass"}

CONFIG = {
    "base_url": "${websiteUrl}",
    "request_delay": 1.5,
    "max_pages": 10,
    "headless": True,
}

AUTH = {
    "email": os.environ.get("AUTH_EMAIL", ""),
    "password": os.environ.get("AUTH_PASSWORD", ""),
    "token": os.environ.get("AUTH_TOKEN", ""),
    "cookies": os.environ.get("AUTH_COOKIES", ""),
}


class ${className}DataApi:
    def __init__(self):
        self.browser: Browser | None = None
        self.page: Page | None = None
        self.results: list[dict] = []
        self.session_token: str | None = None
        self.session_cookies: list[str] = []

    def init(self):
        pw = sync_playwright().start()
        self.browser = pw.chromium.launch(
            headless=CONFIG["headless"],
            args=["--no-sandbox", "--disable-setuid-sandbox"],
        )
        context = self.browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1280, "height": 900},
        )
        self.page = context.new_page()

    def authenticate(self) -> bool:
        if AUTH["token"]:
            self.session_token = AUTH["token"]
            return True

        if AUTH["cookies"]:
            cookie_parts = []
            for c in AUTH["cookies"].split(";"):
                parts = c.strip().split("=", 1)
                if len(parts) == 2:
                    from urllib.parse import urlparse
                    domain = urlparse(CONFIG["base_url"]).hostname
                    cookie_parts.append({
                        "name": parts[0].strip(),
                        "value": parts[1].strip(),
                        "domain": domain,
                        "path": "/",
                    })
            self.page.context.add_cookies(cookie_parts)
            return True

        if AUTH["email"] and AUTH["password"]:
            print("[DataAPI] Authenticating via browser login…")
            self.page.goto(CONFIG["base_url"], wait_until="networkidle", timeout=30000)
            return True

        print("[DataAPI] No authentication credentials provided")
        return False

    def fetch_data(self) -> list[dict]:
        if not self.page:
            raise RuntimeError("Not initialized. Call init() first.")

        if not self.authenticate():
            raise RuntimeError("Authentication failed")

        self.page.goto(CONFIG["base_url"], wait_until="networkidle", timeout=30000)

        items = self.page.evaluate("() => []")
        self.results = items
        return self.results

    def close(self):
        if self.browser:
            self.browser.close()
            self.browser = None
            self.page = None


def main():
    api = ${className}DataApi()
    try:
        api.init()
        data = api.fetch_data()
        print(json.dumps(data, indent=2, default=str))
    finally:
        api.close()


if __name__ == "__main__":
    main()
`;
}
