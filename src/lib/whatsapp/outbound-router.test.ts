import { describe, it, expect } from "vitest";
import {
  isUazapiEligibleType,
  isBillableAtSend,
  shouldUseUazapi,
  isFepOpen,
  chooseChannel,
} from "./outbound-router";

const OCT1 = new Date("2026-10-01T00:00:00Z");
const SEP = new Date("2026-09-15T12:00:00Z");
const OCT = new Date("2026-10-05T12:00:00Z");

describe("isUazapiEligibleType", () => {
  it("texto/mídia/template → true; interativo → false", () => {
    for (const t of ["text", "image", "video", "document", "audio", "template"])
      expect(isUazapiEligibleType(t)).toBe(true);
    expect(isUazapiEligibleType("interactive")).toBe(false);
    expect(isUazapiEligibleType("desconhecido")).toBe(false);
  });
});

describe("isBillableAtSend", () => {
  it("auto: template sempre cobrável", () => {
    expect(isBillableAtSend({ messageType: "template", windowOpen: true, now: SEP, mode: "auto" })).toBe(true);
  });
  it("auto: não-template GRÁTIS antes de 01/10/2026", () => {
    expect(isBillableAtSend({ messageType: "text", windowOpen: true, now: SEP, mode: "auto" })).toBe(false);
  });
  it("auto: não-template COBRÁVEL em/depois de 01/10/2026", () => {
    expect(isBillableAtSend({ messageType: "text", windowOpen: true, now: OCT, mode: "auto" })).toBe(true);
    expect(isBillableAtSend({ messageType: "text", windowOpen: true, now: OCT1, mode: "auto" })).toBe(true);
  });
  it("always → sempre true; template_only → só template", () => {
    expect(isBillableAtSend({ messageType: "text", windowOpen: true, now: SEP, mode: "always" })).toBe(true);
    expect(isBillableAtSend({ messageType: "text", windowOpen: true, now: OCT, mode: "template_only" })).toBe(false);
    expect(isBillableAtSend({ messageType: "template", windowOpen: true, now: SEP, mode: "template_only" })).toBe(true);
  });
});

describe("shouldUseUazapi (Bresenham)", () => {
  it("pct=0 nunca; pct=100 sempre", () => {
    for (let n = 0; n < 100; n++) {
      expect(shouldUseUazapi(n, 0)).toBe(false);
      expect(shouldUseUazapi(n, 100)).toBe(true);
    }
  });
  it("pct=30 → exatamente 30 hits a cada 100 e espalhado (não bloco)", () => {
    let hits = 0;
    for (let n = 0; n < 100; n++) if (shouldUseUazapi(n, 30)) hits++;
    expect(hits).toBe(30);
    const firstBlock = [...Array(30).keys()].every((n) => shouldUseUazapi(n, 30));
    expect(firstBlock).toBe(false);
  });
  it("pct=20 → 20 a cada 100 e o padrão se repete", () => {
    let hits = 0;
    for (let n = 0; n < 100; n++) if (shouldUseUazapi(n, 20)) hits++;
    expect(hits).toBe(20);
    // repete no bloco seguinte
    expect(shouldUseUazapi(5, 20)).toBe(shouldUseUazapi(105, 20));
  });
});

describe("isFepOpen", () => {
  it("sem referral → fechada", () => {
    expect(isFepOpen({ referralAt: null, now: OCT })).toBe(false);
  });
  it("referral há menos de 7 dias → aberta", () => {
    const ref = new Date("2026-10-01T00:00:00Z"); // 4,5 dias antes de OCT (05/10 12:00)
    expect(isFepOpen({ referralAt: ref, now: OCT })).toBe(true);
  });
  it("referral há exatamente/mais de 7 dias → fechada", () => {
    const exactly7 = new Date(OCT.getTime() - 7 * 24 * 3600 * 1000);
    expect(isFepOpen({ referralAt: exactly7, now: OCT })).toBe(false);
    const older = new Date(OCT.getTime() - 8 * 24 * 3600 * 1000);
    expect(isFepOpen({ referralAt: older, now: OCT })).toBe(false);
  });
  it("referral no futuro (relógio torto) → fechada, nunca negativa", () => {
    const future = new Date(OCT.getTime() + 3600 * 1000);
    expect(isFepOpen({ referralAt: future, now: OCT })).toBe(false);
  });
});

describe("chooseChannel", () => {
  const base = {
    hybridEnabled: true,
    uazapiPct: 100,
    billableMode: "auto" as const,
    messageType: "text",
    windowOpen: true,
    now: OCT,
    hasPhone: true,
    counter: 0,
    override: "auto" as const,
    fepOpen: false,
  };
  it("override official vence", () => {
    expect(chooseChannel({ ...base, override: "official" }).channel).toBe("official");
  });
  it("override uazapi respeita elegibilidade+telefone", () => {
    expect(chooseChannel({ ...base, override: "uazapi", messageType: "interactive" }).channel).toBe("official");
    expect(chooseChannel({ ...base, override: "uazapi", hasPhone: false }).channel).toBe("official");
    expect(chooseChannel({ ...base, override: "uazapi" }).channel).toBe("uazapi");
  });
  it("híbrido off → official", () => {
    expect(chooseChannel({ ...base, hybridEnabled: false }).channel).toBe("official");
  });
  it("interativo → official", () => {
    expect(chooseChannel({ ...base, messageType: "interactive" }).channel).toBe("official");
  });
  it("sem telefone (BSUID) → official", () => {
    expect(chooseChannel({ ...base, hasPhone: false }).channel).toBe("official");
  });
  it("não-cobrável (texto pré-01/10) → official, sem consumir contador", () => {
    const r = chooseChannel({ ...base, now: SEP });
    expect(r.channel).toBe("official");
    expect(r.consumeCounter).toBe(false);
  });
  it("cobrável+elegível+100% → uazapi e consome contador", () => {
    const r = chooseChannel({ ...base, uazapiPct: 100 });
    expect(r.channel).toBe("uazapi");
    expect(r.consumeCounter).toBe(true);
  });
  it("cobrável mas 0% → official, consome contador", () => {
    const r = chooseChannel({ ...base, uazapiPct: 0 });
    expect(r.channel).toBe("official");
    expect(r.consumeCounter).toBe(true);
  });
  it("template desvia como elegível (vira texto no executor)", () => {
    const r = chooseChannel({ ...base, messageType: "template", now: SEP, uazapiPct: 100 });
    expect(r.channel).toBe("uazapi");
  });
  it("janela FEP aberta → grátis no oficial, fica oficial sem consumir contador (mesmo cobrável+100%)", () => {
    const r = chooseChannel({ ...base, fepOpen: true, uazapiPct: 100 });
    expect(r.channel).toBe("official");
    expect(r.consumeCounter).toBe(false);
  });
  it("janela FEP aberta também poupa template (cobrável) do canal não-oficial", () => {
    const r = chooseChannel({ ...base, fepOpen: true, messageType: "template", now: SEP, uazapiPct: 100 });
    expect(r.channel).toBe("official");
    expect(r.consumeCounter).toBe(false);
  });
  it("override uazapi ainda vence a janela FEP (decisão manual)", () => {
    const r = chooseChannel({ ...base, fepOpen: true, override: "uazapi" });
    expect(r.channel).toBe("uazapi");
  });
});
