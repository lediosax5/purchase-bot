import { FastifyInstance } from "fastify";
import { PlaywrightRunner } from "../runner/playwright/playwright-runner";
import { PurchaseConfig } from "../contract/purchase.types";

function injectCheckoutEnv(config: {
  formaPagoId: number;
  tarjetaBancoId: string;
  fecha: string;
  banda: "MANIANA" | "TARDE" | "NOCHE";
  direccionId: number;
}) {
  const fechaNormalizada = config.fecha.replace(/-/g, "");

  const bandaMap: Record<string, string> = {
    MANIANA: "1_9_13",
    TARDE: "1_13_18",
    NOCHE: "1_18_22",
  };

  const bandaATG = bandaMap[config.banda];
  if (!bandaATG) {
    throw new Error(`Banda inválida: ${config.banda}`);
  }

  process.env.ID_FORMA_PAGO = String(config.formaPagoId);
  process.env.ID_TARJETA_BANCO = config.tarjetaBancoId;
  process.env.FECHA_COBRO = fechaNormalizada;
  process.env.FECHA_ENTREGA = fechaNormalizada;
  process.env.BANDA_ENTREGA = bandaATG;

  // CLAVE: Cypress lo manda siempre en commitOrder
  process.env.ID_DIRECCION_ENTREGA = String(config.direccionId);
}

export async function purchaseController(app: FastifyInstance) {
  app.post<{ Body: PurchaseConfig }>("/purchase", async (request, reply) => {
    const { usuario, entrega, carrito, pago } = request.body;

    const runner = new PlaywrightRunner();

    const result = {
      success: 0,
      failed: 0,
      orders: [] as string[],
    };

    try {
      await runner.init();
      await runner.login({
        username: usuario.username,
        password: usuario.password,
      });

      for (const direccionId of entrega.direcciones) {
        try {
          injectCheckoutEnv({
            formaPagoId: pago.formaPagoId,
            tarjetaBancoId: pago.tarjetaBancoId,
            fecha: entrega.fecha,
            banda: entrega.banda,
            direccionId,
          });

          await runner.clearCart();
          await runner.selectAddress(direccionId);
          await runner.repeatOrder(carrito.numeroPedido, carrito.orderId);

          const validation = await runner.validateCart();
          if (validation.status === "OUT_OF_STOCK") {
            await runner.removeOutOfStock();
          }

          await runner.refreshCheckout();
          const commit = await runner.commitOrder();

          if (commit.success) {
            result.success++;
            result.orders.push(commit.orderId);
          } else {
            result.failed++;
          }
        } catch (err) {
          // si querés ver el error real, descomentá:
          // request.log.error({ err }, "falló compra en dirección");
          result.failed++;
        }
      }

      return reply.send(result);
    } finally {
      await runner.dispose();
    }
  });
}
