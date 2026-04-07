import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const DEFAULT_DOCS_ROOT = path.resolve(
  process.cwd(),
  "../biztech-documentation/biztech-docs/src/app"
);
const DEFAULT_OUTPUT = path.resolve(
  process.cwd(),
  "services/bots/docsIndex.js"
);
const DEFAULT_BASE_URL = "https://bizwiki.vercel.app";

function parseArg(name, fallback) {
  const key = `--${name}`;
  const inline = process.argv.find((arg) => arg.startsWith(`${key}=`));
  if (inline) return inline.slice(key.length + 1);

  const idx = process.argv.indexOf(key);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];

  return fallback;
}

function normalizeSlashes(value) {
  return value.split(path.sep).join("/");
}

async function listMarkdownPages(dir) {
  const entries = await fs.readdir(dir, {
    withFileTypes: true
  });

  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listMarkdownPages(fullPath)));
      continue;
    }
    if (entry.isFile() && entry.name === "page.md") {
      files.push(fullPath);
    }
  }
  return files;
}

function routeFromFilePath(filePath, docsRoot) {
  const rel = normalizeSlashes(path.relative(docsRoot, filePath));
  if (rel === "page.md") return "/";
  if (rel.endsWith("/page.md")) {
    return `/${rel.replace(/\/page\.md$/, "")}`;
  }
  return null;
}

function parseFrontmatter(md) {
  const match = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return {
      frontmatter: "",
      body: md
    };
  }
  return {
    frontmatter: match[1],
    body: md.slice(match[0].length)
  };
}

function cleanTitle(rawTitle) {
  if (!rawTitle) return "";
  return rawTitle
    .trim()
    .replace(/^['"`]/, "")
    .replace(/['"`]$/, "")
    .trim();
}

function titleFromFrontmatter(frontmatter, fallbackTitle) {
  const titleMatch = frontmatter.match(/^\s*title:\s*(.+)\s*$/m);
  if (!titleMatch) return fallbackTitle;
  const cleaned = cleanTitle(titleMatch[1]);
  return cleaned || fallbackTitle;
}

function fallbackTitleFromRoute(route) {
  if (route === "/") return "Introduction";
  const part = route.split("/").filter(Boolean).at(-1) || "Page";
  return part
    .split("-")
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripMarkdown(markdown) {
  let text = markdown;

  // remove md tags
  text = text.replace(/\{%\s*\/?[^%]*%\}/g, " ");

  // keep code block content but remove fences/language markers
  text = text.replace(/```[a-zA-Z0-9_-]*\r?\n([\s\S]*?)```/g, (_, code) => {
    return `\n${code.trim()}\n`;
  });

  // markdown cleanup
  text = text.replace(/`([^`]+)`/g, "$1");
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1");
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");
  text = text.replace(/^\s*>+\s?/gm, "");
  text = text.replace(/^\s*[-*+]\s+/gm, "");
  text = text.replace(/^\s*\d+\.\s+/gm, "");
  text = text.replace(/^#{1,6}\s+/gm, "");
  text = text.replace(/^\s*\|?(?:\s*:?-+:?\s*\|)+\s*$/gm, " ");
  text = text.replace(/\|/g, " ");
  text = text.replace(/^---+\s*$/gm, " ");
  text = text.replace(/<[^>]+>/g, " ");

  text = decodeEntities(text);
  text = text.replace(/[ \t]+\n/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.replace(/[ \t]{2,}/g, " ");

  return text.trim();
}

function splitSections(body) {
  const lines = body.split(/\r?\n/);
  const sections = [];
  let heading = "Overview";
  let buffer = [];

  const flush = () => {
    const raw = buffer.join("\n").trim();
    if (raw) {
      sections.push({
        heading,
        raw
      });
    }
    buffer = [];
  };

  for (const line of lines) {
    const headingMatch = line.match(/^##+\s+(.*)\s*$/);
    if (headingMatch) {
      flush();
      heading = headingMatch[1].trim();
      continue;
    }
    buffer.push(line);
  }

  flush();
  return sections;
}

function splitOversizedChunk(text, maxChars) {
  if (text.length <= maxChars) return [text];

  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks = [];
  let current = "";

  for (const sentence of sentences) {
    const s = sentence.trim();
    if (!s) continue;
    const candidate = current ? `${current} ${s}` : s;
    if (candidate.length > maxChars && current) {
      chunks.push(current.trim());
      current = s;
      continue;
    }
    current = candidate;
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

function chunkSection(text, options = {}) {
  const maxChars = options.maxChars || 1200;
  const minChars = options.minChars || 350;

  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if (!current) {
      current = paragraph;
      continue;
    }

    const candidate = `${current}\n\n${paragraph}`;
    if (candidate.length > maxChars && current.length >= minChars) {
      chunks.push(current.trim());
      current = paragraph;
      continue;
    }

    current = candidate;
  }

  if (current.trim()) chunks.push(current.trim());

  return chunks
    .flatMap((chunk) => splitOversizedChunk(chunk, maxChars))
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length >= 120);
}

function normalizeTextForSearch(text) {
  return ` ${text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
}

async function main() {
  const docsRoot = path.resolve(parseArg("docs-root", DEFAULT_DOCS_ROOT));
  const outputPath = path.resolve(parseArg("out", DEFAULT_OUTPUT));
  const docsBaseUrl = parseArg("base-url", DEFAULT_BASE_URL).replace(
    /\/+$/,
    ""
  );

  const markdownFiles = await listMarkdownPages(docsRoot);
  const sortedFiles = markdownFiles.sort((a, b) => a.localeCompare(b));

  const docsChunks = [];

  for (const markdownFile of sortedFiles) {
    const route = routeFromFilePath(markdownFile, docsRoot);
    if (!route) continue;

    const raw = await fs.readFile(markdownFile, "utf8");
    const { frontmatter, body } = parseFrontmatter(raw);
    const fallbackTitle = fallbackTitleFromRoute(route);
    const pageTitle = titleFromFrontmatter(frontmatter, fallbackTitle);
    const sections = splitSections(body);

    for (const section of sections) {
      const cleaned = stripMarkdown(section.raw);
      if (!cleaned) continue;

      const chunks = chunkSection(cleaned);
      for (const content of chunks) {
        const id = `doc_${String(docsChunks.length + 1).padStart(5, "0")}`;
        const url = `${docsBaseUrl}${route}`;
        const searchText = normalizeTextForSearch(
          `${pageTitle}\n${section.heading}\n${content}\n${route}`
        );

        docsChunks.push({
          id,
          route,
          url,
          title: pageTitle,
          section: section.heading,
          content,
          searchText
        });
      }
    }
  }

  const generatedAt = new Date().toISOString();
  const output = `// This file is auto-generated by scripts/generateSlackDocsIndex.js
// Do not edit manually.
export const docsBaseUrl = ${JSON.stringify(docsBaseUrl)};
export const docsIndexGeneratedAt = ${JSON.stringify(generatedAt)};
export const docsChunkCount = ${docsChunks.length};
export const docsChunks = ${JSON.stringify(docsChunks)};
`;

  await fs.mkdir(path.dirname(outputPath), {
    recursive: true
  });
  await fs.writeFile(outputPath, output, "utf8");

  console.log(
    `Generated ${docsChunks.length} docs chunks from ${sortedFiles.length} pages -> ${outputPath}`
  );
}

main().catch((error) => {
  console.error("Failed to generate Slack docs index:", error);
  process.exit(1);
});
