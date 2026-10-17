import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createAlmacen } from '../server/integrations/almacen.js';

const env = { CRM_SUPABASE_URL: 'https://abc.supabase.co', CRM_SUPABASE_ANON_KEY: 'eyJ'.padEnd(40, 'x') };
const HTML_520 = '<!DOCTYPE html> <!--[if lt IE 7]> <html class="no-js ie6 oldie" lang="en-US"> <![endif]-->';

describe('subir a Supabase para Instagram', () => {
  test('un 520 de Supabase se reintenta; si sigue, el aviso no trae el HTML', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'jarvis-alm-'));
    try {
      const f = path.join(dir, 'foto.jpg');
      writeFileSync(f, 'jpg');
      let n = 0;
      const ok = createAlmacen({ env, esperaMs: 0, fetchImpl: async () => (++n < 3 ? new Response(HTML_520, { status: 520 }) : new Response('{}', { status: 200 })) });
      assert.equal((await ok.subir(f, { destino: 'a/foto.jpg', mime: 'image/jpeg' })).url, 'https://abc.supabase.co/storage/v1/object/public/contenido/jarvis/a/foto.jpg');
      assert.equal(n, 3);
      const mal = createAlmacen({ env, esperaMs: 0, fetchImpl: async () => new Response(HTML_520, { status: 520 }) });
      await assert.rejects(mal.subir(f, { destino: 'a/foto.jpg' }), (e) => /Supabase respondió 520 \(un fallo suyo/.test(e.message) && /3 veces/.test(e.message) && !e.message.includes('DOCTYPE'));
      // Un 401 no se reintenta
      let m = 0;
      const sinPermiso = createAlmacen({ env, esperaMs: 0, fetchImpl: async () => { m += 1; return new Response('no', { status: 403 }); } });
      await assert.rejects(sinPermiso.subir(f, { destino: 'x.jpg' }), /políticas del bucket/);
      assert.equal(m, 1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('un vídeo grande va por trozos de 6 MB y, si un trozo falla, sigue desde donde se quedó', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'jarvis-alm-'));
    try {
      const f = path.join(dir, 'video.mp4');
      const tam = 13 * 1024 * 1024;
      writeFileSync(f, Buffer.alloc(tam, 1));
      const llamadas = [];
      let recibido = 0;
      let falloUnaVez = true;
      const fetchImpl = async (url, o) => {
        llamadas.push(`${o.method} ${new URL(url).pathname} ${o.headers['upload-offset'] ?? ''}`.trim());
        if (o.method === 'POST') {
          assert.equal(o.headers['upload-length'], String(tam));
          assert.match(o.headers['upload-metadata'], new RegExp(`objectName ${Buffer.from('jarvis/v/video.mp4').toString('base64')}`));
          return new Response(null, { status: 201, headers: { location: 'https://abc.supabase.co/storage/v1/upload/resumable/xyz' } });
        }
        if (o.method === 'HEAD') return new Response(null, { status: 200, headers: { 'upload-offset': String(recibido) } });
        if (Number(o.headers['upload-offset']) === 6 * 1024 * 1024 && falloUnaVez) { falloUnaVez = false; return new Response(HTML_520, { status: 520 }); }
        recibido = Number(o.headers['upload-offset']) + o.body.length;
        return new Response(null, { status: 204, headers: { 'upload-offset': String(recibido) } });
      };
      const r = await createAlmacen({ env, esperaMs: 0, fetchImpl }).subir(f, { destino: 'v/video.mp4', mime: 'video/mp4' });
      assert.equal(r.url, 'https://abc.supabase.co/storage/v1/object/public/contenido/jarvis/v/video.mp4');
      assert.equal(recibido, tam);
      assert.deepEqual(llamadas, [
        'POST /storage/v1/upload/resumable',
        'PATCH /storage/v1/upload/resumable/xyz 0',
        'PATCH /storage/v1/upload/resumable/xyz 6291456',
        'HEAD /storage/v1/upload/resumable/xyz',
        'PATCH /storage/v1/upload/resumable/xyz 6291456',
        'PATCH /storage/v1/upload/resumable/xyz 12582912',
      ]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
