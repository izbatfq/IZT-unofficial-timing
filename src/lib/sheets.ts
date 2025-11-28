import parseTimeToMs from "./time";

const PUB_BASE =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRBEbqTDNIY3wo-9dKVOmJ4pDqz1u7EDszLVajygCJ_cZz24mqSvcjQXmxf3AZCM5a1E9Ek3OWCyTZ6";

export const GIDS = {
  start: 108312925,
  finish: 1421679544,
  checkpoint: 2058435608,
  categories: [
    { key: "10K Umum Putra", gid: 1086522990 },
    { key: "10K Umum Putri", gid: 43400385 },
    { key: "10K TNI & POLRI Putra", gid: 1348751512 },
    { key: "10K Master Putra", gid: 1631566068 },
    { key: "10K Pelajar Putra", gid: 14027759 },
    { key: "5K FUN RUN", gid: 1779885351 },
  ],
};

const headerAliases: Record<string, string[]> = {
  epc: ["epc", "uid", "tag", "rfid", "chip epc", "epc code"],
  bib: ["bib", "no bib", "bib number", "race bib", "nomor bib", "no. bib"],
  name: ["nama lengkap", "full name", "name", "nama", "participant name"],
  gender: ["jenis kelamin", "gender", "sex", "jk"],
  category: ["kategori", "category", "kelas", "class"],
  times: [
    "times",
    "time",
    "timestamp",
    "start time",
    "finish time",
    "jam",
    "checkpoint time",
    "cp time",
  ],
};

function norm(s: string) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\n/g, " ")
    .trim();
}

function findColIndex(
  headers: string[],
  key: keyof typeof headerAliases
): number {
  const aliases = headerAliases[key].map(norm);
  const hs = headers.map(norm);
  for (let i = 0; i < hs.length; i++) {
    const h = hs[i];
    if (aliases.some((a) => h === a || h.includes(a))) return i;
  }
  return -1;
}

// ---- GViz fetch (SUPER ROBUST) ----
async function fetchGViz(gid: number): Promise<any[][]> {
  const url = `${PUB_BASE}/gviz/tq?gid=${gid}&tqx=out:json`;
  const res = await fetch(url);
  const text = await res.text();

  const match = text.match(
    /google\.visualization\.Query\.setResponse\(([\s\S]*)\);/
  );
  if (!match)
    throw new Error("GViz parse failed (sheet not published / no access)");

  const json = JSON.parse(match[1]);
  const table = json?.table || {};

  const cols: any[] = Array.isArray(table.cols) ? table.cols : [];
  const rows: any[] = Array.isArray(table.rows) ? table.rows : [];

  let headers = cols.map((c) => c?.label || c?.id || "");
  const values = rows.map((r) =>
    (r?.c || []).map((cell: any) => (cell ? cell.v : ""))
  );

  // if headers missing, use first row as header
  if (headers.length === 0 && values.length > 0) {
    headers = values[0].map((v: any) => String(v ?? ""));
    return [headers, ...values.slice(1)];
  }

  // if headers mostly empty, also use first row
  const emptyCount = headers.filter((h) => !norm(h)).length;
  if (
    headers.length > 0 &&
    emptyCount / headers.length > 0.6 &&
    values.length > 0
  ) {
    headers = values[0].map((v: any) => String(v ?? ""));
    return [headers, ...values.slice(1)];
  }

  return [headers, ...values];
}

// ---- CSV fallback ----
async function fetchCSV(gid: number): Promise<any[][]> {
  const url = `${PUB_BASE}/pub?gid=${gid}&single=true&output=csv`;
  const res = await fetch(url);
  const csv = await res.text();
  const lines = csv.split(/\r?\n/).filter(Boolean);
  return lines.map((l) =>
    l.split(",").map((x) => x.replace(/^"|"$/g, "").trim())
  );
}

// ---- unified fetch (safe fallback) ----
export async function fetchSheet(gid: number): Promise<any[][]> {
  try {
    const data = await fetchGViz(gid);
    if (!data || data.length === 0 || (data[0] || []).length === 0) {
      return await fetchCSV(gid);
    }
    return data;
  } catch {
    return await fetchCSV(gid);
  }
}

// ---------------- TYPES & LOADERS ----------------

export type MasterParticipant = {
  epc: string;
  bib: string;
  name: string;
  gender: string;
  category: string;
  sourceCategoryKey: string;
};

export async function loadMasterParticipants(): Promise<{
  all: MasterParticipant[];
  byCategoryKey: Record<string, MasterParticipant[]>;
  byEpc: Map<string, MasterParticipant>;
}> {
  const byEpc = new Map<string, MasterParticipant>();
  const byCategoryKey: Record<string, MasterParticipant[]> = {};

  for (const cat of GIDS.categories) {
    const grid = await fetchSheet(cat.gid);
    if (!grid || grid.length <= 1) {
      byCategoryKey[cat.key] = [];
      continue;
    }

    const headers = (grid[0] || []).map(String);

    const epcIdx = findColIndex(headers, "epc");
    const bibIdx = findColIndex(headers, "bib");
    const nameIdx = findColIndex(headers, "name");
    const genderIdx = findColIndex(headers, "gender");
    const categoryIdx = findColIndex(headers, "category");

    const rows = grid.slice(1);
    const arr: MasterParticipant[] = [];

    rows.forEach((r) => {
      const epc = epcIdx >= 0 ? String(r[epcIdx] ?? "").trim() : "";
      if (!epc) return;

      const p: MasterParticipant = {
        epc,
        bib: bibIdx >= 0 ? String(r[bibIdx] ?? "").trim() : "",
        name: nameIdx >= 0 ? String(r[nameIdx] ?? "").trim() : "",
        gender: genderIdx >= 0 ? String(r[genderIdx] ?? "").trim() : "",
        category:
          categoryIdx >= 0 ? String(r[categoryIdx] ?? "").trim() : cat.key,
        sourceCategoryKey: cat.key,
      };

      if (!byEpc.has(epc)) byEpc.set(epc, p);
      arr.push(p);
    });

    byCategoryKey[cat.key] = arr;
  }

  return {
    all: Array.from(byEpc.values()),
    byCategoryKey,
    byEpc,
  };
}

export type TimeEntry = { ms: number | null; raw: string };

export async function loadTimesMap(
  gid: number
): Promise<Map<string, TimeEntry>> {
  const grid = await fetchSheet(gid);
  if (!grid || grid.length <= 1) return new Map();

  const headers = (grid[0] || []).map(String);

  const epcIdx = findColIndex(headers, "epc");
  const timesIdx = findColIndex(headers, "times");

  if (epcIdx < 0 || timesIdx < 0) return new Map();

  const map = new Map<string, TimeEntry>();

  grid.slice(1).forEach((r) => {
    const epc = epcIdx >= 0 ? String(r[epcIdx] ?? "").trim() : "";
    if (!epc) return;

    const rawVal = timesIdx >= 0 ? r[timesIdx] : "";
    const rawStr = String(rawVal ?? "").trim();
    if (!rawStr) return;

    const parsed = parseTimeToMs(rawStr);
    const entry: TimeEntry = { ms: parsed.ms, raw: rawStr };

    const existing = map.get(epc);
    if (!existing) {
      map.set(epc, entry);
      return;
    }

    const newMs = entry.ms ?? null;
    const oldMs = existing.ms ?? null;

    // ✅ Untuk sheet FINISH → pakai waktu TERBARU (ms terbesar)
    if (gid === GIDS.finish) {
      if (newMs != null && (oldMs == null || newMs > oldMs)) {
        map.set(epc, entry);
      }
      return;
    }

    // ✅ Untuk sheet START → pakai waktu PALING AWAL (ms terkecil)
    if (gid === GIDS.start) {
      if (newMs != null && (oldMs == null || newMs < oldMs)) {
        map.set(epc, entry);
      }
      return;
    }

    // Untuk sheet lain (kalau ada) → prefer new non-null & lebih besar
    if (newMs != null && (oldMs == null || newMs > oldMs)) {
      map.set(epc, entry);
    }
  });

  return map;
}

/**
 * ✅ SAFE OPTIONAL CHECKPOINT LOADER
 * Kalau checkpoint kosong / error / belum publish → Map kosong
 */
export async function loadCheckpointTimesMap(
  gid: number
): Promise<Map<string, string[]>> {
  try {
    const grid = await fetchSheet(gid);
    if (!grid || grid.length <= 1) return new Map();

    const headers = (grid[0] || []).map(String);
    const epcIdx = findColIndex(headers, "epc");
    const timesIdx = findColIndex(headers, "times");
    if (epcIdx < 0) return new Map();

    const map = new Map<string, string[]>();

    grid.slice(1).forEach((r) => {
      const epc = epcIdx >= 0 ? String(r[epcIdx] ?? "").trim() : "";
      if (!epc) return;

      const rawVal = timesIdx >= 0 ? r[timesIdx] : "";
      const rawStr = String(rawVal ?? "").trim();

      if (!map.has(epc)) map.set(epc, []);
      if (rawStr) map.get(epc)!.push(rawStr);
    });

    return map;
  } catch {
    return new Map();
  }
}
