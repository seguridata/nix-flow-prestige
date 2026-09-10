/**
 * @deprecated Solo lo usa el alta de onboarding (INE/selfie), que migra a
 * subida multipart en el siguiente commit (de-base64 de OnboardingCase).
 * Los documentos ya no pasan por aquí.
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("No se pudo leer el archivo"));
    reader.readAsDataURL(file);
  });
}
