"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { Spinner } from "@/components/ui/Spinner";
import { useAuthStore } from "@/store/authStore";

/**
 * Entry point. Sends you to the app or to onboarding once the stored token has
 * been checked, so neither screen flashes before the session is known.
 */
export default function Home() {
  const router = useRouter();
  const ready = useAuthStore((state) => state.ready);
  const user = useAuthStore((state) => state.user);

  useEffect(() => {
    if (!ready) return;
    router.replace(user ? "/chat" : "/onboarding");
  }, [ready, user, router]);

  return (
    <main className="flex h-full items-center justify-center bg-app">
      <Spinner size={26} className="text-ultramarine" />
    </main>
  );
}
