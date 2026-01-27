import { readFile, readdir } from "node:fs/promises";
import { join, extname } from "node:path";
import { parseHTML } from "linkedom";
import { parseDocumentToIr, compactIrDocument } from "@hytde/parser";

async function collectHtmlFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const next = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectHtmlFiles(next)));
      continue;
    }
    if (entry.isFile() && extname(entry.name) === ".html") {
      files.push(next);
    }
  }
  return files;
}

function byteSize(value) {
  return Buffer.byteLength(JSON.stringify(value));
}

async function main() {
  const root = join(process.cwd(), "design", "samples");
  const files = await collectHtmlFiles(root);
  if (files.length === 0) {
    console.log("No HTML files found under design/samples.");
    return;
  }
  let totalVerbose = 0;
  let totalCompact = 0;
  for (const file of files) {
    const html = await readFile(file, "utf8");
    const { document } = parseHTML(html);
    const ir = parseDocumentToIr(document);
    const compact = compactIrDocument(ir);
    const verboseSize = byteSize(ir);
    const compactSize = byteSize(compact);
    totalVerbose += verboseSize;
    totalCompact += compactSize;
    const ratio = verboseSize === 0 ? 0 : (compactSize / verboseSize) * 100;
    console.log(`${file}: ${verboseSize} -> ${compactSize} bytes (${ratio.toFixed(1)}%)`);
  }
  const totalRatio = totalVerbose === 0 ? 0 : (totalCompact / totalVerbose) * 100;
  console.log(`Total: ${totalVerbose} -> ${totalCompact} bytes (${totalRatio.toFixed(1)}%)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
