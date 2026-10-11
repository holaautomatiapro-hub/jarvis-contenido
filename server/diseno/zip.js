// Lector mínimo de .zip (sin dependencias): lo justo para importar un sistema de diseño.
// Admite archivos guardados sin comprimir (método 0) o con deflate (método 8), que es lo que crean
// Windows, macOS y casi cualquier programa. No admite zips cifrados ni ZIP64.
import { crc32 as crc32Zlib, deflateRawSync, inflateRawSync } from 'node:zlib';

const FIN_DIRECTORIO = 0x06054b50;
const ENTRADA_DIRECTORIO = 0x02014b50;
const CABECERA_LOCAL = 0x04034b50;

export function leerZip(buf, { maxArchivos = 2000, maxTotal = 300 * 1024 * 1024 } = {}) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new Error('Eso no es un archivo .zip');
  // El final del directorio está en los últimos 22 bytes + el comentario (hasta 64 KB)
  let fin = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === FIN_DIRECTORIO) { fin = i; break; }
  }
  if (fin < 0) throw new Error('Eso no es un archivo .zip (o está dañado)');
  const total = buf.readUInt16LE(fin + 10);
  let p = buf.readUInt32LE(fin + 16);
  if (total === 0xffff || p === 0xffffffff) throw new Error('Este .zip es demasiado grande (ZIP64): comprímelo de nuevo con menos archivos');
  if (total > maxArchivos) throw new Error(`El .zip tiene demasiados archivos (${total}; máximo ${maxArchivos})`);

  const archivos = [];
  let acumulado = 0;
  for (let n = 0; n < total; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== ENTRADA_DIRECTORIO) throw new Error('El .zip está dañado');
    const flags = buf.readUInt16LE(p + 8);
    const metodo = buf.readUInt16LE(p + 10);
    const comprimido = buf.readUInt32LE(p + 20);
    const tamano = buf.readUInt32LE(p + 24);
    const largoNombre = buf.readUInt16LE(p + 28);
    const largoExtra = buf.readUInt16LE(p + 30);
    const largoComentario = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const crudo = buf.subarray(p + 46, p + 46 + largoNombre);
    const nombre = (flags & 0x800 ? crudo.toString('utf8') : decodificarNombre(crudo)).replace(/\\/g, '/');
    p += 46 + largoNombre + largoExtra + largoComentario;
    if (nombre.endsWith('/')) continue;
    if (flags & 1) throw new Error('El .zip está protegido con contraseña');
    if (metodo !== 0 && metodo !== 8) throw new Error(`«${nombre}» usa una compresión que no conozco: comprime de nuevo el .zip`);
    acumulado += tamano;
    if (acumulado > maxTotal) throw new Error(`El .zip descomprimido pasa de ${Math.round(maxTotal / 1048576)} MB`);
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== CABECERA_LOCAL) throw new Error('El .zip está dañado');
    const inicio = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const datos = buf.subarray(inicio, inicio + comprimido);
    const contenido = metodo === 0 ? Buffer.from(datos) : inflateRawSync(datos, { maxOutputLength: Math.max(tamano, 1) });
    if (contenido.length !== tamano) throw new Error(`«${nombre}» no se ha podido descomprimir bien`);
    archivos.push({ nombre, contenido });
  }
  return archivos;
}

// Sin la marca UTF-8, los nombres van en la codificación del sistema: casi siempre UTF-8 hoy en día,
// y si no lo es, latin1 deja al menos las tildes legibles
function decodificarNombre(b) {
  const utf8 = b.toString('utf8');
  return utf8.includes('�') ? b.toString('latin1') : utf8;
}

// Crea un .zip (deflate). Lo usan los tests y la exportación del kit.

export function crearZip(archivos) {
  const partes = [];
  const directorio = [];
  let offset = 0;
  for (const { nombre, contenido } of archivos) {
    const datos = Buffer.isBuffer(contenido) ? contenido : Buffer.from(String(contenido));
    const comprimido = deflateRawSync(datos);
    const nom = Buffer.from(nombre, 'utf8');
    const crc = crc32(datos);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(CABECERA_LOCAL, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(comprimido.length, 18); local.writeUInt32LE(datos.length, 22); local.writeUInt16LE(nom.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(ENTRADA_DIRECTORIO, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(comprimido.length, 20); central.writeUInt32LE(datos.length, 24); central.writeUInt16LE(nom.length, 28);
    central.writeUInt32LE(offset, 42);
    partes.push(local, nom, comprimido);
    directorio.push(central, nom);
    offset += local.length + nom.length + comprimido.length;
  }
  const dir = Buffer.concat(directorio);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(FIN_DIRECTORIO, 0); fin.writeUInt16LE(archivos.length, 8); fin.writeUInt16LE(archivos.length, 10);
  fin.writeUInt32LE(dir.length, 12); fin.writeUInt32LE(offset, 16);
  return Buffer.concat([...partes, dir, fin]);
}

function crc32(buf) {
  if (typeof crc32Zlib === 'function') return crc32Zlib(buf) >>> 0;
  let c, crc = 0xffffffff;
  for (const b of buf) {
    c = (crc ^ b) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
