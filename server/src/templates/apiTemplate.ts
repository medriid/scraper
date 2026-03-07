export function generateApiFileTemplate(
  websiteUrl: string,
  schema: Record<string, unknown>,
  instructions: string
): string {
  const schemaStr = JSON.stringify(schema, null, 2);
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

  return `import { chromium, Browser, Page } from "playwright";

export interface ScrapedItem {
${buildInterfaceFields(schema)}
}

const CONFIG = {
  startUrl: "${websiteUrl}",
  requestDelay: 1500,
  maxPages: 10,
  headless: true,
} as const;

const SCHEMA_HINT = ${schemaStr} as const;

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

  private async goto(url: string, retries = 3): Promise<void> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await this.page!.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
        return;
      } catch (err) {
        if (attempt === retries) throw err;
        await sleep(attempt * 2000);
      }
    }
  }

  private async extractItems(): Promise<ScrapedItem[]> {
    await this.page!.waitForLoadState("domcontentloaded");

    const items = await this.page!.evaluate((schema) => {
      const containers = Array.from(
        document.querySelectorAll(
          "article, [class*='card'], [class*='item'], [class*='product'], " +
          "[class*='result'], [class*='listing'], li, tr"
        )
      ).filter((el) => el.children.length > 0 && el.textContent!.trim().length > 0);

      const data: Record<string, unknown>[] = [];

      if (containers.length > 0) {
        containers.forEach((container) => {
          const entry: Record<string, unknown> = {};
          for (const key of Object.keys(schema)) {
            const selectors = [
              \`[class*='\${key}']\`,
              \`[data-\${key}]\`,
              \`.\${key}\`,
              \`#\${key}\`,
              \`[itemprop='\${key}']\`,
            ];
            for (const sel of selectors) {
              const el = container.querySelector(sel);
              if (el) {
                entry[key] =
                  el.getAttribute("href") ??
                  el.getAttribute("src") ??
                  el.getAttribute("content") ??
                  el.textContent?.trim() ??
                  "";
                break;
              }
            }
            if (!(key in entry)) entry[key] = "";
          }
          data.push(entry);
        });
      } else {
        const entry: Record<string, unknown> = {};
        for (const key of Object.keys(schema)) {
          const selectors = [
            \`[class*='\${key}']\`,
            \`.\${key}\`,
            \`#\${key}\`,
            \`[data-\${key}]\`,
          ];
          for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) {
              entry[key] = el.textContent?.trim() ?? "";
              break;
            }
          }
          if (!(key in entry)) entry[key] = "";
        }
        data.push(entry);
      }

      return data;
    }, SCHEMA_HINT);

    return items as ScrapedItem[];
  }

  private async getNextPageUrl(): Promise<string | null> {
    return this.page!.evaluate(() => {
      const nextLink = document.querySelector(
        "a[rel='next'], a[aria-label*='next' i], a[class*='next'], " +
        ".pagination a:last-child, [class*='pagination'] a:last-child"
      ) as HTMLAnchorElement | null;
      return nextLink?.href ?? null;
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
      const items = await this.extractItems();
      console.log(\`[Scraper] Extracted \${items.length} item(s) from page \${pageNum}\`);
      this.results.push(...items);

      currentUrl = await this.getNextPageUrl();

      if (currentUrl && pageNum < CONFIG.maxPages) {
        await sleep(CONFIG.requestDelay);
      }
    }

    if (this.interceptedData.length > 0) {
      console.log(\`[Scraper] Captured \${this.interceptedData.length} API response(s)\`);
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

export function generatePyFileTemplate(
  websiteUrl: string,
  schema: Record<string, unknown>,
  instructions: string
): string {
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

  const fields = Object.entries(schema)
    .map(([key, value]) => {
      const pyType = inferPyType(value);
      return `    ${key}: ${pyType}`;
    })
    .join("\n");

  return `import json
import time
from dataclasses import dataclass, asdict
from playwright.sync_api import sync_playwright, Page, Browser

@dataclass
class ScrapedItem:
${fields || "    pass"}

CONFIG = {
    "start_url": "${websiteUrl}",
    "request_delay": 1.5,
    "max_pages": 10,
    "headless": True,
}


class ${className}Scraper:
    def __init__(self):
        self.browser: Browser | None = None
        self.page: Page | None = None
        self.results: list[ScrapedItem] = []
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

    def goto(self, url: str, retries: int = 3):
        for attempt in range(1, retries + 1):
            try:
                self.page.goto(url, wait_until="networkidle", timeout=30000)
                return
            except Exception:
                if attempt == retries:
                    raise
                time.sleep(attempt * 2)

    def extract_items(self) -> list[dict]:
        self.page.wait_for_load_state("domcontentloaded")
        items = self.page.evaluate("""() => {
            const containers = Array.from(
                document.querySelectorAll(
                    "article, [class*='card'], [class*='item'], [class*='product'], " +
                    "[class*='result'], [class*='listing'], li, tr"
                )
            ).filter(el => el.children.length > 0 && el.textContent.trim().length > 0);
            return containers.map(c => ({ text: c.textContent.trim().slice(0, 500) }));
        }""")
        return items

    def get_next_page_url(self) -> str | None:
        return self.page.evaluate("""() => {
            const link = document.querySelector(
                "a[rel='next'], a[aria-label*='next' i], a[class*='next'], " +
                ".pagination a:last-child, [class*='pagination'] a:last-child"
            );
            return link ? link.href : null;
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
            items = self.extract_items()
            print(f"[Scraper] Extracted {len(items)} item(s) from page {page_num}")
            self.results.extend(items)

            current_url = self.get_next_page_url()
            if current_url and page_num < CONFIG["max_pages"]:
                time.sleep(CONFIG["request_delay"])

        if self.intercepted_data:
            print(f"[Scraper] Captured {len(self.intercepted_data)} API response(s)")

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
        print(json.dumps(data, indent=2, default=str))
    finally:
        scraper.close()


if __name__ == "__main__":
    main()
`;
}

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

interface AuthCredentials {
  email?: string;
  password?: string;
  token?: string;
  cookies?: string;
}

export function generateDataApiTemplate(
  websiteUrl: string,
  schema: Record<string, unknown>,
  instructions: string,
  credentials?: AuthCredentials
): string {
  const schemaStr = JSON.stringify(schema, null, 2);
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
  email: process.env.AUTH_EMAIL ?? "${credentials?.email ?? ""}",
  password: process.env.AUTH_PASSWORD ?? "",
  token: process.env.AUTH_TOKEN ?? "${credentials?.token ?? ""}",
  cookies: process.env.AUTH_COOKIES ?? "${credentials?.cookies ?? ""}",
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
      const cookieParts = AUTH.cookies.split(";").map((c) => {
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

export function generateDataApiPyTemplate(
  websiteUrl: string,
  schema: Record<string, unknown>,
  instructions: string,
  credentials?: AuthCredentials
): string {
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
    "email": os.environ.get("AUTH_EMAIL", "${credentials?.email ?? ""}"),
    "password": os.environ.get("AUTH_PASSWORD", ""),
    "token": os.environ.get("AUTH_TOKEN", "${credentials?.token ?? ""}"),
    "cookies": os.environ.get("AUTH_COOKIES", "${credentials?.cookies ?? ""}"),
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
