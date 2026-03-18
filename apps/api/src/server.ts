import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import {
  portfolioAssetSchema,
  protocolRegistryEntrySchema,
} from "@chainatlas/shared";
import { createApiDataService } from "./data";
import { fetchTopPredictionMarkets } from "./polymarket";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

for (const envPath of [
  undefined,
  path.resolve(__dirname, "../.env"),
  path.resolve(__dirname, "../../../.env"),
]) {
  try {
    process.loadEnvFile?.(envPath);
  } catch {
    // Keep running when env files are not present.
  }
}

const app = Fastify({ logger: true });
const dataService = createApiDataService(process.env as Record<string, unknown>);

await app.register(cors, {
  origin: true,
});

app.get("/health", async () => ({ ok: true }));

app.get("/portfolio/:address", async (request, reply) => {
  const params = request.params as { address: string };
  const payload = (await dataService.listPortfolio(params.address)).map((asset) =>
    portfolioAssetSchema.parse(asset),
  );
  return reply.send(payload);
});

app.get("/protocol-registry", async (_request, reply) => {
  const payload = dataService
    .listProtocolRegistry()
    .map((entry) => protocolRegistryEntrySchema.parse(entry));
  return reply.send(payload);
});

app.get("/polymarket/top-markets", async (_request, reply) => {
  try {
    const markets = await fetchTopPredictionMarkets();
    return reply.send(markets);
  } catch (error) {
    console.error("[polymarket]", error);
    return reply.status(502).send({ message: "Failed to fetch prediction markets" });
  }
});

const port = Number(process.env.PORT ?? 4000);

app
  .listen({ port, host: "0.0.0.0" })
  .then(() => {
    app.log.info(`ChainAtlas API listening on ${port}`);
  })
  .catch((error) => {
    app.log.error(error);
    process.exit(1);
  });
