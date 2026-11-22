import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router";
import { MotionConfig } from "motion/react";
import { IconContext } from "@phosphor-icons/react";
import { router } from "./App";
import { ToastHost } from "./components/ui";
import "./styles.css";
import { applyFontPrefs } from "./lib/fonts/prefs";

// 深色模式跟隨系統（可在「我的」頁切換）
let theme: string | null = null;
try { theme = localStorage.getItem("theme"); } catch { /* use the system appearance when storage is unavailable */ }
const dark = theme ? theme === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
document.documentElement.classList.toggle("dark", dark);

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 } },
});

// 使用者選的介面／標題／閱讀／程式碼字型（存在這台裝置）
applyFontPrefs();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <IconContext.Provider value={{ weight: "duotone", size: 20, mirrored: false }}>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
          <ToastHost />
        </QueryClientProvider>
      </IconContext.Provider>
    </MotionConfig>
  </StrictMode>,
);
