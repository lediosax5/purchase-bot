import { FastifyInstance } from "fastify";
import { PlaywrightRunner } from "../runner/playwright/playwright-runner";
import { PurchaseConfig } from "../contract/purchase.types";

export async function purchaseController(app: FastifyInstance) {
  app.post<{ Body: PurchaseConfig }>("/purchase", async (request, reply) => {
    const { usuario, entrega, carrito, pago } = request.body;

    // Inyectar config dinámica
    process.env.ID_FORMA_PAGO = String(pago.formaPagoId);
    process.env.ID_TARJETA_BANCO = pago.tarjetaBancoId;

    // Normalizar fecha YYYY-MM-DD -> YYYYMMDD
    const fechaNormalizada = entrega.fecha.replace(/-/g, "");
    process.env.FECHA_COBRO = fechaNormalizada;
    process.env.FECHA_ENTREGA = fechaNormalizada;

    // Mapear banda lógica → ATG
    const bandaMap: Record<string, string> = {
      MANIANA: "1_9_13",
      TARDE: "1_13_18",
      NOCHE: "1_18_22",
    };

    const bandaATG = bandaMap[entrega.banda];
    if (!bandaATG) {
      return reply.code(400).send({
        error: `Banda inválida: ${entrega.banda}`,
      });
    }
    process.env.BANDA_ENTREGA = bandaATG;

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

      request.log.info(
        {
          usuario: usuario.username,
          direcciones: entrega.direcciones,
          pedido: carrito.numeroPedido,
        },
        "purchase iniciado"
      );

      for (const direccionId of entrega.direcciones) {
        try {
          request.log.info({ direccionId }, "procesando dirección");

          await runner.clearCart();
          await runner.selectAddress(direccionId);

          await runner.repeatOrder(carrito.numeroPedido, carrito.orderId);

          const validation = await runner.validateCart();
          request.log.info({ direccionId, validation }, "resultado validateCart");

          if (validation.status === "OUT_OF_STOCK") {
            await runner.removeOutOfStock();
          }

          const plans = await runner.getPaymentPlans();

          // Inyectar planes para commitOrder
          process.env.ID_PLANES_PAGO = plans.idPlanesPago;
          process.env.PLAN_INIT = plans.planInit;
          process.env.PLAN_TRACER = plans.planTracer;

          // ATG necesita el idDireccionEntrega explícito
          process.env.ID_DIRECCION_ENTREGA = String(direccionId);

          // Armar estado de caja ANTES del primer commit
          await runner.refreshCheckout();

          const commit = await runner.commitOrder();
          request.log.info({ direccionId, commit }, "resultado commitOrder");

          if (commit.success) {
            result.success++;
            result.orders.push(commit.orderId);
          } else {
            result.failed++;
          }
        } catch (err: any) {
          request.log.error(
            { direccionId, error: err?.message, stack: err?.stack },
            "error procesando dirección"
          );
          result.failed++;
        }
      }

      request.log.info(result, "purchase finalizado");
      return reply.send(result);
    } finally {
      await runner.dispose();
    }
  });
}
