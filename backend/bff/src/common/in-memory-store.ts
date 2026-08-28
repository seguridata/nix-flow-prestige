/**
 * Almacén en memoria SOLO para la Fase 0 / sandbox local.
 *
 * TODO Fase 1 (M03/M06/M08 en la propuesta de arquitectura): reemplazar por
 * PostgreSQL. Se deja centralizado aquí para que el reemplazo sea un solo
 * archivo y no obligue a tocar los controllers.
 */
export class InMemoryStore<T extends { id: string }> {
  private readonly items = new Map<string, T>();

  save(item: T): T {
    this.items.set(item.id, item);
    return item;
  }

  find(id: string): T | undefined {
    return this.items.get(id);
  }

  list(): T[] {
    return Array.from(this.items.values());
  }
}
