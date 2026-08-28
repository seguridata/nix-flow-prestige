import "@testing-library/jest-dom/vitest";

// jsdom no implementa estas APIs del DOM que Radix UI (usado por el Dialog)
// consulta al manejar punteros y scroll — se agregan como no-ops mínimos
// para que los componentes que envuelven primitivas Radix se puedan montar
// en las pruebas sin lanzar errores.
if (typeof window !== "undefined") {
  if (!window.HTMLElement.prototype.hasPointerCapture) {
    window.HTMLElement.prototype.hasPointerCapture = () => false;
  }
  if (!window.HTMLElement.prototype.setPointerCapture) {
    window.HTMLElement.prototype.setPointerCapture = () => {};
  }
  if (!window.HTMLElement.prototype.releasePointerCapture) {
    window.HTMLElement.prototype.releasePointerCapture = () => {};
  }
  if (!window.HTMLElement.prototype.scrollIntoView) {
    window.HTMLElement.prototype.scrollIntoView = () => {};
  }
  if (!window.ResizeObserver) {
    window.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
}
