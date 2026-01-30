import { request, APIRequestContext, Browser, chromium } from "@playwright/test";
import { PurchaseRunner } from "../../core/runner.interface";

export class PlaywrightRunner implements PurchaseRunner {
  private browser!: Browser;
  private api!: APIRequestContext;
  private sessionToken!: string;

  async init(): Promise<void> {
    this.browser = await chromium.launch({ headless: true });
  }

  async dispose(): Promise<void> {
    if (this.api) await this.api.dispose();
    if (this.browser) await this.browser.close();
  }

  private requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
      throw new Error(`Variable de entorno faltante: ${name}`);
    }
    return value;
  }

  // =========================
  // LOGIN + SESSION
  // =========================
  async login(user: { username: string; password: string }): Promise<void> {
    const context = await this.browser.newContext({
      ignoreHTTPSErrors: true,
    });

    const page = await context.newPage();

    try {
      await page.goto(
        "https://testdigital3.redcoto.com.ar/sitios/cdigi/nuevositio",
        { waitUntil: "networkidle" }
      );

      const sessionData = await page.evaluate(() => {
        const raw = sessionStorage.getItem("_dynSessConf");
        return raw ? JSON.parse(raw) : null;
      });

      if (!sessionData?.sessionConfirmationNumber) {
        throw new Error("No se pudo obtener _dynSessConf");
      }

      this.sessionToken = sessionData.sessionConfirmationNumber;

      const loginResult = await page.evaluate(
        async ({ username, password, token }) => {
          const res = await fetch(
            `/rest/model/atg/actors/cProfileActor/login?pushSite=CotoDigital&_dynSessConf=${token}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json;charset=UTF-8" },
              body: JSON.stringify({
                login: username,
                password,
                isAngular: "true",
              }),
              credentials: "include",
            }
          );

          return { status: res.status };
        },
        {
          username: user.username,
          password: user.password,
          token: this.sessionToken,
        }
      );

      if (loginResult.status !== 200) {
        throw new Error(`HTTP error en login: ${loginResult.status}`);
      }

      const storageState = await context.storageState();

      this.api = await request.newContext({
        baseURL: "https://testdigital3.redcoto.com.ar",
        ignoreHTTPSErrors: true,
        storageState,
      });
    } finally {
      await context.close();
    }
  }

  getSessionToken(): string {
    return this.sessionToken;
  }

  // =========================
  // CARRITO / DIRECCIÓN
  // =========================
  async selectAddress(direccionId: number): Promise<void> {
    const res = await this.api.get(
      "/rest/model/atg/actors/cProfileActor/changeDeliveryAddress",
      {
        params: {
          pushSite: "CotoDigital",
          _dynSessConf: this.sessionToken,
          selectedAddress: direccionId,
        },
      }
    );

    if (res.status() !== 200) {
      throw new Error(`selectAddress HTTP error (${direccionId})`);
    }
  }

  async clearCart(): Promise<void> {
    const res = await this.api.post(
      "/rest/model/atg/actors/cCarritoActor/limpiarCarrito",
      {
        params: {
          pushSite: "CotoDigital",
          _dynSessConf: this.sessionToken,
        },
      }
    );

    if (res.status() !== 200) {
      throw new Error("clearCart HTTP error");
    }
  }

  async repeatOrder(numeroPedido: string, orderId: string): Promise<void> {
    const res = await this.api.post(
      "/rest/model/atg/actors/cProfileActor/getRepetirPedido",
      {
        params: {
          pushSite: "CotoDigital",
          _dynSessConf: this.sessionToken,
        },
        data: { numeroPedido, orderId },
      }
    );

    if (res.status() !== 200) {
      throw new Error("repeatOrder HTTP error");
    }

    const body = await res.json();
    if (body?.codigoError !== "0") {
      throw new Error(
        `repeatOrder fallo: ${body?.codigoError} ${body?.mensajeError}`
      );
    }
  }

  async validateCart(): Promise<{ status: "OK" | "OUT_OF_STOCK" }> {
    const res = await this.api.post(
      "/rest/model/atg/actors/cvActor/validarCarritoPreCheckout",
      {
        params: {
          pushSite: "CotoDigital",
          _dynSessConf: this.sessionToken,
        },
      }
    );

    const body = await res.json();
    if (body?.codigoError === "10") {
      return { status: "OUT_OF_STOCK" };
    }
    return { status: "OK" };
  }

  async removeOutOfStock(): Promise<void> {
    await this.api.post(
      "/rest/model/atg/actors/cCarritoActor/eliminarSinStock",
      {
        params: {
          pushSite: "CotoDigital",
          _dynSessConf: this.sessionToken,
        },
      }
    );
  }

  // =========================
  // PAGOS
  // =========================
  async getPaymentPlans() {
    const res = await this.api.get(
      "/rest/model/atg/actors/cvActor/getPlanesCuotasOfertas",
      {
        params: {
          pushSite: "CotoDigital",
          _dynSessConf: this.sessionToken,
          idTipoGrupo: "0",
          idFormaPago: this.requireEnv("ID_FORMA_PAGO"),
          idTarjetaBanco: this.requireEnv("ID_TARJETA_BANCO"),
          fechaCobro: this.requireEnv("FECHA_COBRO"),
          cobroOnline: "2",
        },
      }
    );

    const body = await res.json();
    const grupo = body?.planesCuotas?.[0]?.grupo;

    if (!grupo) {
      throw new Error("No se pudo obtener grupo de plan");
    }

    return {
      idPlanesPago: `${grupo}_51`,
      planInit: `${grupo}:1,51-1$(0%-0%)//`,
      planTracer: `${grupo};51,&`,
    };
  }

  // =========================
  // REFRESH CHECKOUT
  // =========================
  async refreshCheckout(): Promise<void> {
    if (!this.api) throw new Error("APIRequestContext no inicializado");
  
    const fechaCobro = this.requireEnv("FECHA_COBRO");
    const fechaEntrega = this.requireEnv("FECHA_ENTREGA");
    const bandaEntrega = this.requireEnv("BANDA_ENTREGA");
    const idFormaPago = this.requireEnv("ID_FORMA_PAGO");
    const idTarjetaBanco = this.requireEnv("ID_TARJETA_BANCO");
  
    // 1) Sync carrito
    const carritoRes = await this.api.get("/rest/model/atg/actors/cCarritoActor/getCarrito", {
      params: { pushSite: "CotoDigital", _dynSessConf: this.sessionToken },
    });
    if (carritoRes.status() !== 200) {
      throw new Error(`refreshCheckout:getCarrito HTTP ${carritoRes.status()}`);
    }
  
    // 2) Recalcular planes
    const planesRes = await this.api.get("/rest/model/atg/actors/cvActor/getPlanesCuotasOfertas", {
      params: {
        pushSite: "CotoDigital",
        _dynSessConf: this.sessionToken,
        idTipoGrupo: "0",
        idFormaPago,
        idTarjetaBanco,
        fechaCobro,
        cobroOnline: "2",
      },
    });
    if (planesRes.status() !== 200) {
      throw new Error(`refreshCheckout:getPlanesCuotasOfertas HTTP ${planesRes.status()}`);
    }
  
    // 3) Costo envío (ShippingGroup)
    const bodyCostoEnvio = {
      envios: JSON.stringify({
        envios: [
          {
            id: 0,
            idTipoGrupo: "1",
            costoEnvio: "399",
            fechaEnvio: fechaEntrega,
            bandasEntrega: bandaEntrega,
            idServicioDisponible: "300",
            sinCosto: false,
          },
        ],
        importeTotal: 0,
      }),
      cupones: JSON.stringify({ cupones: [] }),
    };
  
    const costoEnvioRes = await this.api.post("/rest/model/atg/actors/cvActor/getCostoEnvio", {
      params: { pushSite: "CotoDigital", _dynSessConf: this.sessionToken },
      headers: { "Content-Type": "application/json" },
      data: bodyCostoEnvio,
    });
  
    if (costoEnvioRes.status() !== 200) {
      throw new Error(`refreshCheckout:getCostoEnvio HTTP ${costoEnvioRes.status()}`);
    }
  
    await new Promise((r) => setTimeout(r, 1600));
  }  

  // =========================
  // COMMIT ORDER
  // =========================
  async commitOrder(): Promise<
  | { success: true; orderId: string }
  | { success: false; reason: "OUT_OF_STOCK" | "GENERIC_ERROR" }
> {
    const body = new URLSearchParams({
      pushSite: "CotoDigital",
      _dynSessConf: this.sessionToken,

      idFormaPago: this.requireEnv("ID_FORMA_PAGO"),
      idTarjetaBanco: this.requireEnv("ID_TARJETA_BANCO"),
      idPlanesPago: this.requireEnv("ID_PLANES_PAGO"),

      fechasCobro: `1_${this.requireEnv("FECHA_COBRO")}`,
      fechasEntrega: `1_${this.requireEnv("FECHA_ENTREGA")}`,
      bandasEntrega: this.requireEnv("BANDA_ENTREGA"),

      idTiposPago: "1_2",
      idTiposServicioEntrega: "1_300",

      idCondicionIVA: "0",
      idDatosFacturacion: "0",

      cobroOnline: "2",
      participaSorteo: "NO",
      pin: "111",
    });

    const res = await this.api.post(
      "/rest/model/atg/actors/cvActor/commitOrder",
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        data: body.toString(),
      }
    );

    const raw = await res.text();
    console.log("commitOrder raw:", raw);

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { success: false, reason: "GENERIC_ERROR" };
    }

    if (parsed?.codigoError === "0" && parsed?.orderId) {
      return { success: true, orderId: String(parsed.orderId) };
    }

    if (parsed?.codigoError === "1" && parsed?.sinStock) {
      return { success: false, reason: "OUT_OF_STOCK" };
    }

    return { success: false, reason: "GENERIC_ERROR" };
  }
}
