/**
 * Distiller — converts raw HTML into semantic Markdown for LLM consumption.
 * Strips noise (scripts, styles, nav, ads, footers) and extracts main content.
 * Also provides token estimation and chunking utilities.
 */

// ─── Noise tags to strip entirely ─────────────────────────────────────────────
const STRIP_TAGS = new Set([
  "script", "style", "noscript", "iframe", "frame", "object", "embed",
  "svg", "canvas", "video", "audio", "nav", "header", "footer",
  "aside", "form", "button", "select", "option", "input", "textarea",
  "label", "fieldset", "legend", "details", "summary", "dialog",
  "menu", "menuitem", "ins", "del",
]);

// ─── Noise class/id patterns ──────────────────────────────────────────────────
const NOISE_PATTERNS = [
  /\bad[-_]?\b/i, /\bads[-_]?\b/i, /\badvert/i, /\bsponsored/i,
  /\bpopup/i, /\bmodal/i, /\boverlay/i, /\bbanner/i, /\bcookie/i,
  /\btoast/i, /\bnotif/i, /\bnewsletter/i, /\bsubscribe/i,
  /\bcomment/i, /\bsidebar/i, /\brelated/i, /\brecommended/i,
  /\bnavbar/i, /\bnav[-_]/i, /\bfooter/i, /\bheader/i,
  /\bsocial/i, /\bshare[-_]/i, /\bfacebook/i, /\btwitter/i,
];

function isNoisyElement(tag: string, cls: string, id: string): boolean {
  if (STRIP_TAGS.has(tag.toLowerCase())) return true;
  const combined = (cls + " " + id).toLowerCase();
  return NOISE_PATTERNS.some((p) => p.test(combined));
}

// ─── Simple HTML parser ────────────────────────────────────────────────────────

interface HtmlNode {
  type: "element" | "text";
  tag?: string;
  attrs?: Record<string, string>;
  children?: HtmlNode[];
  text?: string;
}

function unescapeHtml(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

function parseAttrs(attrStr: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /(\w[\w-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+)))?/g;
  let m;
  while ((m = re.exec(attrStr)) !== null) {
    attrs[m[1]] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return attrs;
}

/**
 * Convert HTML to clean semantic Markdown.
 */
export function distillHtml(html: string): string {
  // Quick pre-clean: remove doctype, comments
  const cleaned = html
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\s*head\b[\s\S]*?<\/head\s*>/gi, "")
    .replace(/<\s*(script|style|noscript|iframe|svg)[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .trim();

  const md = htmlToMarkdown(cleaned);

  // Post-process: remove excessive blank lines
  return md
    .replace(/\n{4,}/g, "\n\n\n")
    .replace(/\t/g, " ")
    .trim();
}

function htmlToMarkdown(html: string): string {
  const lines: string[] = [];
  let i = 0;
  const len = html.length;
  const tagStack: string[] = [];

  function getAttr(attrs: Record<string, string>, ...names: string[]): string {
    for (const n of names) {
      if (attrs[n]) return attrs[n];
    }
    return "";
  }

  while (i < len) {
    if (html[i] === "<") {
      // Find end of tag
      const end = html.indexOf(">", i);
      if (end === -1) { i++; continue; }

      const tagContent = html.slice(i + 1, end);
      i = end + 1;

      // Self-closing or closing
      const isClosing = tagContent.startsWith("/");
      const isSelfClosing = tagContent.endsWith("/");

      const tagBody = isClosing ? tagContent.slice(1).trim() : tagContent.replace(/\/$/, "").trim();
      const spaceIdx = tagBody.search(/\s/);
      const tag = (spaceIdx === -1 ? tagBody : tagBody.slice(0, spaceIdx)).toLowerCase();
      const attrStr = spaceIdx === -1 ? "" : tagBody.slice(spaceIdx + 1);
      const attrs = parseAttrs(attrStr);

      const cls = getAttr(attrs, "class");
      const id = getAttr(attrs, "id");

      if (STRIP_TAGS.has(tag) || isNoisyElement(tag, cls, id)) {
        if (!isClosing && !isSelfClosing) {
          tagStack.push(tag);
        } else if (isClosing && tagStack.length > 0 && tagStack[tagStack.length - 1] === tag) {
          tagStack.pop();
        }
        continue;
      }

      if (tagStack.length > 0) continue; // Inside stripped element

      if (isClosing) continue; // Most closing tags don't need action

      switch (tag) {
        case "h1": lines.push("\n# "); break;
        case "h2": lines.push("\n## "); break;
        case "h3": lines.push("\n### "); break;
        case "h4": lines.push("\n#### "); break;
        case "h5": lines.push("\n##### "); break;
        case "h6": lines.push("\n###### "); break;
        case "p": case "div": case "section": case "article": case "main":
          lines.push("\n\n"); break;
        case "br": lines.push("\n"); break;
        case "li": lines.push("\n- "); break;
        case "td": case "th": lines.push(" | "); break;
        case "tr": lines.push("\n"); break;
        case "a": {
          const href = getAttr(attrs, "href");
          if (href && href.startsWith("http")) {
            lines.push(`[`);
          }
          break;
        }
        case "img": {
          const alt = getAttr(attrs, "alt");
          const src = getAttr(attrs, "src");
          if (alt) lines.push(`![${alt}](${src})`);
          break;
        }
        case "strong": case "b": lines.push("**"); break;
        case "em": case "i": lines.push("_"); break;
        case "code": lines.push("`"); break;
        case "pre": lines.push("\n```\n"); break;
        case "blockquote": lines.push("\n> "); break;
        case "hr": lines.push("\n---\n"); break;
        case "span": case "label": break;
        default: break;
      }
    } else {
      // Text node
      if (tagStack.length > 0) { i++; continue; }

      const end = html.indexOf("<", i);
      const text = end === -1 ? html.slice(i) : html.slice(i, end);
      i = end === -1 ? len : end;

      const decoded = unescapeHtml(text).replace(/\s+/g, " ");
      if (decoded.trim()) {
        lines.push(decoded);
      }
    }
  }

  return lines.join("");
}

// ─── Token estimation ─────────────────────────────────────────────────────────

/**
 * Rough token count (1 token ≈ 4 chars for English text).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ─── Text chunker ─────────────────────────────────────────────────────────────

const MAX_CHUNK_TOKENS = 8000;

/**
 * Splits markdown text into chunks of ≤ maxTokens tokens,
 * trying to split on section headers (# lines) or paragraphs.
 */
export function chunkText(text: string, maxTokens = MAX_CHUNK_TOKENS): string[] {
  if (estimateTokens(text) <= maxTokens) return [text];

  // Try to split on markdown headers first
  const sections = text.split(/(?=\n#{1,3} )/);
  if (sections.length > 1) {
    return mergeChunks(sections, maxTokens);
  }

  // Fall back to paragraph splits
  const paragraphs = text.split(/\n{2,}/);
  return mergeChunks(paragraphs, maxTokens);
}

function mergeChunks(parts: string[], maxTokens: number): string[] {
  const chunks: string[] = [];
  let current = "";
  let currentTokens = 0;

  for (const part of parts) {
    const partTokens = estimateTokens(part);
    if (currentTokens + partTokens > maxTokens && current) {
      chunks.push(current.trim());
      current = part;
      currentTokens = partTokens;
    } else {
      current += (current ? "\n\n" : "") + part;
      currentTokens += partTokens;
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

// ─── Markdown extractor from HTML ─────────────────────────────────────────────

/**
 * Full pipeline: HTML → stripped markdown → optionally chunked.
 */
export function htmlToSemanticMarkdown(html: string): {
  markdown: string;
  tokens: number;
  chunks: string[];
} {
  const markdown = distillHtml(html);
  const tokens = estimateTokens(markdown);
  const chunks = tokens > 10_000 ? chunkText(markdown) : [markdown];
  return { markdown, tokens, chunks };
}
