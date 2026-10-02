import { describe, it, expect } from "vitest";
import {
  parseMessageEchoes,
  parseMessageEdits,
  parseEditMessage,
  parseHistory,
  parseAppStateSync,
  coexContentType,
  extractCoexContent,
  extractCoexMedia,
  mapHistoryStatus,
} from "./coex-webhooks";

describe("parseEditMessage", () => {
  it("extrai o núcleo de uma edição de texto", () => {
    expect(
      parseEditMessage({
        type: "edit",
        edit: { original_message_id: "O", message: { type: "text", text: { body: "novo texto" } } },
      }),
    ).toEqual({
      originalMessageId: "O",
      contentType: "text",
      contentText: "novo texto",
      mediaId: null,
      mediaMime: null,
      mediaFilename: null,
      mediaCaption: null,
    });
  });
  it("extrai o núcleo de uma edição de mídia", () => {
    expect(
      parseEditMessage({
        type: "edit",
        edit: { original_message_id: "O2", message: { type: "image", image: { id: "M", mime_type: "image/jpeg", caption: "leg" } } },
      }),
    ).toMatchObject({ originalMessageId: "O2", contentType: "image", mediaId: "M", mediaMime: "image/jpeg", mediaCaption: "leg" });
  });
  it("null quando falta edit, original_message_id, message, ou não é edição", () => {
    expect(parseEditMessage({ type: "edit" })).toBeNull();
    expect(parseEditMessage({ type: "edit", edit: { message: { type: "text" } } })).toBeNull();
    expect(parseEditMessage({ type: "edit", edit: { original_message_id: "O" } })).toBeNull();
    expect(parseEditMessage({ type: "text", text: { body: "x" } })).toBeNull();
  });
});

describe("parseMessageEdits", () => {
  it("extrai edição de texto: original_message_id + conteúdo novo", () => {
    const out = parseMessageEdits({
      message_echoes: [
        {
          to: "16505551234",
          id: "wamid.NEW",
          timestamp: "1749854620",
          type: "edit",
          edit: {
            original_message_id: "wamid.ORIG",
            message: { type: "text", text: { body: "texto corrigido" } },
          },
        },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      editId: "wamid.NEW",
      originalMessageId: "wamid.ORIG",
      contactPhone: "16505551234",
      contentType: "text",
      contentText: "texto corrigido",
      mediaId: null,
    });
  });

  it("extrai edição de mídia com id/mime/caption novos", () => {
    const out = parseMessageEdits({
      message_echoes: [
        {
          to: "16505551234",
          id: "wamid.NEW2",
          type: "edit",
          edit: {
            original_message_id: "wamid.ORIG2",
            message: { type: "image", image: { id: "MID", mime_type: "image/jpeg", caption: "nova legenda" } },
          },
        },
      ],
    });
    expect(out[0]).toMatchObject({
      originalMessageId: "wamid.ORIG2",
      contentType: "image",
      mediaId: "MID",
      mediaMime: "image/jpeg",
      mediaCaption: "nova legenda",
    });
  });

  it("ignora edit sem original_message_id, sem message, sem id ou sem to", () => {
    expect(parseMessageEdits({ message_echoes: [{ to: "x", id: "i", type: "edit", edit: { message: { type: "text" } } }] })).toEqual([]);
    expect(parseMessageEdits({ message_echoes: [{ to: "x", id: "i", type: "edit", edit: { original_message_id: "o" } }] })).toEqual([]);
    expect(parseMessageEdits({ message_echoes: [{ id: "i", type: "edit", edit: { original_message_id: "o", message: { type: "text" } } }] })).toEqual([]);
    expect(parseMessageEdits({})).toEqual([]);
  });

  it("mensagens não-edit não viram edições", () => {
    expect(parseMessageEdits({ message_echoes: [{ to: "x", id: "i", type: "text", text: { body: "oi" } }] })).toEqual([]);
  });
});

describe("extractCoexMedia", () => {
  it("extrai id/mime/filename/caption de imagem, vídeo, documento e áudio", () => {
    expect(
      extractCoexMedia({ type: "image", image: { id: "M1", mime_type: "image/jpeg", caption: "foto" } }),
    ).toEqual({ id: "M1", mime: "image/jpeg", filename: null, caption: "foto" });
    expect(
      extractCoexMedia({ type: "video", video: { id: "M2", mime_type: "video/mp4" } }),
    ).toEqual({ id: "M2", mime: "video/mp4", filename: null, caption: null });
    expect(
      extractCoexMedia({ type: "document", document: { id: "M3", mime_type: "application/pdf", filename: "nf.pdf" } }),
    ).toEqual({ id: "M3", mime: "application/pdf", filename: "nf.pdf", caption: null });
    expect(
      extractCoexMedia({ type: "audio", audio: { id: "M4", mime_type: "audio/ogg" } }),
    ).toEqual({ id: "M4", mime: "audio/ogg", filename: null, caption: null });
  });
  it("sticker conta como mídia (renderiza como imagem)", () => {
    expect(extractCoexMedia({ type: "sticker", sticker: { id: "M5", mime_type: "image/webp" } }))
      .toEqual({ id: "M5", mime: "image/webp", filename: null, caption: null });
  });
  it("texto e mídia sem id → null", () => {
    expect(extractCoexMedia({ type: "text", text: { body: "oi" } })).toBeNull();
    expect(extractCoexMedia({ type: "image", image: { caption: "sem id" } })).toBeNull();
    expect(extractCoexMedia({ type: "image" })).toBeNull();
  });
});

describe("coexContentType / extractCoexContent / mapHistoryStatus", () => {
  it("normaliza tipos e mapeia sticker→image, desconhecido→text", () => {
    expect(coexContentType("text")).toBe("text");
    expect(coexContentType("sticker")).toBe("image");
    expect(coexContentType("contacts")).toBe("text");
    expect(coexContentType(undefined)).toBe("text");
  });
  it("extrai texto/legenda e marcador pra mídia sem legenda", () => {
    expect(extractCoexContent({ type: "text", text: { body: "oi" } })).toBe("oi");
    expect(extractCoexContent({ type: "image", image: { caption: "foto" } })).toBe("foto");
    expect(extractCoexContent({ type: "image" })).toBe("[image]");
    expect(extractCoexContent({ type: "document", document: { filename: "nf.pdf" } })).toBe("nf.pdf");
  });
  it("mapeia status do history", () => {
    expect(mapHistoryStatus("READ")).toBe("read");
    expect(mapHistoryStatus("DELIVERED")).toBe("delivered");
    expect(mapHistoryStatus(undefined)).toBe("delivered");
  });
});

describe("parseMessageEchoes", () => {
  it("normaliza echoes (outbound, contato = to)", () => {
    const value = {
      metadata: { phone_number_id: "PN" },
      message_echoes: [
        { from: "5511999", to: "5511888", id: "wamid.A", timestamp: "1739321024", type: "text", text: { body: "olá" } },
        { from: "5511999", to: "5511777", id: "wamid.B", timestamp: "1739321099", type: "image", image: { caption: "veja" } },
      ],
    };
    const out = parseMessageEchoes(value);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ metaId: "wamid.A", contactPhone: "5511888", contentType: "text", contentText: "olá" });
    expect(out[1]).toMatchObject({ metaId: "wamid.B", contactPhone: "5511777", contentType: "image", contentText: "veja" });
  });
  it("ignora echo sem id ou sem to", () => {
    expect(parseMessageEchoes({ message_echoes: [{ from: "x", type: "text" }] })).toEqual([]);
    expect(parseMessageEchoes({})).toEqual([]);
  });
  it("pula echoes type='edit' (tratados por parseMessageEdits, não viram bolha nova)", () => {
    const out = parseMessageEchoes({
      message_echoes: [
        { to: "5511777", id: "wamid.E", type: "edit", edit: { original_message_id: "wamid.O", message: { type: "text", text: { body: "x" } } } },
        { to: "5511888", id: "wamid.T", type: "text", text: { body: "normal" } },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0].metaId).toBe("wamid.T");
  });
  it("echo de mídia carrega mediaId/mediaMime/mediaFilename/mediaCaption", () => {
    const out = parseMessageEchoes({
      message_echoes: [
        { to: "5511777", id: "wamid.IMG", type: "image", image: { id: "MID", mime_type: "image/jpeg", caption: "veja" } },
        { to: "5511666", id: "wamid.DOC", type: "document", document: { id: "DID", mime_type: "application/pdf", filename: "nf.pdf" } },
        { to: "5511555", id: "wamid.TXT", type: "text", text: { body: "oi" } },
      ],
    });
    expect(out[0]).toMatchObject({ metaId: "wamid.IMG", mediaId: "MID", mediaMime: "image/jpeg", mediaFilename: null, mediaCaption: "veja" });
    expect(out[1]).toMatchObject({ metaId: "wamid.DOC", mediaId: "DID", mediaMime: "application/pdf", mediaFilename: "nf.pdf", mediaCaption: null });
    // Texto não tem mídia.
    expect(out[2]).toMatchObject({ metaId: "wamid.TXT", mediaId: null, mediaMime: null, mediaFilename: null, mediaCaption: null });
  });
});

describe("parseHistory", () => {
  it("direção in/out pelo from, contato = thread.id, status do history_context", () => {
    const value = {
      history: [
        {
          metadata: { phase: 0, chunk_order: 1, progress: 50 },
          threads: [
            {
              id: "5511888",
              messages: [
                { from: "5511999", id: "wamid.OUT", timestamp: "1739230955", type: "text", text: { body: "resposta" }, history_context: { status: "READ" } },
                { from: "5511888", id: "wamid.IN", timestamp: "1739230900", type: "text", text: { body: "pergunta" } },
              ],
            },
          ],
        },
      ],
    };
    const out = parseHistory(value, "5511999");
    expect(out).toHaveLength(2);
    const bizMsg = out.find((m) => m.metaId === "wamid.OUT")!;
    expect(bizMsg.direction).toBe("out");
    expect(bizMsg.contactPhone).toBe("5511888");
    expect(bizMsg.status).toBe("read");
    const userMsg = out.find((m) => m.metaId === "wamid.IN")!;
    expect(userMsg.direction).toBe("in");
  });
  it("history vazio → []", () => {
    expect(parseHistory({}, "5511999")).toEqual([]);
  });
  it("mensagem de mídia no history carrega mediaId/mediaMime", () => {
    const out = parseHistory({
      history: [{ threads: [{ id: "5511888", messages: [
        { from: "5511888", id: "wamid.IN_IMG", type: "image", image: { id: "HID", mime_type: "image/png" } },
      ] }] }],
    }, "5511999");
    expect(out[0]).toMatchObject({ metaId: "wamid.IN_IMG", mediaId: "HID", mediaMime: "image/png", contentType: "image" });
  });
});

describe("parseAppStateSync", () => {
  it("só action add vira contato; remove é ignorado", () => {
    const value = {
      state_sync: [
        { type: "contact", action: "add", contact: { full_name: "Pablo Morales", first_name: "Pablo", phone_number: "16505551234" } },
        { type: "contact", action: "remove", contact: { phone_number: "16505550000" } },
      ],
    };
    const out = parseAppStateSync(value);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ phone: "16505551234", name: "Pablo Morales" });
  });
  it("sem telefone → ignora", () => {
    expect(parseAppStateSync({ state_sync: [{ type: "contact", action: "add", contact: {} }] })).toEqual([]);
  });
});
