import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "web", "src");
const en = JSON.parse(fs.readFileSync(path.join(root, "i18n", "en.json"), "utf8"));

function sources(dir = root) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "i18n" ? [] : sources(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}
const files = sources().map((f) => ({ f, text: fs.readFileSync(f, "utf8") }));
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

test("every i18n key used in code exists in en.json", () => {
  const used = new Set();
  for (const { text } of files) {
    for (const m of stripComments(text).matchAll(/\b(?:t|plural)\(\s*"([^"]+)"/g)) used.add(m[1]);
    // keys held in lookup tables / constants: "word.word" literals that look like keys
    for (const m of stripComments(text).matchAll(/"([a-z][A-Za-z]*(?:\.[A-Za-z]+)+)"/g)) if (m[1] in en || `${m[1]}.one` in en) used.add(m[1]);
  }
  const missing = [...used].filter((k) => !(k in en) && !(`${k}.one` in en && `${k}.other` in en));
  assert.deepEqual(missing, []);
});

test("en.json has no unused keys", () => {
  const all = files.map((x) => stripComments(x.text)).join("\n");
  const unused = Object.keys(en).filter((k) => {
    const base = k.replace(/\.(one|other)$/, "");
    return !all.includes(`"${k}"`) && !all.includes(`"${base}"`);
  });
  assert.deepEqual(unused, []);
});

test("plural keys come in .one/.other pairs", () => {
  for (const k of Object.keys(en)) {
    if (k.endsWith(".one")) assert.ok(`${k.slice(0, -4)}.other` in en, `${k} needs .other`);
  }
});

test("components contain no literal user-visible English text", () => {
  const offenders = [];
  for (const { f, text } of files) {
    if (!f.endsWith(".tsx")) continue;
    const src = stripComments(text);
    // text between tags, e.g. <p>Hello</p> (ignores {expressions}, symbols and arrows)
    for (const m of src.matchAll(/<[A-Za-z][^<>{}]*>\s*([A-Za-z][A-Za-z ,.'!?-]{1,}?)\s*<\//g)) offenders.push(`${path.relative(root, f)}: ${m[1]}`);
    // literal text attributes
    for (const m of src.matchAll(/\b(?:aria-label|placeholder|title|alt)="([^"{]+)"/g)) offenders.push(`${path.relative(root, f)}: ${m[0]}`);
  }
  assert.deepEqual(offenders, []);
});

test("every placeholder used in a message is a known variable name", () => {
  for (const [k, v] of Object.entries(en)) for (const m of v.matchAll(/\{(\w+)\}/g)) assert.match(m[1], /^(n|day|reason|when|who|title|date|count|done)$/, `${k}: {${m[1]}}`);
});
