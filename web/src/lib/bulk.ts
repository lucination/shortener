export type ImportedRow =
  | { kind: "valid"; row: number; destination: string; alias: string }
  | { kind: "invalid"; row: number; message: string };
export function parseBulk(text: string): readonly ImportedRow[] {
  const records: { row: number; cells: string[]; malformed: boolean }[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let row = 1;
  let line = 1;
  for (let i = 0; i <= text.length; i++) {
    const char = text[i] ?? "\n";
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(cell);
      cell = "";
    } else if (char === "\n" && (!quoted || i === text.length)) {
      cells.push(cell.replace(/\r$/, ""));
      if (cells.some((value) => value.trim()))
        records.push({ row, cells, malformed: quoted });
      cells = [];
      cell = "";
      row = line + 1;
    } else cell += char;
    if (char === "\n") line++;
  }
  return records
    .filter(
      (record, index) =>
        !(
          index === 0 && record.cells[0]?.trim().toLowerCase() === "destination"
        ),
    )
    .map((record) => {
      const destination = record.cells[0]?.trim() ?? "";
      const alias = record.cells[1]?.trim() ?? "";
      if (record.malformed || record.cells.length > 2)
        return {
          kind: "invalid",
          row: record.row,
          message: "Expected destination,alias with balanced CSV quotes.",
        };
      try {
        const url = new URL(destination);
        if (!["https:", "http:"].includes(url.protocol)) throw new Error();
      } catch {
        return {
          kind: "invalid",
          row: record.row,
          message: "Destination must be an http:// or https:// URL.",
        };
      }
      if (alias && !/^[A-Za-z0-9_-]+$/.test(alias))
        return {
          kind: "invalid",
          row: record.row,
          message:
            "Alias may contain letters, digits, underscores and hyphens.",
        };
      return { kind: "valid", row: record.row, destination, alias };
    });
}
