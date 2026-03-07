import { Response } from "express";
import { chatCompletion, streamCompletion } from "./aiService.js";
import { generateApiFileTemplate, generatePyFileTemplate } from "../templates/apiTemplate.js";
import { updateSession } from "./supabaseService.js";

export interface AgentStep {
  type:
    | "thinking"
    | "browsing"
    | "analyzing"
    | "generating"
    | "refining"
    | "building"
    | "complete"
    | "error";
  message: string;
  detail?: string;
  data?: unknown;
}

function sendSSE(res: Response, event: string, data: unknown): void {
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  res.write(`event: ${event}\ndata: ${payload}\n\n`);
}

export async function runAgentSession(
  sessionId: string | null,
  websiteUrl: string,
  instructions: string,
  modelId: string,
  language: string,
  res: Response
): Promise<void> {
  const steps: AgentStep[] = [];
  const isTs = language !== "python";
  const langLabel = isTs ? "TypeScript" : "Python";
  const ext = isTs ? "ts" : "py";

  const emit = (step: AgentStep) => {
    steps.push(step);
    sendSSE(res, "step", step);
  };

  try {
    emit({
      type: "browsing",
      message: "Analysing target website",
      detail: `Fetching structure for ${websiteUrl}…`,
    });

    await sleep(400);

    const analysisPrompt = `You are an expert web scraping and reverse-engineering engineer. Your job is to analyse a website and figure out the best strategy to extract the required data.

Website URL: ${websiteUrl}
User Instructions: ${instructions}

Analyse the website and provide:
1. What type of data this website contains (e-commerce, news, directory, social, API-backed SPA, etc.)
2. Whether the site is likely backed by REST/GraphQL APIs — identify any XHR/fetch endpoints the frontend calls to load data (e.g. /api/*, /graphql, /_next/data/*, /wp-json/*, etc.). These are the most valuable targets because they return structured JSON directly.
3. If API endpoints exist, describe the probable request format (method, headers, query params, pagination tokens/cursors).
4. If no API is available, describe the HTML structure — repeating containers (cards, list items, table rows), key CSS selectors and data attributes the scraper should target.
5. Anti-scraping measures to handle (rate limiting, JS rendering, CAPTCHAs, auth walls).
6. Pagination strategy (numbered pages, infinite scroll, "load more" button, cursor-based API, offset params).
7. Whether the site uses SSR or CSR (important for deciding wait strategies).

IMPORTANT: Prioritise discovering and using API endpoints over HTML scraping. Most modern websites fetch data from internal APIs — intercepting those requests and calling the APIs directly yields cleaner, more reliable data than parsing HTML.

Be specific and technical. Do not include any comments in code snippets.`;

    emit({
      type: "thinking",
      message: "AI analysing website structure",
      detail: "Identifying API endpoints and data patterns…",
    });

    const analysis = await chatCompletion(modelId, [
      { role: "user", content: analysisPrompt },
    ], 0.3, 2048);

    emit({
      type: "analyzing",
      message: "Website analysis complete",
      detail: analysis.slice(0, 300) + (analysis.length > 300 ? "…" : ""),
      data: { analysis },
    });

    await sleep(300);

    emit({
      type: "thinking",
      message: "Generating suggested JSON schema",
      detail: "Inferring data structure from instructions and website type…",
    });

    const schemaPrompt = `Based on this website and instructions, generate a JSON schema that describes each record the scraper will extract.

Website URL: ${websiteUrl}
Instructions: ${instructions}
Analysis: ${analysis.slice(0, 500)}

The schema represents a single extracted record.
Return ONLY a valid JSON object (no markdown, no explanation). Use camelCase field names. Include all fields the script should extract.
Choose only fields that are relevant to this specific website and instructions.`;

    const schemaRaw = await chatCompletion(modelId, [
      { role: "user", content: schemaPrompt },
    ], 0.2, 1024);

    let schema: Record<string, unknown> = {};
    try {
      const jsonMatch = schemaRaw.match(/\{[\s\S]*\}/);
      schema = jsonMatch ? JSON.parse(jsonMatch[0]) : { title: "", url: "", description: "" };
    } catch {
      schema = { title: "", url: "", description: "" };
    }

    emit({
      type: "analyzing",
      message: "JSON schema generated",
      detail: `${Object.keys(schema).length} fields identified`,
      data: { schema },
    });

    if (sessionId) {
      await updateSession(sessionId, { suggested_schema: schema });
    }

    await sleep(300);

    emit({
      type: "refining",
      message: "Refining scraping prompt",
      detail: "Optimising instructions for maximum accuracy…",
    });

    const refinePrompt = `You are a senior ${langLabel} developer specialising in web scraping and API reverse-engineering. Write a precise technical specification for a scraper SCRIPT.

The script must autonomously fetch all required data from the target website. The user just runs it.

Original URL: ${websiteUrl}
Original instructions: ${instructions}
Identified data schema: ${JSON.stringify(schema, null, 2)}
Website analysis: ${analysis.slice(0, 800)}

Write a detailed technical specification covering:
1. Data extraction strategy — PREFER calling discovered API endpoints directly (using fetch/httpx) over HTML parsing. If the site loads data via XHR/fetch calls, the script should replicate those HTTP requests with the correct headers, params, and auth tokens. Only fall back to browser-based HTML extraction if no API is available.
2. For API-based extraction: exact endpoint URLs, HTTP method, required headers (User-Agent, Accept, Authorization/cookies), query parameters, and how to handle pagination (offset, cursor, page number).
3. For HTML-based extraction: exact data fields to extract, with notes on where each field lives in the DOM (element tags, class names, data attributes).
4. Navigation flow: starting URL, how to discover all pages/items.
5. Handling of dynamic content: when to use network interception (page.route / page.on("response")) to capture API responses versus direct DOM extraction.
6. Error handling: retry logic, timeouts, graceful handling of missing fields.
7. Rate limiting: delay strategy between requests.
8. Output: structured JSON to stdout.

Do not include comments in any code snippets. This specification will be handed directly to the code generator.`;

    const refinedPrompt = await chatCompletion(modelId, [
      { role: "user", content: refinePrompt },
    ], 0.4, 2048);

    emit({
      type: "refining",
      message: "Prompt refinement complete",
      detail: refinedPrompt.slice(0, 300) + (refinedPrompt.length > 300 ? "…" : ""),
      data: { refinedPrompt },
    });

    if (sessionId) {
      await updateSession(sessionId, { refined_prompt: refinedPrompt });
    }

    await sleep(300);

    emit({
      type: "building",
      message: `Building ${langLabel} scraper`,
      detail: `Generating production-ready .${ext} file…`,
    });

    await sleep(500);

    const baseFile = isTs
      ? generateApiFileTemplate(websiteUrl, schema, instructions)
      : generatePyFileTemplate(websiteUrl, schema, instructions);

    const enhancePrompt = `You are a senior ${langLabel} developer. Write a complete, production-ready ${langLabel} SCRIPT that extracts data from the target website.

CRITICAL RULES:
- Do NOT include any comments in the code. Zero comments, zero docstrings. The code must be completely clean.
- Do NOT wrap the output in markdown fences. Return ONLY raw source code.
- The script must do all fetching itself — it navigates, handles pagination, extracts data, and outputs JSON results. The user just runs it.

STRATEGY (in order of preference):
1. API-FIRST: If the analysis identified API endpoints the site uses to load data, call those endpoints directly using ${isTs ? "fetch()" : "httpx/requests"}. This is the preferred approach — it yields structured JSON without needing a browser.
2. NETWORK INTERCEPTION: If APIs require browser context (cookies, JS-generated tokens), use Playwright to navigate to the page and intercept network responses via ${isTs ? "page.on('response', ...)" : "page.on('response', ...)"} to capture the API data as it loads.
3. HTML SCRAPING: Only if no APIs are available, use Playwright to extract data from the DOM using CSS selectors.

Website: ${websiteUrl}
Instructions: ${instructions}
Data schema: ${JSON.stringify(schema, null, 2)}
Technical specification:
${refinedPrompt}

Base template to enhance:
\`\`\`${isTs ? "typescript" : "python"}
${baseFile}
\`\`\`

Requirements:
1. Replace generic selectors with accurate, site-specific logic inferred from the analysis
2. Implement the correct data fetching strategy (API calls > network interception > HTML parsing)
3. Implement proper pagination handling
4. Add retry logic with exponential backoff
5. Add configurable delay between requests (default 1-2 seconds)
6. ${isTs ? "Add full TypeScript types matching the schema" : "Add dataclass/TypedDict matching the schema"}
7. Output extracted data as formatted JSON to stdout
8. ABSOLUTELY NO COMMENTS anywhere in the code

Return ONLY the complete ${langLabel} source code.`;

    let apiFileContent = baseFile;
    const streamParts: string[] = [];

    emit({
      type: "generating",
      message: `Streaming ${langLabel} code`,
      detail: "AI writing your custom scraper…",
    });

    try {
      for await (const chunk of streamCompletion(
        modelId,
        [{ role: "user", content: enhancePrompt }],
        0.2,
        4096
      )) {
        streamParts.push(chunk);
        sendSSE(res, "code_chunk", { chunk });
      }
      const enhanced = streamParts.join("");
      if (enhanced.length > 500) {
        apiFileContent = enhanced.replace(/^```(?:typescript|ts|python|py)?\n?/m, "").replace(/\n?```$/m, "");
      }
    } catch (err) {
      console.warn("Stream failed, using base template:", err);
    }

    if (sessionId) {
      await updateSession(sessionId, { generated_api_file: apiFileContent });
    }

    emit({
      type: "complete",
      message: "Scraper file ready",
      detail: `${apiFileContent.split("\n").length} lines of ${langLabel} generated`,
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
    emit({
      type: "error",
      message: "Agent session failed",
      detail: message,
    });
    sendSSE(res, "error", { message });
  } finally {
    res.end();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
