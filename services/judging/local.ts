/**
 * The judging service on localhost, for running bt-judging without a deployed stage:
 * the real generated router and impl.ts over MemoryStore, saved to a JSON file so data
 * survives restarts.
 *
 *   npx tsx local.ts                 # http://localhost:4000, bootstrap code ORG-BOOT
 *
 * Env: PORT, JUDGING_BOOTSTRAP_CODE, JUDGING_LOCAL_FILE (delete it to start over).
 */
import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHandler } from "@ubc-biztech/sdk/server/judging";
import { JudgingImpl } from "./impl";
import { MemoryStore, type Item } from "./store";

const PORT = Number(process.env.PORT ?? 4000);
const BOOT = process.env.JUDGING_BOOTSTRAP_CODE || "ORG-BOOT";
const FILE = process.env.JUDGING_LOCAL_FILE ?? new URL("./.local-store.json", import.meta.url).pathname;

class FileStore extends MemoryStore {
  constructor() {
    super();
    if (existsSync(FILE)) for (const i of JSON.parse(readFileSync(FILE, "utf8")) as Item[]) this.items.set(`${i.id} ${i.sk}`, i);
  }
  private save() {
    writeFileSync(FILE, JSON.stringify([...this.items.values()], null, 1));
  }
  async put(item: Item, createNew: boolean) {
    await super.put(item, createNew);
    this.save();
  }
  async delete(id: string, sk: string) {
    await super.delete(id, sk);
    this.save();
  }
}

const handler = createHandler(new JudgingImpl(new FileStore(), { bootstrapCode: BOOT }), (line) => console.log(JSON.stringify(line)));

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const r = await handler({
    httpMethod: req.method,
    path: url.pathname,
    headers: req.headers as Record<string, string>,
    queryStringParameters: url.searchParams.size ? Object.fromEntries(url.searchParams) : null,
    body: chunks.length ? Buffer.concat(chunks).toString("utf8") : null,
    requestContext: { requestId: `local-${Date.now()}` },
  });
  res.writeHead(r.statusCode, r.headers as Record<string, string>).end(r.body);
}).listen(PORT, () => console.log(`judging on http://localhost:${PORT}  bootstrap code: ${BOOT}  data: ${FILE}`));
