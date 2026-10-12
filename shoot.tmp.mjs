import { chromium } from "playwright";
import path from "node:path";

const file = "file:///" + path.resolve("lockup-preview.html").replace(/\\/g, "/");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 400, height: 160 } });
await page.goto(file);
await page.screenshot({ path: "lockup-preview.png" });
await browser.close();
console.log("done");
