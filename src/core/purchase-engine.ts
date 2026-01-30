import { PurchaseConfig } from "../contract/purchase.types";
import { PurchaseRunner } from "./runner.interface";

export class PurchaseEngine {
  async executeBatch(
    config: PurchaseConfig,
    runnerFactory: () => PurchaseRunner
  ) {
    // implementación real viene después
    return {
      summary: {
        total: config.entrega.direcciones.length,
        success: 0,
        failed: 0,
      },
      results: [],
    };
  }
}
