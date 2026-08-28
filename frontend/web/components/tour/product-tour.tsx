"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "prestige.tour.v1";

export async function startPrestigeTour() {
  const [{ driver }] = await Promise.all([
    import("driver.js"),
    import("driver.js/dist/driver.css"),
  ]);
  const d = driver({
    showProgress: true,
    animate: true,
    overlayColor: "#191919",
    overlayOpacity: 0.45,
    popoverClass: "prestige-tour",
    nextBtnText: "Siguiente",
    prevBtnText: "Atrás",
    doneBtnText: "Listo",
    steps: [
      {
        element: "[data-tour='nav']",
        popover: {
          title: "Prestige",
          description: "Bandeja, onboarding, tareas y proceso. El motor es Temporal; aquí ves el expediente.",
        },
      },
      {
        element: "[data-tour='overview']",
        popover: {
          title: "Overview",
          description: "Tablero de operación: firmas, altas M16, salud de infra y flujos.",
        },
      },
      {
        element: "[data-tour='notify']",
        popover: {
          title: "Avisos",
          description: "Delegaciones, altas en revisión y firmas completadas.",
        },
      },
    ],
    onDestroyed: () => localStorage.setItem(STORAGE_KEY, "1"),
  });
  d.drive();
}

export function ProductTourButton() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem(STORAGE_KEY)) return;
    const t = window.setTimeout(() => {
      void startPrestigeTour();
    }, 700);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <Button variant="ghost" size="sm" onClick={() => void startPrestigeTour()}>
      Recorrido
    </Button>
  );
}
