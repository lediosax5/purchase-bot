export type DeliveryType = "DELIVERY" | "PICKUP";
export type DeliverySlot = "MANIANA" | "TARDE" | "NOCHE";

export interface UserConfig {
  username: string;
  password: string;
}

export interface DeliveryConfig {
  tipo: DeliveryType;
  direcciones: number[];
  fecha: string; // YYYY-MM-DD
  banda: DeliverySlot;
}

export interface CartConfig {
  modo: "REPETIR_PEDIDO";
  numeroPedido: string;
  orderId: string;
}

export interface PaymentConfig {
  formaPagoId: number;
  tarjetaBancoId: string;
}

export interface PurchaseOptions {
  reintentarSinStock?: boolean;
  maxReintentos?: number;
  fallbackRefrescoCheckout?: boolean;
  concurrency?: number;
}

export interface PurchaseConfig {
  usuario: UserConfig;
  entrega: DeliveryConfig;
  carrito: CartConfig;
  pago: PaymentConfig;
  opciones?: PurchaseOptions;
}
