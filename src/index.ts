import Fastify from "fastify";
import { purchaseController } from "./api/purchase.controller";

const app = Fastify({ logger: true });

app.register(purchaseController);

app.get("/health", async () => ({ status: "ok" }));

app.listen({ port: 3000, host: "0.0.0.0" })
  .catch(err => {
    app.log.error(err);
    process.exit(1);
  });
