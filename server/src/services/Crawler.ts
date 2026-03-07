/**
 * Crawler — Firecrawl-like Discovery Engine.
 *
 * Responsibilities:
 *   1. Fetch & distil pages using BrowserService + Distiller
 *   2. Map the site: discover internal links, XHR endpoints, hidden APIs
 *   3. Build a semantic knowledge base (markdown + link graph)
 *   4. Expose a crawl() function that streams progress events
 */

import { browseUrl } from "./BrowserService.js";
import type { InterceptedRequest } from "./BrowserService.js";
import { htmlToSemanticMarkdown } from "./Distiller.js";
import https from "https";
import http from "http";

export interface CrawlProgress {
  phase: "discovering" | "distilling" | "mapping" | "extracting" | "complete" | "error";
  message: string;
  detail?: string;
}

export interface DiscoveredApi {
  url: string;
  method: string;
  sampleData: string;
  isJsonApi: boolean;
}

export interface CrawledPage {
  url: string;
  title: string;
  markdown: string;
  tokens: number;
  links: string[];
  apis: DiscoveredApi[];
}

export interface SiteMap {
  root: string;
  pages: Array<{ url: string; title: string; depth: number }>;
  apiEndpoints: DiscoveredApi[];
  linkTree: Record<string, string[]>;
}

export interface CrawlResult {
  pages: CrawledPage[];
  siteMap: SiteMap;
  combinedMarkdown: string;
  totalTokens: number;
}

const MAX_PAGES = 8;
const MAX_DEPTH = 2;

function isSameDomain(a: string, b: string): boolean {
  try {
    return new URL(a).hostname === new URL(b).hostname;
  } catch {
    return false;
  }
}

function dedupeLinks(links: string[], base: string, visited: Set<string>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const link of links) {
    try {
      const u = new URL(link, base).href.split("#")[0].replace(/\/$/, "");
      if (!seen.has(u) && !visited.has(u) && isSameDomain(u, base)) {
        seen.add(u);
        result.push(u);
      }
    } catch {
      // ignore invalid URLs
    }
  }
  return result;
}

/** Simple HTTP fetch (no browser) for lightweight JSON endpoints */
async function httpFetch(url: string, timeoutMs = 10_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === "https:" ? https : http;
    const req = transport.get(
      url,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 Scrapex/1.0",
          Accept: "application/json,text/html,*/*",
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8").slice(0, 200_000)));
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
  });
}

/** Probe likely sitemap.xml or robots.txt for extra link discovery */
async function probeSiteEntryPoints(
  baseUrl: string
): Promise<string[]> {
  const base = new URL(baseUrl);
  const candidates = [
    `${base.origin}/sitemap.xml`,
    `${base.origin}/sitemap_index.xml`,
    `${base.origin}/robots.txt`,
  ];

  const discovered: string[] = [];
  for (const url of candidates) {
    try {
      const body = await httpFetch(url, 8000);
      // Extract URLs from sitemap XML or robots.txt
      const urlMatches = body.match(/<loc>(.*?)<\/loc>/g) ?? [];
      for (const m of urlMatches.slice(0, 30)) {
        const u = m.replace(/<\/?loc>/g, "").trim();
        if (u.startsWith("http")) discovered.push(u);
      }
      // robots.txt Sitemap: lines
      const sitemapLines = body.match(/^Sitemap:\s*(.+)$/gim) ?? [];
      for (const l of sitemapLines) {
        const u = l.replace(/^Sitemap:\s*/i, "").trim();
        if (u.startsWith("http")) discovered.push(u);
      }
    } catch {
      // ignore
    }
  }
  return discovered;
}

/**
 * Main crawl function. Crawls the target URL up to MAX_PAGES, distils HTML
 * into markdown, and collects site structure.
 *
 * @param url - Target URL to crawl
 * @param onProgress - Callback for real-time progress events
 * @param opts - Options
 */
export async function crawl(
  url: string,
  onProgress: (p: CrawlProgress) => void,
  opts: {
    maxPages?: number;
    maxDepth?: number;
    autoExplore?: boolean;
  } = {}
): Promise<CrawlResult> {
  const maxPages = opts.maxPages ?? MAX_PAGES;
  const maxDepth = opts.maxDepth ?? MAX_DEPTH;
  const autoExplore = opts.autoExplore ?? true;

  const visited = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [{ url, depth: 0 }];
  const pages: CrawledPage[] = [];
  const allApis: DiscoveredApi[] = [];
  const linkTree: Record<string, string[]> = {};

  // Probe site entry points for extra links
  onProgress({ phase: "discovering", message: "Probing site entry points…", detail: url });
  const entryLinks = await probeSiteEntryPoints(url).catch(() => [] as string[]);
  for (const l of entryLinks.slice(0, 5)) {
    queue.push({ url: l, depth: 1 });
  }

  while (queue.length > 0 && pages.length < maxPages) {
    const item = queue.shift()!;
    if (visited.has(item.url)) continue;
    visited.add(item.url);

    onProgress({
      phase: "discovering",
      message: `Crawling (${pages.length + 1}/${maxPages})`,
      detail: item.url,
    });

    try {
      const browse = await browseUrl(item.url, {
        autoExplore: autoExplore && item.depth === 0,
        timeout: 25_000,
        waitFor: "domcontentloaded",
      });

      onProgress({
        phase: "distilling",
        message: "Distilling page content",
        detail: browse.title || item.url,
      });

      const { markdown, tokens } = htmlToSemanticMarkdown(browse.html);

      // Collect intercepted APIs
      const pageApis: DiscoveredApi[] = [];
      for (const req of browse.interceptedRequests) {
        const api: DiscoveredApi = {
          url: req.url,
          method: req.method,
          sampleData: req.sampleData,
          isJsonApi: req.isJsonApi,
        };
        pageApis.push(api);
        if (!allApis.some((a) => a.url === req.url)) {
          allApis.push(api);
        }
      }

      const page: CrawledPage = {
        url: item.url,
        title: browse.title,
        markdown,
        tokens,
        links: browse.links.slice(0, 50),
        apis: pageApis,
      };
      pages.push(page);

      // Build link tree
      const childLinks = dedupeLinks(browse.links, url, visited);
      linkTree[item.url] = childLinks.slice(0, 20);

      // Enqueue children if within depth
      if (item.depth < maxDepth) {
        for (const childUrl of childLinks.slice(0, 6)) {
          queue.push({ url: childUrl, depth: item.depth + 1 });
        }
      }
    } catch (err) {
      onProgress({
        phase: "error",
        message: `Failed to crawl ${item.url}`,
        detail: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  const siteMap: SiteMap = {
    root: url,
    pages: pages.map((p, i) => ({ url: p.url, title: p.title, depth: i === 0 ? 0 : 1 })),
    apiEndpoints: allApis,
    linkTree,
  };

  // Combine markdown from all pages
  const combinedMarkdown = pages
    .map((p) => `## Page: ${p.url}\n### ${p.title || p.url}\n\n${p.markdown}`)
    .join("\n\n---\n\n");

  const totalTokens = pages.reduce((sum, p) => sum + p.tokens, 0);

  onProgress({
    phase: "complete",
    message: `Crawled ${pages.length} page(s)`,
    detail: `${totalTokens.toLocaleString()} tokens · ${allApis.length} API(s) discovered`,
  });

  return { pages, siteMap, combinedMarkdown, totalTokens };
}

/**
 * Map-only: quickly probe a site and return its link structure + API endpoints
 * without deep content extraction.
 */
export async function mapSite(
  url: string,
  onProgress: (p: CrawlProgress) => void
): Promise<SiteMap> {
  const result = await crawl(url, onProgress, { maxPages: 3, maxDepth: 1, autoExplore: false });
  return result.siteMap;
}
