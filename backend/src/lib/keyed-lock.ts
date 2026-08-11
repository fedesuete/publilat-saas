// Serializador en memoria por clave: garantiza que las funciones con la MISMA clave corran una
// tras otra (no en paralelo), aunque las disparen requests concurrentes. Se usa para el
// find-or-create de contactos en el webhook: varios mensajes casi simultáneos de la misma persona
// llegaban como webhooks concurrentes, todos hacían "¿existe el contacto? no -> lo creo", y como
// Contact no tiene UNIQUE por waJid se creaban N contactos duplicados (misma persona partida en
// varios chats). Serializando por (userId+waJid), el 1ro crea y los demás encuentran el que ya está.
//
// Alcance: un proceso. El `app` corre en un solo contenedor, así que alcanza. Si algún día se
// escala a múltiples instancias, habría que reforzar con un UNIQUE en la DB o un lock en Redis.
const chains = new Map<string, Promise<unknown>>();

export function runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  // Encadenamos: fn corre recién cuando termina lo anterior de esta clave (haya salido bien o mal).
  const next = prev.then(fn, fn);
  chains.set(key, next);
  // Limpieza: cuando esta ejecución termina y sigue siendo la última de la cadena, sacamos la clave.
  void next
    .catch(() => undefined)
    .finally(() => {
      if (chains.get(key) === next) chains.delete(key);
    });
  return next;
}
