import Fastify from "fastify";
import cors from "@fastify/cors";
import {
  bridgeJobPatchSchema,
  bridgeJobSchema,
  portfolioAssetSchema,
  protocolRegistryEntrySchema,
} from "@chainatlas/shared";
import { listBridgeJobs, listPortfolio, listProtocolRegistry, updateBridgeJob, upsertBridgeJob } from "./data";

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

app.get("/bridge-jobs/:address", async (request, reply) => {
  const params = request.params as { address: string };
  const payload = (await listBridgeJobs(params.address)).map((job) => bridgeJobSchema.parse(job));
  return reply.send(payload);
});

app.post("/bridge-jobs", async (request, reply) => {
  const payload = bridgeJobSchema.parse(request.body) as import("@chainatlas/shared").BridgeJob;
  return reply.code(201).send(await upsertBridgeJob(payload));
});

app.patch("/bridge-jobs/:id", async (request, reply) => {
  const params = request.params as { id: string };
  const body = bridgeJobPatchSchema.parse(request.body) as Partial<import("@chainatlas/shared").BridgeJob>;
  const job = await updateBridgeJob(params.id, body);

  if (!job) {
    return reply.code(404).send({ message: "Bridge job not found" });
  }

  return reply.send(job);
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
