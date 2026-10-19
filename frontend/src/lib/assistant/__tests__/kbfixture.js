/**
 * ایندکس دانش برای آزمون‌ها — همان ایندکسی که مرجعِ پایتونی با آن ساخته شده.
 *
 * ساختش با خودِ ایندکس‌ساز پایتونی است تا هر دو طرف آزمون همسانی دقیقاً یک
 * داده ببینند. KAVOSH_TEST_INDEX اجازه می‌دهد ایندکسِ از پیش ساخته را بدهید.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sqlite3InitModule from "@sqlite.org/sqlite-wasm";

const here = path.dirname(fileURLToPath(import.meta.url));
const backend = path.resolve(here, "../../../../../backend");

function buildIndex() {
  if (process.env.KAVOSH_TEST_INDEX) return process.env.KAVOSH_TEST_INDEX;
  const out = path.join(mkdtempSync(path.join(tmpdir(), "kavosh-kb-")), "kb.sqlite");
  const python = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
  execFileSync(python, ["-m", "core.indexer", "--kb", "kb", "--out", out], {
    cwd: backend, stdio: "ignore",
  });
  return out;
}

export async function openIndex() {
  const sqlite3 = await sqlite3InitModule({ print: () => {}, printErr: () => {} });
  const bytes = new Uint8Array(readFileSync(buildIndex()));
  const db = new sqlite3.oo1.DB();
  const pointer = sqlite3.wasm.allocFromTypedArray(bytes);
  db.checkRc(sqlite3.capi.sqlite3_deserialize(
    db.pointer, "main", pointer, bytes.length, bytes.length,
    sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE,
  ));
  return {
    sqlite3,
    db,
    all: (sql, bind = []) => db.exec({ sql, bind, rowMode: "object", returnValue: "resultRows" }),
  };
}
