import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";

/** Folders of public/ whose files the loading bar measures. */
const MEASURED = ["models", "skies"];

/** The size of every file the walkthrough downloads, unpacked, by its address. */
function sizes(): Record<string, number> {
  const found: Record<string, number> = {};
  for (const folder of MEASURED) {
    for (const file of readdirSync(join("public", folder))) {
      const stats = statSync(join("public", folder, file));
      if (stats.isFile()) found[`${folder}/${file}`] = stats.size;
    }
  }
  return found;
}

/**
 * Serves sizes.json beside the page, so the loading bar knows how much is
 * coming before it arrives. Servers such as GitHub Pages say only how big a
 * file is once compressed, while what arrives is counted unpacked.
 */
function fileSizes(): Plugin {
  return {
    name: "file-sizes",
    configureServer(server) {
      server.middlewares.use("/sizes.json", (_request, response) => {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify(sizes()));
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "sizes.json", source: JSON.stringify(sizes()) });
    },
  };
}

export default defineConfig({
  // Relative paths so the page works under /walkthroughlab/ on GitHub Pages.
  base: "./",
  plugins: [fileSizes()],
  build: {
    // The lamp calculator for authors is a page of its own beside the walkthrough.
    rolldownOptions: { input: ["index.html", "lamps.html"] },
  },
});
