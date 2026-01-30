import Fastify from "fastify";
import { PlaywrightRunner } from "./runner/playwright/playwright-runner";
import { purchaseController } from "./api/purchase.controller";

const app = Fastify({ logger: true });

// Registrar controller
app.register(purchaseController);

// Health
app.get("/health", async () => ({ status: "ok" }));

// Login test
app.get("/login-test", async () => {
  const runner = new PlaywrightRunner();
  await runner.init();

  await runner.login({
    username: "BOT_USER",
    password: "BOT_PASS",
  });

  const token = runner.getSessionToken();
  await runner.dispose();

  return {
    logged: true,
    sessionToken: token,
  };
});

app.listen({ port: 3000, host: "0.0.0.0" });
