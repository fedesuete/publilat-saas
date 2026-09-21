import { describe, it, expect } from "vitest";
import { Readable, Writable } from "node:stream";

import { rangoDeCabecera, enviarStream } from "./video-stream.js";

// 2026-09-17: un cliente dejó un <video> en loop contra /api/tutorial-video (2.391 pedidos de rango,
// 10 GB en 6 h). Cada pedido que el navegador cortaba dejaba el fs.createReadStream abierto: el proceso
// llegó a 2.200 descriptores sobre 5 mp4. Estos tests cubren el cierre del stream y el parseo de Range.

describe("rangoDeCabecera (Range de HTTP → tramo del archivo)", () => {
  it("sin Range → respuesta completa 200", () => {
    expect(rangoDeCabecera(undefined, 1000)).toEqual({ status: 200, start: 0, end: 999 });
  });
  it("bytes=0-99 → 206 con ese tramo", () => {
    expect(rangoDeCabecera("bytes=0-99", 1000)).toEqual({ status: 206, start: 0, end: 99 });
  });
  it("bytes=100- → 206 hasta el final", () => {
    expect(rangoDeCabecera("bytes=100-", 1000)).toEqual({ status: 206, start: 100, end: 999 });
  });
  it("end mas alla del archivo se recorta", () => {
    expect(rangoDeCabecera("bytes=900-5000", 1000)).toEqual({ status: 206, start: 900, end: 999 });
  });
  it("start mas alla del archivo → 416", () => {
    expect(rangoDeCabecera("bytes=5000-", 1000)).toEqual({ status: 416 });
  });
  it("Range ilegible → 206 del archivo entero (mismo comportamiento que antes)", () => {
    expect(rangoDeCabecera("bytes=abc", 1000)).toEqual({ status: 206, start: 0, end: 999 });
  });
});

/** Fuente que emite `n` trozos de a uno por tick (simula fs.createReadStream). */
function fuente(n: number) {
  let i = 0;
  return new Readable({
    read() {
      if (i >= n) return void this.push(null);
      i++;
      setImmediate(() => this.push(Buffer.alloc(1024, 1)));
    },
  });
}

describe("enviarStream (destruye la fuente si el cliente corta)", () => {
  it("cliente que corta a mitad → la fuente queda destruida (sin fd huérfano)", async () => {
    const src = fuente(50);
    let recibidos = 0;
    const res = new Writable({
      write(_chunk, _enc, cb) {
        recibidos++;
        if (recibidos === 3) {
          // El navegador cerró la conexión: Node destruye la respuesta con "premature close".
          this.destroy();
          return;
        }
        cb();
      },
    });
    enviarStream(src, res);
    await new Promise((r) => setTimeout(r, 100));
    expect(src.destroyed).toBe(true);
  });

  it("descarga completa → llega todo y la fuente termina limpia", async () => {
    const src = fuente(10);
    let bytes = 0;
    const res = new Writable({ write(chunk, _enc, cb) { bytes += chunk.length; cb(); } });
    await new Promise<void>((resolve) => { enviarStream(src, res, () => resolve()); });
    expect(bytes).toBe(10 * 1024);
    expect(src.destroyed).toBe(true); // pipeline cierra la fuente al terminar
  });
});
