import type { Plugin } from "vite";

function stripDummy(html: string): string {
  const removedElements = html.replace(
    /<([a-zA-Z0-9-]+)([^>]*?)\s+hy-dummy(=["'][^"']*["'])?([^>]*)>([\s\S]*?)<\/\1>/g,
    ""
  );

  return removedElements.replace(/\s+hy-dummy(=["'][^"']*["'])?/g, "");
}

function precompileHtml(html: string): string {
  // Placeholder for the precompile pipeline.
  return html;
}

export default function hyTde(): Plugin {
  return {
    name: "hytde",
    enforce: "pre",
    transformIndexHtml(html) {
      const withoutDummy = stripDummy(html);
      return precompileHtml(withoutDummy);
    }
  };
}
