"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/store/session-store";

const STORAGE_KEY = "prestige.tour.v1";

function tourKey(userId?: string): string {
  return userId ? `${STORAGE_KEY}.${userId}` : STORAGE_KEY;
}

export async function startPrestigeTour(userId?: string) {
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
    onDestroyed: () => {
      try {
        localStorage.setItem(tourKey(userId), "1");
      } catch {
        /* sin almacenamiento: el recorrido simplemente se repetirá */
      }
    },
  });
  d.drive();
}

export function ProductTourButton() {
  const { signerId } = useSession();
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (localStorage.getItem(tourKey(signerId))) return;
    } catch {
      return;
    }
    const t = window.setTimeout(() => {
      void startPrestigeTour(signerId);
    }, 700);
    return () => window.clearTimeout(t);
  }, [signerId]);

  return (
    <Button variant="ghost" size="sm" onClick={() => void startPrestigeTour(signerId)}>
      Recorrido
    </Button>
  );
}
