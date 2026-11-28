import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, sep } from "node:path";

const sourceRoot = resolve(process.cwd(), "src") + sep;

export async function load(url, context, nextLoad) {
  if (url.startsWith("file:")) {
    const filename = fileURLToPath(url);

    if (
      filename.startsWith(sourceRoot) &&
      filename.endsWith(".js")
    ) {
      return {
        format: "module",
        shortCircuit: true,
        source: await readFile(filename, "utf8")
      };
    }
  }

  return nextLoad(url, context);
}
