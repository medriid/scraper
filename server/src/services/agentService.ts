import { Response } from "express";
import { crawl } from "./Crawler.js";
import { runArchitect, runExtractor, streamCoder } from "./LlmProvider.js";
import { chunkText, estimateTokens } from "./Distiller.js";
import { generateApiFileTemplate, generatePyFileTemplate, generateDataApiTemplate, generateDataApiPyTemplate } from "../templates/apiTemplate.js";
import { updateSession } from "./supabaseService.js";
import { randomUUID } from "crypto";

export interface AgentStep {
  type:
    | "thinking"
    | "browsing"
    | "fetching"
    | "analyzing"
    | "discovering"
    | "crawling"
    | "distilling"
    | "generating"
    | "refining"
    | "testing"
    | "validating"
    | "building"
    | "complete"
    | "error";
  message: string;
  detail?: string;
  data?: unknown;
}

export interface AuthCredentials {
  email?: string;
  password?: string;
  token?: string;
  cookies?: string;
}

// ─── In-memory Job Queue ──────────────────────────────────────────────────────

export type JobStatus = "queued" | "discovering" | "distilling" | "extracting" | "building" | "completed" | "failed";

export interface CrawlJob {
  jobId: string;
  status: JobStatus;
  progress: number;          // 0-100
  steps: AgentStep[];
  codeChunks: string[];
  result: {
    schema?: Record<string, unknown>;
    refinedPrompt?: string;
    analysis?: string;
    apiFile?: string;
  } | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  websiteUrl: string;
  instructions: string;
  modelId: string;
  language: string;
  extractionMode: string;
  credentials?: AuthCredentials;
  sessionId: string | null;
}

const jobQueue = new Map<string, CrawlJob>();
const JOB_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

// Cleanup old jobs every 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobQueue.entries()) {
    if (now - job.createdAt > JOB_TTL_MS) {
      jobQueue.delete(id);
    }
  }
}, 30 * 60 * 1000);

export function createJob(params: Omit<CrawlJob, "jobId" | "status" | "progress" | "steps" | "codeChunks" | "result" | "error" | "createdAt" | "updatedAt">): CrawlJob {
  const jobId = randomUUID();
  const job: CrawlJob = {
    jobId,
    status: "queued",
    progress: 0,
    steps: [],
    codeChunks: [],
    result: null,
    error: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...params,
  };
  jobQueue.set(jobId, job);
  return job;
}

export function getJob(jobId: string): CrawlJob | undefined {
  return jobQueue.get(jobId);
}

// ─── SSE helpers ─────────────────────────────────────────────────────────────

function sendSSE(res: Response, event: string, data: unknown): void {
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  res.write(`event: ${event}\ndata: ${payload}\n\n`);
}

// ─── JSON extraction ──────────────────────────────────────────────────────────

const JSON_OBJECT_RE = /\{[\s\S]*\}/;
const FALLBACK_SCHEMA: Record<string, unknown> = { title: "", url: "", description: "", image: "", tags: [] };

function extractJson(raw: string): Record<string, unknown> | null {
  try {
    const match = raw.match(JSON_OBJECT_RE);
    return match ? JSON.parse(match[0]) : null;
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Main Agent Session (SSE streaming) ──────────────────────────────────────

export async function runAgentSession(
  sessionId: string | null,
  websiteUrl: string,
  instructions: string,
  modelId: string,
  language: string,
  extractionMode: string,
  credentials: AuthCredentials | undefined,
  res: Response
): Promise<void> {
  const isTs = language !== "python";
  const langLabel = isTs ? "TypeScript" : "Python";
  const ext = isTs ? "ts" : "py";
  const isDataApi = extractionMode === "data_api";

  const emit = (step: AgentStep) => {
    sendSSE(res, "step", step);
  };

  // State accumulated during crawl
  let combinedMarkdown = "";
  let discoveredApis: Array<{ url: string; method: string; sampleData: string }> = [];
  let schema: Record<string, unknown> | null = null;
  let analysis = "";
  let crawlSummary = { pages: 0, tokens: 0, apis: 0 };

  try {
    // ── Phase 1: Crawl & Discover ───────────────────────────────────────────
    emit({ type: "discovering", message: "Launching Discovery Engine", detail: `Navigating ${websiteUrl}…` });

    const crawlResult = await crawl(
      websiteUrl,
      (progress) => {
        if (progress.phase === "discovering") {
          emit({ type: "discovering", message: progress.message, detail: progress.detail });
        } else if (progress.phase === "distilling") {
          emit({ type: "distilling", message: progress.message, detail: progress.detail });
        } else if (progress.phase === "error") {
          emit({ type: "browsing", message: progress.message, detail: progress.detail });
        }
      },
      { maxPages: 6, maxDepth: 2, autoExplore: true }
    );

    crawlSummary = {
      pages: crawlResult.pages.length,
      tokens: crawlResult.totalTokens,
      apis: crawlResult.siteMap.apiEndpoints.length,
    };
    combinedMarkdown = crawlResult.combinedMarkdown;
    discoveredApis = crawlResult.siteMap.apiEndpoints;

    emit({
      type: "crawling",
      message: `Discovery complete`,
      detail: `${crawlSummary.pages} page(s) · ${crawlSummary.tokens.toLocaleString()} tokens · ${crawlSummary.apis} API(s)`,
    });

    await sleep(200);

    // ── Phase 2: AI Architecture Analysis ──────────────────────────────────
    emit({ type: "analyzing", message: "Site Architect analyzing structure", detail: "Building extraction strategy…" });

    const apiSummary = discoveredApis.length > 0
      ? `\n\n## Intercepted JSON APIs (${discoveredApis.length}):\n` +
        discoveredApis.slice(0, 5).map((a) => `- [${a.method}] ${a.url}\n  ${a.sampleData.slice(0, 300)}`).join("\n")
      : "";

    // If markdown is huge, chunk it and analyse key sections
    const markdownTokens = estimateTokens(combinedMarkdown);
    let analysisContext = combinedMarkdown;
    if (markdownTokens > 12000) {
      const chunks = chunkText(combinedMarkdown, 10000);
      analysisContext = chunks.slice(0, 2).join("\n\n---\n\n");
      emit({ type: "distilling", message: "Token compression applied", detail: `${markdownTokens.toLocaleString()} tokens → chunked for parallel processing` });
    }

    const analysisPrompt = `You are an expert web scraping architect. Analyze the following site content and XHR APIs to determine the best data extraction strategy.

Target URL: ${websiteUrl}
User Request: ${instructions}
Mode: ${isDataApi ? "Authenticated Data API" : "Public Scraper"}
${isDataApi && credentials ? `Credentials available: ${Object.keys(credentials).filter((k) => credentials[k as keyof AuthCredentials]).join(", ")}` : ""}

## Site Content (Semantic Markdown)
${analysisContext.slice(0, 10000)}
${apiSummary}

Analyze and respond with:
1. **Site Type**: What kind of site is this?
2. **Key Data Elements**: What HTML patterns/selectors contain the requested data? (classes, IDs, semantic tags)
3. **Pagination**: How is pagination implemented? (query params, infinite scroll, load-more buttons?)
4. **API Endpoints**: Any XHR/JSON APIs that expose the data directly?
5. **Crawl Strategy**: List of URLs/patterns to crawl to get complete data
6. **Data Fields Mapping**: For each field the user wants, what HTML element contains it?
7. **Confidence**: How confident are you in the extraction strategy? What might be missing?

Be specific and reference exact class names or patterns you see in the content above.`;

    analysis = await runArchitect(modelId, [{ role: "user", content: analysisPrompt }], 4096);

    emit({
      type: "analyzing",
      message: "Architecture analysis complete",
      detail: analysis.slice(0, 300) + (analysis.length > 300 ? "…" : ""),
      data: { analysis },
    });

    await sleep(200);

    // ── Phase 3: Schema Generation (Data Surgeon) ───────────────────────────
    emit({ type: "thinking", message: "Data Surgeon extracting schema", detail: "Mapping fields with sub-second precision…" });

    const schemaPrompt = `Based on the site analysis below, generate a JSON schema for the data to extract.

Target: ${websiteUrl}
User Request: ${instructions}

## Site Analysis
${analysis.slice(0, 3000)}

## Raw Content Sample
${combinedMarkdown.slice(0, 4000)}

Return ONLY a valid JSON object representing one record with all fields the user requested.
Use camelCase field names. Include all data fields visible in the content.
No markdown, no explanation — pure JSON only.`;

    const schemaRaw = await runExtractor(modelId, [{ role: "user", content: schemaPrompt }], 1024);
    schema = extractJson(schemaRaw);

    if (!schema || Object.keys(schema).length < 2) {
      schema = { ...FALLBACK_SCHEMA };
    }

    emit({
      type: "generating",
      message: "Schema extracted",
      detail: `${Object.keys(schema).length} fields identified`,
      data: { schema },
    });

    if (sessionId) {
      await updateSession(sessionId, { suggested_schema: schema });
    }

    await sleep(200);

    // ── Phase 4: Technical Spec Refinement ──────────────────────────────────
    emit({ type: "refining", message: "Refining technical specification", detail: "Writing precise extraction blueprint…" });

    const specPrompt = `You are a senior ${langLabel} web scraping engineer. Write a concise technical specification for a production scraper.

Target: ${websiteUrl}
Request: ${instructions}
Mode: ${isDataApi ? "Data API (authenticated)" : "Web Scraper (public)"}
Schema: ${JSON.stringify(schema, null, 2)}

## Site Analysis
${analysis.slice(0, 2500)}

## Key API Endpoints Found
${discoveredApis.slice(0, 3).map((a) => `- ${a.url} → ${a.sampleData.slice(0, 200)}`).join("\n") || "None"}

Write the spec:
1. Exact CSS selectors / XPath for each schema field (from real analysis above)
2. Crawl loop: starting URL, link-following pattern, pagination strategy
3. API approach: if JSON APIs available, use them preferentially
4. Auth flow if applicable
5. Error handling and retry strategy

Keep it technical and precise. No generic advice.`;

    const refinedPrompt = await runArchitect(modelId, [{ role: "user", content: specPrompt }], 3000);

    emit({
      type: "refining",
      message: "Technical spec complete",
      detail: refinedPrompt.slice(0, 250) + "…",
      data: { refinedPrompt },
    });

    if (sessionId) {
      await updateSession(sessionId, { refined_prompt: refinedPrompt });
    }

    await sleep(200);

    // ── Phase 5: Code Generation (Streaming) ────────────────────────────────
    emit({
      type: "building",
      message: `Building ${langLabel} scraper`,
      detail: `Streaming production-ready .${ext} code…`,
    });

    const baseFile = isDataApi
      ? (isTs ? generateDataApiTemplate(websiteUrl, schema, instructions, credentials)
               : generateDataApiPyTemplate(websiteUrl, schema, instructions, credentials))
      : (isTs ? generateApiFileTemplate(websiteUrl, schema, instructions)
               : generatePyFileTemplate(websiteUrl, schema, instructions));

    const buildPrompt = `You are a senior ${langLabel} web scraping engineer. Write a complete, production-ready ${langLabel} script.

CRITICAL REQUIREMENTS:
- Output ONLY raw ${langLabel} code. No markdown fences, no explanation, no comments.
- Self-contained single file
- Use Playwright for browser automation
- Implement all error handling with try/catch and retries

## Target
URL: ${websiteUrl}
Instructions: ${instructions}
Mode: ${isDataApi ? "Authenticated Data API" : "Public Scraper"}
Schema: ${JSON.stringify(schema, null, 2)}

## Technical Specification (follow exactly)
${refinedPrompt.slice(0, 3000)}

## Site Content Context
${combinedMarkdown.slice(0, 6000)}

## API Endpoints Discovered
${discoveredApis.slice(0, 5).map((a) => `[${a.method}] ${a.url}\n  Sample: ${a.sampleData.slice(0, 400)}`).join("\n") || "None"}
${isDataApi && credentials ? `\n## Authentication\nAvailable: ${Object.keys(credentials).filter((k) => credentials[k as keyof AuthCredentials]).join(", ")}` : ""}

## Code Structure Reference
${baseFile.split("\n").slice(0, 50).join("\n")}

## Requirements
1. Real selectors from the analysis above — no generic .item, .title placeholders
2. Crawl strategy: ${isDataApi ? "authenticate first, then extract user data" : "paginate through listings, follow content links"}
3. Intercept page.on('response') to capture JSON APIs
4. Output: JSON file + stdout { total_items, scraped_at, source_url, items }
5. ${langLabel === "TypeScript" ? "Strict TypeScript, import playwright, class-based" : "Python type hints, playwright.sync_api, class-based"}
6. Deduplication by URL/ID
7. Retry logic: 3 attempts per page, exponential backoff
8. No comments in output code

Write the COMPLETE file now:`;

    const streamParts: string[] = [];

    emit({ type: "generating", message: `Streaming ${langLabel} code`, detail: "Writing production scraper…" });

    try {
      for await (const chunk of streamCoder(modelId, [{ role: "user", content: buildPrompt }], 16384)) {
        streamParts.push(chunk);
        sendSSE(res, "code_chunk", { chunk });
      }
    } catch (err) {
      console.warn("Stream failed, using base template:", err);
    }

    let apiFileContent = baseFile;
    if (streamParts.length > 0) {
      let enhanced = streamParts.join("");
      enhanced = enhanced
        .replace(/^```(?:typescript|ts|python|py|javascript|js)?\s*\n?/gm, "")
        .replace(/\n?```\s*$/gm, "")
        .trim();
      if (enhanced.length > 500) {
        apiFileContent = enhanced;
      }
    }

    if (sessionId) {
      await updateSession(sessionId, { generated_api_file: apiFileContent });
    }

    emit({
      type: "complete",
      message: `${isDataApi ? "Data API extractor" : "Web scraper"} ready`,
      detail: `${apiFileContent.split("\n").length} lines · ${crawlSummary.pages} pages crawled · ${crawlSummary.apis} APIs discovered`,
      data: {
        apiFile: apiFileContent,
        schema,
        refinedPrompt,
        analysis,
      },
    });

    sendSSE(res, "done", { sessionId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    emit({ type: "error", message: "Agent session failed", detail: message });
    sendSSE(res, "error", { message });
  } finally {
    res.end();
  }
}

// ─── Background job runner (for /crawl endpoint) ─────────────────────────────

export async function runJobInBackground(jobId: string): Promise<void> {
  const job = jobQueue.get(jobId);
  if (!job) return;

  const isTs = job.language !== "python";
  const langLabel = isTs ? "TypeScript" : "Python";
  const isDataApi = job.extractionMode === "data_api";

  const pushStep = (step: AgentStep) => {
    job.steps.push(step);
    job.updatedAt = Date.now();
  };

  const setStatus = (status: JobStatus, progress: number) => {
    job.status = status;
    job.progress = progress;
    job.updatedAt = Date.now();
  };

  let schema: Record<string, unknown> | null = null;
  let analysis = "";
  let refinedPrompt = "";

  try {
    setStatus("discovering", 5);
    pushStep({ type: "discovering", message: "Launching Discovery Engine", detail: job.websiteUrl });

    const crawlResult = await crawl(
      job.websiteUrl,
      (progress) => {
        pushStep({
          type: progress.phase === "distilling" ? "distilling" : "discovering",
          message: progress.message,
          detail: progress.detail,
        });
      },
      { maxPages: 6, maxDepth: 2, autoExplore: true }
    );

    const { combinedMarkdown, siteMap, totalTokens, pages } = crawlResult;

    setStatus("extracting", 30);
    pushStep({
      type: "crawling",
      message: "Discovery complete",
      detail: `${pages.length} page(s) · ${totalTokens.toLocaleString()} tokens · ${siteMap.apiEndpoints.length} API(s)`,
    });

    // Analysis
    setStatus("extracting", 45);
    pushStep({ type: "analyzing", message: "Site Architect analyzing structure" });

    const markdownTokens = estimateTokens(combinedMarkdown);
    let analysisContext = combinedMarkdown;
    if (markdownTokens > 12000) {
      const chunks = chunkText(combinedMarkdown, 10000);
      analysisContext = chunks.slice(0, 2).join("\n\n---\n\n");
      pushStep({ type: "distilling", message: "Token compression applied", detail: `${markdownTokens.toLocaleString()} tokens → chunked` });
    }

    const apiSummary = siteMap.apiEndpoints.length > 0
      ? "\n## APIs:\n" + siteMap.apiEndpoints.slice(0, 3).map((a) => `- ${a.url}`).join("\n")
      : "";

    analysis = await runArchitect(job.modelId, [{
      role: "user",
      content: `Analyze site for web scraping.\nTarget: ${job.websiteUrl}\nRequest: ${job.instructions}\n\n${analysisContext.slice(0, 10000)}${apiSummary}`,
    }], 4096);

    pushStep({ type: "analyzing", message: "Analysis complete", detail: analysis.slice(0, 200) + "…", data: { analysis } });

    // Schema
    setStatus("extracting", 60);
    const schemaRaw = await runExtractor(job.modelId, [{
      role: "user",
      content: `Generate JSON schema for: ${job.instructions}\nSite: ${job.websiteUrl}\n\nAnalysis:\n${analysis.slice(0, 2000)}\n\nContent:\n${combinedMarkdown.slice(0, 3000)}\n\nReturn ONLY JSON:`,
    }], 1024);

    schema = extractJson(schemaRaw) ?? { ...FALLBACK_SCHEMA };
    pushStep({ type: "generating", message: "Schema ready", detail: `${Object.keys(schema).length} fields`, data: { schema } });

    if (job.sessionId) {
      await updateSession(job.sessionId, { suggested_schema: schema });
    }

    // Spec
    setStatus("building", 70);
    pushStep({ type: "refining", message: "Writing technical spec" });

    refinedPrompt = await runArchitect(job.modelId, [{
      role: "user",
      content: `Write a technical scraping spec for ${langLabel}.\nURL: ${job.websiteUrl}\nSchema: ${JSON.stringify(schema)}\nAnalysis:\n${analysis.slice(0, 2000)}`,
    }], 2048);

    pushStep({ type: "refining", message: "Spec complete", data: { refinedPrompt } });

    if (job.sessionId) {
      await updateSession(job.sessionId, { refined_prompt: refinedPrompt });
    }

    // Code
    setStatus("building", 80);
    pushStep({ type: "building", message: `Building ${langLabel} scraper` });

    const baseFile = isDataApi
      ? (isTs ? generateDataApiTemplate(job.websiteUrl, schema, job.instructions, job.credentials)
               : generateDataApiPyTemplate(job.websiteUrl, schema, job.instructions, job.credentials))
      : (isTs ? generateApiFileTemplate(job.websiteUrl, schema, job.instructions)
               : generatePyFileTemplate(job.websiteUrl, schema, job.instructions));

    const buildMsg = [{ role: "user" as const, content: `Write complete ${langLabel} scraper.\nURL: ${job.websiteUrl}\nSpec:\n${refinedPrompt.slice(0, 2000)}\nContent:\n${combinedMarkdown.slice(0, 4000)}\nOutput only raw ${langLabel}:` }];

    let apiFileContent = baseFile;
    const streamParts: string[] = [];
    try {
      for await (const chunk of streamCoder(job.modelId, buildMsg, 16384)) {
        streamParts.push(chunk);
        job.codeChunks.push(chunk);
        job.updatedAt = Date.now();
      }
      let enhanced = streamParts.join("")
        .replace(/^```(?:typescript|ts|python|py)?\s*\n?/gm, "")
        .replace(/\n?```\s*$/gm, "")
        .trim();
      if (enhanced.length > 500) apiFileContent = enhanced;
    } catch (err) {
      console.warn("Job stream failed:", err);
    }

    if (job.sessionId) {
      await updateSession(job.sessionId, { generated_api_file: apiFileContent });
    }

    job.result = { schema: schema as Record<string, unknown>, refinedPrompt, analysis, apiFile: apiFileContent };
    setStatus("completed", 100);
    pushStep({
      type: "complete",
      message: "Scraper ready",
      detail: `${apiFileContent.split("\n").length} lines`,
      data: { apiFile: apiFileContent, schema, refinedPrompt, analysis },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown";
    job.error = message;
    setStatus("failed", 0);
    pushStep({ type: "error", message: "Job failed", detail: message });
  }
}
