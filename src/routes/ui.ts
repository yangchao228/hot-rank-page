import { Hono } from "hono";
import fs from "node:fs/promises";
import path from "node:path";

const publicDir = path.join(process.cwd(), "public");

async function readPublicFile(fileName: string): Promise<string> {
  return fs.readFile(path.join(publicDir, fileName), "utf8");
}

export function createUiRouter(): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const html = await readPublicFile("index.html");
    return c.html(html);
  });

  app.get("/app.js", async (c) => {
    const js = await readPublicFile("app.js");
    c.header("content-type", "application/javascript; charset=utf-8");
    return c.body(js);
  });

  app.get("/styles.css", async (c) => {
    const css = await readPublicFile("styles.css");
    c.header("content-type", "text/css; charset=utf-8");
    return c.body(css);
  });

  return app;
}
