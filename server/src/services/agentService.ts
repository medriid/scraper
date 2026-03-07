import { Response } from "express";
import { chatCompletion, streamCompletion } from "./aiService.js";
import { generateApiFileTemplate } from "../templates/apiTemplate.js";
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
  res: Response
): Promise<void> {
  const steps: AgentStep[] = [];

  const emit = (step: AgentStep) => {
    steps.push(step);
    sendSSE(res, "step", step);
  };

  try {
    // ── Step 1: Analyse the website ──────────────────────────────────────────
    emit({
      type: "browsing",
      message: "Analysing target website",
      detail: `Fetching structure for ${websiteUrl}…`,
    });

    await sleep(400);

    const analysisPrompt = `You are an expert web scraping engineer. Your job is to analyse a website and figure out how to write a TypeScript Playwright script that, when executed, will fetch and extract all the required data from that website.

Website URL: ${websiteUrl}
User Instructions: ${instructions}

Analyse the website and provide:
1. What type of data this website contains (e-commerce, news, directory, social, API-backed, etc.)
2. The likely HTML structure — repeating containers (cards, list items, table rows, article elements), key CSS selectors and data attributes that the scraper script should target
3. Anti-scraping measures to handle in the script (rate limiting, JS rendering, CAPTCHAs, auth walls, etc.)
4. Pagination strategy the script should implement (numbered pages, infinite scroll, "load more" button, cursor-based API, etc.)
5. Whether the site uses server-side rendering or client-side rendering (important for deciding wait strategies in Playwright)

Be specific and technical. The output of this analysis will be used to write a Playwright TypeScript scraper script.`;

    emit({
      type: "thinking",
      message: "AI analysing website structure",
      detail: "Processing website type and data patterns…",
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

    // ── Step 2: Generate JSON Schema ─────────────────────────────────────────
    emit({
      type: "thinking",
      message: "Generating suggested JSON schema",
      detail: "Inferring data structure from instructions and website type…",
    });

    const schemaPrompt = `Based on this website and instructions, generate a JSON schema that describes each record the scraper script will extract.

Website URL: ${websiteUrl}
Instructions: ${instructions}
Analysis: ${analysis.slice(0, 500)}

The schema represents a single extracted record as TypeScript would model it.
Return ONLY a valid JSON object (no markdown, no explanation). Use camelCase field names. Include all fields the script should extract.
Example fields: title, url, price, description, imageUrl, date, author, rating, category, etc.
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

    // ── Step 3: Refine the prompt ─────────────────────────────────────────────
    emit({
      type: "refining",
      message: "Refining scraping prompt",
      detail: "Optimising instructions for maximum accuracy…",
    });

    const refinePrompt = `You are a senior TypeScript developer specialising in web scraping. Your task is to write a precise technical specification for a scraper SCRIPT.

The script — when executed by the user — must autonomously fetch all required data from the target website. The script itself does the fetching; the user just runs it.

Original URL: ${websiteUrl}
Original instructions: ${instructions}
Identified data schema: ${JSON.stringify(schema, null, 2)}

Write a detailed technical specification (not JSON) covering:
1. Exact data fields to extract, with notes on where each field lives in the HTML/DOM (element tags, class names, data attributes, aria labels)
2. Navigation flow: starting URL, how to discover all pages/items (pagination, infinite scroll, link following)
3. Handling of dynamic content: when to wait for network idle vs DOM events, specific selectors to wait for before extracting
4. Error handling: retry logic, timeouts, graceful handling of missing fields
5. Rate limiting: delay strategy between requests to avoid bans
6. Output: how results should be structured and written (console JSON, file, etc.)

This specification will be handed directly to the TypeScript code generator.`;

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

    // ── Step 4: Generate the TypeScript API file ──────────────────────────────
    emit({
      type: "building",
      message: "Building TypeScript scraper API",
      detail: "Generating production-ready .ts file…",
    });

    await sleep(500);

    const baseFile = generateApiFileTemplate(websiteUrl, schema, instructions, refinedPrompt);

    // Ask AI to enhance and customise the file
    const enhancePrompt = `You are a senior TypeScript developer. Your task is to write a complete, production-ready TypeScript SCRIPT that, when executed with \`npx ts-node scraper.ts\` or compiled and run with Node.js, will automatically fetch and extract all required data from the target website.

IMPORTANT: The script must do all the fetching itself — it navigates to the website, handles pagination, waits for content, extracts data, and outputs results. The user just runs the script.

Website: ${websiteUrl}
Instructions: ${instructions}
Data schema: ${JSON.stringify(schema, null, 2)}
Technical specification:
${refinedPrompt}

Base script template to enhance:
\`\`\`typescript
${baseFile}
\`\`\`

Requirements for the enhanced script:
1. Replace the generic CSS selectors in the base template with accurate, site-specific selectors inferred from the website type and schema
2. Implement the correct pagination strategy (numbered pages, infinite scroll detection, "load more" button clicking, or API cursor)
3. Add proper waits for dynamic content (waitForSelector, waitForNetworkIdle, etc.) before extracting data
4. Implement retry logic with exponential backoff for failed requests
5. Add configurable delay between page loads (default 1–2 seconds) to be respectful
6. Add full TypeScript types matching the schema exactly
7. Output extracted data as formatted JSON to stdout so results can be piped or redirected
8. Keep all existing comments and class structure — just enhance the implementation

Return ONLY the complete TypeScript source code with no markdown fences.`;

    let apiFileContent = baseFile;
    const streamParts: string[] = [];

    emit({
      type: "generating",
      message: "Streaming TypeScript code",
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
        // Strip markdown fences if AI added them
        apiFileContent = enhanced.replace(/^```(?:typescript|ts)?\n?/m, "").replace(/\n?```$/m, "");
      }
    } catch (err) {
      // Fall back to base template if streaming fails
      console.warn("Stream failed, using base template:", err);
    }

    if (sessionId) {
      await updateSession(sessionId, { generated_api_file: apiFileContent });
    }

    emit({
      type: "complete",
      message: "Scraper API file ready",
      detail: `${apiFileContent.split("\n").length} lines of TypeScript generated`,
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
