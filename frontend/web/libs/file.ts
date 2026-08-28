export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // strip the "data:<mime>;base64," prefix — the backend expects raw base64
      const base64 = result.slice(result.indexOf(",") + 1);
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error ?? new Error("No se pudo leer el archivo"));
    reader.readAsDataURL(file);
  });
}
