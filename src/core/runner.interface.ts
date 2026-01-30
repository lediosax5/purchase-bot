export interface PurchaseRunner {
  // lifecycle
  init(): Promise<void>;
  dispose(): Promise<void>;

  // auth
  login(user: { username: string; password: string }): Promise<void>;
  getSessionToken(): string;

  // carrito / entrega
  clearCart(): Promise<void>;
  selectAddress(direccionId: number): Promise<void>;
  repeatOrder(numeroPedido: string, orderId: string): Promise<void>;

  // validaciones
  validateCart(): Promise<{ status: "OK" | "OUT_OF_STOCK" }>;
  removeOutOfStock(): Promise<void>;

  // pagos
  getPaymentPlans(): Promise<{
    idPlanesPago: string;
    planInit: string;
    planTracer: string;
  }>;

  // sincronización ATG
  refreshCheckout(): Promise<void>;

  // cierre
  commitOrder(): Promise<
    | { success: true; orderId: string }
    | { success: false; reason: "OUT_OF_STOCK" | "GENERIC_ERROR" }
  >;
}
