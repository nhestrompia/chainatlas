import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import {
  chainSlugSchema,
  portfolioAssetSchema,
  protocolRegistryEntrySchema,
} from "@chainatlas/shared";
import { z } from "zod";
import { createApiDataService } from "./data";

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

app.get("/nfts/:address", async (request, reply) => {
  const params = request.params as { address: string };
  const query = request.query as { chain?: string; cursor?: string };
  const chain = chainSlugSchema.parse(query.chain);
  const payload = await dataService.listWalletNfts(params.address, chain, query.cursor);
  return reply.send(payload);
});

app.get("/market/opensea/listings/:address", async (request, reply) => {
  const params = request.params as { address: string };
  const query = request.query as { chain?: string; limit?: string };
  const chain = chainSlugSchema.parse(query.chain);
  const limit = query.limit ? Number.parseInt(query.limit, 10) : 20;
  const payload = await dataService.listOpenSeaListings(params.address, chain, limit);
  return reply.send(payload);
});

const openSeaFulfillmentRequestSchema = z.object({
  chain: chainSlugSchema,
  orderHash: z.string().regex(/^0x[a-fA-F0-9]+$/),
  protocolAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  fulfiller: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

app.post("/market/opensea/fulfillment", async (request, reply) => {
  const body = openSeaFulfillmentRequestSchema.parse(request.body);
  const payload = await dataService.buildOpenSeaFulfillment(body);
  return reply.send(payload);
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
