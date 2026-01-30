import { request, APIRequestContext, Browser, chromium } from "@playwright/test";
import { PurchaseRunner } from "../../core/runner.interface";

export class PlaywrightRunner implements PurchaseRunner {
  private browser!: Browser;
  private api!: APIRequestContext;
  private sessionToken!: string;

  private bandaEntregaRaw!: string; // ej "9-13"
  private storageStateCache: any;

  async init(): Promise<void> {
    this.browser = await chromium.launch({ headless: true });
  }

  async dispose(): Promise<void> {
    if (this.api) await this.api.dispose();
    if (this.browser) await this.browser.close();
  }

  getSessionToken(): string {
    return this.sessionToken;
  }

  // =========================
  // HELPERS
  // =========================
  private requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`Variable de entorno faltante: ${name}`);
    return value;
  }

  private normalizeBandasRaw(input: string): string {
    const s = (input ?? "").trim();
    if (!s) throw new Error("BANDA_ENTREGA vacía");

    if (s.includes("_")) {
      const parts = s.split("_").filter(Boolean);
      const nums = parts[0] === "1" ? parts.slice(1) : parts;
      if (nums.length >= 2) return `${nums[0]}-${nums[1]}`;
    }

    if (s.includes("-")) return s;

    throw new Error(`Formato de BANDA_ENTREGA no soportado: ${s}`);
  }

  private bandasForCommit(raw: string): string {
    const r = this.normalizeBandasRaw(raw);
    return `1_${r.replace("-", "_")}`;
  }

  private async debugHttp(
    label: string,
    res: import("@playwright/test").APIResponse
  ): Promise<{ status: number; text: string }> {
    const status = res.status();
    const text = await res.text();
    console.log(`\n==== ${label} ====`);
    console.log("status:", status);
    console.log("body:", text);
    return { status, text };
  }

  // =========================
  // LOGIN + SESSION
  // =========================
  async login(user: { username: string; password: string }): Promise<void> {
    const context = await this.browser.newContext({ ignoreHTTPSErrors: true });
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
              body: JSON.stringify({ login: username, password, isAngular: "true" }),
              credentials: "include",
            }
          );
          return { status: res.status };
        },
        { username: user.username, password: user.password, token: this.sessionToken }
      );

      if (loginResult.status !== 200) {
        throw new Error(`HTTP error en login: ${loginResult.status}`);
      }

      this.storageStateCache = await context.storageState();
      this.api = await request.newContext({
        baseURL: "https://testdigital3.redcoto.com.ar",
        ignoreHTTPSErrors: true,
        storageState: this.storageStateCache,
      });
    } finally {
      await context.close();
    }
  }

  // =========================
  // CARRITO
  // =========================
  async clearCart(): Promise<void> {
    const res = await this.api.post(
      "/rest/model/atg/actors/cCarritoActor/limpiarCarrito",
      { params: { pushSite: "CotoDigital", _dynSessConf: this.sessionToken } }
    );
    if (res.status() !== 200) throw new Error("clearCart HTTP error");
  }

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

  async repeatOrder(numeroPedido: string, orderId: string): Promise<void> {
    const res = await this.api.post(
      "/rest/model/atg/actors/cProfileActor/getRepetirPedido",
      {
        params: { pushSite: "CotoDigital", _dynSessConf: this.sessionToken },
        data: { numeroPedido, orderId },
      }
    );
    if (res.status() !== 200) throw new Error("repeatOrder HTTP error");

    const body = await res.json();
    if (body?.codigoError !== "0") {
      throw new Error(`repeatOrder fallo: ${body?.codigoError}`);
    }
  }

  async validateCart(): Promise<{ status: "OK" | "OUT_OF_STOCK" }> {
    const res = await this.api.post(
      "/rest/model/atg/actors/cvActor/validarCarritoPreCheckout",
      { params: { pushSite: "CotoDigital", _dynSessConf: this.sessionToken } }
    );    
    const body = await res.json();
    if (body?.codigoError === "10") return { status: "OUT_OF_STOCK" };
    return { status: "OK" };
  }

  async removeOutOfStock(): Promise<void> {
    await this.api.post(
      "/rest/model/atg/actors/cCarritoActor/eliminarSinStock",
      { params: { pushSite: "CotoDigital", _dynSessConf: this.sessionToken } }
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
    if (!grupo) throw new Error("No se pudo obtener grupo de plan");

    return {
      idPlanesPago: `${grupo}_51`,
      planInit: `${grupo}:1,51-1$(0%-0%)//`,
      planTracer: `${grupo};51,&`,
    };
  }

  // =========================
  // CHECKOUT + COMMIT
  // =========================
  async refreshCheckout(): Promise<void> {
    this.bandaEntregaRaw = this.normalizeBandasRaw(this.requireEnv("BANDA_ENTREGA"));
    const fechaEntrega = this.requireEnv("FECHA_ENTREGA");

    const ctx = await this.browser.newContext({
      ignoreHTTPSErrors: true,
      storageState: this.storageStateCache,
    });
    const page = await ctx.newPage();

    try {
    await page.goto(
    "https://testdigital3.redcoto.com.ar/sitios/cdigi/nuevositio",
    { waitUntil: "domcontentloaded" }
    );

    const validarUrl =
      `https://testdigital3.redcoto.com.ar/rest/model/atg/actors/cvActor/validarCarritoPreCheckout` +
      `?pushSite=CotoDigital&_dynSessConf=${encodeURIComponent(this.sessionToken)}`;

    await page.evaluate(async (url) => {
      await fetch(url, {
        method: "GET",
        credentials: "include",
      });
    }, validarUrl);

      const costoUrl =
        `https://testdigital3.redcoto.com.ar/rest/model/atg/actors/cvActor/getCostoEnvio` +
        `?pushSite=CotoDigital&_dynSessConf=${encodeURIComponent(this.sessionToken)}`;

      const form = new URLSearchParams();
      form.set("envios", JSON.stringify({
        envios: [{
          id: 0,
          idTipoGrupo: "1",
          costoEnvio: "399",
          fechaEnvio: fechaEntrega,
          bandasEntrega: this.bandaEntregaRaw,
          idServicioDisponible: "300",
          sinCosto: false,
        }],
        importeTotal: 0,
      }));
      form.set("cupones", JSON.stringify({ cupones: [] }));

      const res = await page.evaluate(async ({ url, body }) => {
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
          body,
          credentials: "include",
        });
        return r.status;
      }, { url: costoUrl, body: form.toString() });

      if (res !== 200) {
        throw new Error(`refreshCheckout getCostoEnvio HTTP ${res}`);
      }
    } finally {
      await ctx.close();
    }
  }

  async commitOrder(): Promise<
  | { success: true; orderId: string }
  | { success: false; reason: "OUT_OF_STOCK" | "GENERIC_ERROR" }
> {
    const plans = await this.getPaymentPlans();

    const body = new URLSearchParams({
      pushSite: "CotoDigital",
      _dynSessConf: this.sessionToken,

      idFormaPago: this.requireEnv("ID_FORMA_PAGO"),
      idTarjetaBanco: this.requireEnv("ID_TARJETA_BANCO"),
      idPlanesPago: plans.idPlanesPago,
      planInit: plans.planInit,
      planTracer: plans.planTracer,

      fechasCobro: `1_${this.requireEnv("FECHA_COBRO")}`,
      fechasEntrega: `1_${this.requireEnv("FECHA_ENTREGA")}`,
      bandasEntrega: this.bandasForCommit(this.bandaEntregaRaw),

      idTiposPago: "1_2",
      idTiposServicioEntrega: "1_300",

      // CLAVES: igual que Cypress
      idPedidoCanal: "1",
      idDireccionEntrega: this.requireEnv("ID_DIRECCION_ENTREGA"),
      idCondicionIVA: "0",
      idDatosFacturacion: "0",

      cobroOnline: "2",
      participaSorteo: "NO",
      cuponesElegidos: JSON.stringify({ cupones: [] }),
      resolucion: "1265x978",
    });

    const res = await this.api.post(
      "/rest/model/atg/actors/cvActor/commitOrder",
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        data: body.toString(),
      }
    );

    const { text } = await this.debugHttp("commitOrder", res);

    try {
      const parsed = JSON.parse(text);

      if (parsed?.codigoError === "0" && parsed?.orderId) {
        return { success: true, orderId: String(parsed.orderId) };
      }

      if (parsed?.codigoError === "1" && parsed?.sinStock) {
        return { success: false, reason: "OUT_OF_STOCK" };
      }
    } catch {}

    return { success: false, reason: "GENERIC_ERROR" };
  }
}
