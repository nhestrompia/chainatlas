import Fastify from "fastify";
import cors from "@fastify/cors";
import {
  portfolioAssetSchema,
  protocolRegistryEntrySchema,
} from "@chainatlas/shared";
import { listPortfolio, listProtocolRegistry } from "./data";

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: true,
});

app.get("/health", async () => ({ ok: true }));

app.get("/portfolio/:address", async (request, reply) => {
  const params = request.params as { address: string };
  const payload = (await listPortfolio(params.address)).map((asset) => portfolioAssetSchema.parse(asset));
  return reply.send(payload);
});

app.get("/protocol-registry", async (_request, reply) => {
  const payload = listProtocolRegistry().map((entry) => protocolRegistryEntrySchema.parse(entry));
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
