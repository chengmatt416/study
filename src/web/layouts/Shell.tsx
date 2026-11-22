import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { clsx } from "clsx";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { BookOpenText, Books, CalendarBlank, Calculator, DotsThreeOutline, Folder, GearSix, House, Lightning, MagnifyingGlass, PencilSimple, SidebarSimple, Sparkle, UserCircle, type Icon } from "@phosphor-icons/react";
import { useDevice } from "../lib/device";
import { useUser } from "../lib/auth";
import { UpdatePrompt } from "../components/UpdatePrompt";
import { OfflineBanner } from "../components/OfflineBanner";
import { IconButton, spring } from "../components/ui";
import { STUDY_MOTION } from "../../shared/motion";

interface NavItem {
  to: string;
  label: string;
  icon: Icon;
  end?: boolean;
}

const NAV: NavItem[] = [
  { to: "/", label: "首頁", icon: House, end: true },
  { to: "/books", label: "電子書", icon: Books },
  // 章節 gathers 重點整理, 模擬試題 and 字卡; their own list pages stay reachable from 章節 and 內容庫.
  { to: "/chapters", label: "章節", icon: BookOpenText },
  { to: "/writing", label: "寫作練習", icon: PencilSimple },
  { to: "/content", label: "內容庫", icon: Folder },
  { to: "/syllabus", label: "學期課綱", icon: CalendarBlank },
  { to: "/tools", label: "數學工具", icon: Calculator },
  { to: "/ai", label: "AI 生成", icon: Sparkle },
];

export function Wordmark({ compact, light }: { compact?: boolean; light?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className={clsx("relative grid h-9 w-9 place-items-center rounded-xl font-display text-lg font-bold shadow-[var(--shadow-glow)]", light ? "bg-white text-ink-900" : "bg-aurora text-on-accent")}>
        S<span className="absolute right-1.5 bottom-1.5 h-1.5 w-1.5 rounded-full bg-current opacity-60" />
      </div>
      {!compact && <span className="font-display text-xl font-semibold tracking-[0.14em]">STUDY</span>}
    </div>
  );
}

function Avatar({ size = 32 }: { size?: number }) {
  const user = useUser();
  return user.avatar_url ? (
    <img src={user.avatar_url} alt="" className="rounded-full ring-2 ring-white dark:ring-ink-900" style={{ width: size, height: size }} referrerPolicy="no-referrer" />
  ) : (
    <span className="grid place-items-center rounded-full bg-aurora text-sm font-bold text-on-accent" style={{ width: size, height: size }}>
      {(user.name ?? user.email)[0]?.toUpperCase()}
    </span>
  );
}

function useNavItems() {
  const user = useUser();
  const features = user.access?.features;
  const items = NAV.filter((n) => n.to === "/books" ? features?.ebooks !== false || features?.booklets !== false : n.to === "/syllabus" ? features?.syllabi !== false : n.to === "/chapters" ? features?.notes !== false || features?.exams !== false || features?.decks !== false : n.to === "/writing" ? features?.writing !== false : n.to === "/tools" ? features?.tools !== false : n.to === "/ai" ? features?.ai !== false : true);
  const named = items.map((item) => item.to === "/books" && features?.ebooks === false ? { ...item, label: "資料手冊" } : item);
  return user.role === "admin" ? [...named, { to: "/admin", label: "管理後台", icon: GearSix }] : named;
}

// ---- 側欄顯示/隱藏（記住在 localStorage，⌘\ / Ctrl+\ 切換）----
const SIDEBAR_KEY = "sidebar-hidden";
const sidebarListeners = new Set<() => void>();
let sidebarHidden = (() => {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === "1";
  } catch {
    return false;
  }
})();

export function setSidebarHidden(v: boolean) {
  sidebarHidden = v;
  try {
    localStorage.setItem(SIDEBAR_KEY, v ? "1" : "0");
  } catch {
    /* 無痕模式等 */
  }
  sidebarListeners.forEach((l) => l());
}

export function useSidebar() {
  const hidden = useSyncExternalStore(
    (cb) => (sidebarListeners.add(cb), () => sidebarListeners.delete(cb)),
    () => sidebarHidden,
  );
  const toggle = useCallback(() => setSidebarHidden(!sidebarHidden), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        setSidebarHidden(!sidebarHidden);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return { hidden, toggle };
}

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const SIDEBAR_SHORTCUT = IS_MAC ? "⌘\\" : "Ctrl+\\";

/** 側欄隱藏時的浮動開啟按鈕 */
function SidebarReveal({ show, onClick, className }: { show: boolean; onClick: () => void; className?: string }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div className={clsx("fixed z-40", className)} initial={{ opacity: 0, x: -16, scale: 0.9 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: -16, scale: 0.9 }} transition={spring}>
          <IconButton label={`顯示側欄（${SIDEBAR_SHORTCUT}）`} onClick={onClick} className="glass h-10 w-10 shadow-[var(--shadow-soft)]">
            <SidebarSimple size={20} />
          </IconButton>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** ⌘K / Ctrl+K 聚焦搜尋 */
function useSearchHotkey(navigate: (to: string) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        const el = document.getElementById("global-search") as HTMLInputElement | null;
        if (el) el.focus();
        else navigate("/search");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);
}

/** 電腦：浮動玻璃側欄（支援全展開與簡潔 icon rail，無突兀空白與遮擋按鈕） */
function DesktopShell({ children }: { children: ReactNode }) {
  const items = useNavItems();
  const user = useUser();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const { hidden, toggle } = useSidebar();
  useSearchHotkey(navigate);
  return (
    <div className="desktop-shell-wrap flex h-full p-4 gap-4">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:rounded-xl focus:bg-ink-900 focus:px-4 focus:py-2.5 focus:text-sm focus:font-semibold focus:text-white focus:shadow-2xl dark:focus:bg-white dark:focus:text-ink-900"
      >
        跳至主要內容
      </a>
      <motion.aside
        data-app-chrome=""
        initial={false}
        animate={{ width: hidden ? 72 : 256 }}
        transition={spring}
        className="glass flex h-full shrink-0 flex-col overflow-hidden rounded-[28px] p-3 shadow-[var(--shadow-soft)]"
      >
        <div className={clsx("flex items-center pt-1 pb-4", hidden ? "flex-col gap-2.5 justify-center" : "justify-between px-2")}>
          <Wordmark compact={hidden} />
          <IconButton label={hidden ? `展開側欄（${SIDEBAR_SHORTCUT}）` : `收合側欄（${SIDEBAR_SHORTCUT}）`} onClick={toggle}>
            <SidebarSimple size={20} />
          </IconButton>
        </div>

        {hidden ? (
          <div className="mb-3 flex justify-center">
            <IconButton label="搜尋（⌘K）" onClick={() => navigate("/search")}>
              <MagnifyingGlass size={18} />
            </IconButton>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`);
            }}
            className="relative mb-5"
          >
            <MagnifyingGlass size={16} className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
            <input
              id="global-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜尋"
              className="h-10 w-full rounded-2xl bg-slate-900/5 pr-12 pl-9 text-sm outline-none transition focus:bg-white focus:ring-4 focus:ring-brand-500/15 dark:bg-white/5 dark:focus:bg-white/10"
            />
            <kbd className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded-md border border-slate-200 px-1.5 text-[10px] text-slate-400 dark:border-white/10">
              {IS_MAC ? "⌘K" : "Ctrl K"}
            </kbd>
          </form>
        )}

        <nav className="no-scrollbar -mx-1 min-h-0 flex-1 space-y-1 overflow-y-auto px-1">
          {items.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className="relative block" title={hidden ? n.label : undefined}>
              {({ isActive }) => (
                <div
                  className={clsx(
                    "relative flex items-center rounded-2xl text-sm font-medium transition-colors",
                    hidden ? "h-11 w-full justify-center px-0" : "gap-3 px-3.5 py-2.5",
                    isActive ? "text-on-accent" : "text-slate-600 hover:bg-slate-900/5 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/5",
                  )}
                >
                  {isActive && (
                    <motion.div
                      layoutId="nav-desktop"
                      className="absolute inset-0 rounded-2xl bg-aurora shadow-[var(--shadow-glow)]"
                      transition={spring}
                    />
                  )}
                  <n.icon size={20} weight={isActive ? "fill" : "duotone"} className="relative shrink-0" />
                  {!hidden && <span className="relative truncate">{n.label}</span>}
                </div>
              )}
            </NavLink>
          ))}
        </nav>

        <NavLink
          to="/me"
          className={clsx(
            "mt-4 flex shrink-0 items-center rounded-2xl p-2 transition hover:bg-slate-900/5 dark:hover:bg-white/5",
            hidden ? "justify-center" : "gap-3",
          )}
          title={hidden ? (user.name ?? user.email) : undefined}
        >
          <Avatar size={34} />
          {!hidden && (
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{user.name ?? user.email.split("@")[0]}</div>
              <div className="truncate text-xs text-slate-500">{user.role === "admin" ? "管理員" : "成員"}</div>
            </div>
          )}
        </NavLink>
      </motion.aside>

      <main
        id="main-content"
        tabIndex={-1}
        className="glass relative min-w-0 flex-1 overflow-auto rounded-[28px] shadow-[var(--shadow-soft)] outline-none"
      >
        <OfflineBanner floating />
        {children}
      </main>
    </div>
  );
}

/** 平板：精簡導覽軌（大觸控目標） */
function TabletShell({ children }: { children: ReactNode }) {
  const items = [...useNavItems(), { to: "/search", label: "搜尋", icon: MagnifyingGlass }];
  const { hidden, toggle } = useSidebar();
  return (
    <div className="flex h-full">
      <motion.div className="shrink-0 overflow-hidden" initial={false} animate={{ width: hidden ? 0 : 84 }} transition={spring}>
      <nav className="safe-top glass no-scrollbar flex h-full w-[84px] flex-col items-center gap-1.5 overflow-y-auto border-y-0 border-l-0 py-4">
        <NavLink to="/" aria-label="首頁" className="mb-4 shrink-0 rounded-xl transition active:scale-90">
          <Wordmark compact />
        </NavLink>
        {items.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className="w-[68px]">
            {({ isActive }) => (
              <div className={clsx("relative flex flex-col items-center gap-1 rounded-2xl py-2.5 text-[11px] font-medium", isActive ? "text-on-accent" : "text-slate-500 dark:text-slate-400")}>
                {isActive && <motion.div layoutId="nav-tablet" className="absolute inset-0 rounded-2xl bg-aurora shadow-[var(--shadow-glow)]" transition={spring} />}
                <n.icon size={24} weight={isActive ? "fill" : "duotone"} className="relative" />
                <span className="relative">{n.label}</span>
              </div>
            )}
          </NavLink>
        ))}
        <IconButton label="隱藏側欄" onClick={toggle} className="mt-auto shrink-0">
          <SidebarSimple size={22} />
        </IconButton>
        <NavLink to="/me" className="mt-2">
          <Avatar size={40} />
        </NavLink>
      </nav>
      </motion.div>
      <SidebarReveal show={hidden} onClick={toggle} className="top-[calc(var(--safe-top)+12px)] left-3" />
      <main className={clsx("safe-top relative min-w-0 flex-1 overflow-auto transition-[padding] duration-300", hidden && "pl-14")}>
        <OfflineBanner floating />
        {children}
      </main>
    </div>
  );
}

/** 手機：懸浮膠囊分頁列 */
function PhoneShell({ children, practice }: { children: ReactNode; practice: boolean }) {
  const loc = useLocation();
  const device = useDevice();
  const [more, setMore] = useState(false);
  const available = useNavItems();
  const tabs = available.filter((n) => n.to !== "/admin").slice(0, 4);
  tabs.splice(1, 0, { to: "/practice", label: "混合複習", icon: Lightning, end: true });
  const moreItems: NavItem[] = [
    ...available.filter((n) => !tabs.some((tab) => tab.to === n.to)),
    { to: "/search", label: "搜尋", icon: MagnifyingGlass },
    { to: "/me", label: "我的", icon: UserCircle },
  ];
  const moreActive = moreItems.some((n) => loc.pathname.startsWith(n.to));
  const Main = practice ? "div" : "main";
  useEffect(() => setMore(false), [loc.pathname, device]);
  return (
    <div className="flex h-full flex-col" data-phone-practice={practice ? "" : undefined}>
      <Main className={clsx("relative min-h-0 flex-1", practice ? "practice-phone-outlet flex flex-col overflow-hidden" : "safe-top overflow-auto pb-28")}>
        <OfflineBanner floating />
        {children}
      </Main>
      <nav aria-label="主要導覽" data-app-chrome="" className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3" style={{ paddingBottom: "max(12px, var(--safe-bottom))" }}>
        <div className="glass pointer-events-auto mx-auto flex max-w-md items-stretch rounded-[26px] p-1.5 shadow-[0_12px_40px_-12px_rgb(15_23_42/.35)]">
          {[...tabs.map((t) => ({ ...t, kind: "link" as const })), { to: "#more", label: "更多", icon: DotsThreeOutline, kind: "more" as const }].map((n) => {
            const active = n.kind === "more" ? moreActive || more : n.end ? loc.pathname === n.to : loc.pathname.startsWith(n.to);
            const inner = (
              <div className={clsx("relative flex flex-col items-center gap-0.5 rounded-[20px] py-2 text-[10px] font-medium", active ? "text-on-accent" : "text-slate-500 dark:text-slate-400")}>
                {active && <motion.div layoutId="nav-phone" className="absolute inset-0 rounded-[20px] bg-aurora shadow-[var(--shadow-glow)]" transition={spring} />}
                <n.icon size={22} weight={active ? "fill" : "duotone"} className="relative" />
                <span className="relative">{n.label}</span>
              </div>
            );
            return n.kind === "more" ? (
              <button key="more" className="flex-1" onClick={() => setMore((v) => !v)}>
                {inner}
              </button>
            ) : (
              <NavLink key={n.to} to={n.to} end={n.end} onClick={() => setMore(false)} className="flex-1">
                {inner}
              </NavLink>
            );
          })}
        </div>
      </nav>
      <AnimatePresence>
        {more && (
          <>
            <motion.div className="fixed inset-0 z-30 bg-ink-950/30 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMore(false)} />
            <motion.div
              className="glass fixed inset-x-3 z-30 mx-auto max-w-md rounded-[28px] p-3"
              style={{ bottom: "calc(max(12px, var(--safe-bottom)) + 84px)" }}
              initial={{ opacity: 0, y: 30, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.97 }}
              transition={spring}
            >
              <div className="grid grid-cols-4 gap-2">
                {moreItems.map((n, i) => (
                  <motion.div key={n.to} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring, delay: i * 0.04 }}>
                    <NavLink to={n.to} onClick={() => setMore(false)} className="flex flex-col items-center gap-1.5 rounded-2xl py-3 text-xs font-medium text-slate-700 active:bg-slate-900/5 dark:text-slate-200">
                      <span className="grid h-11 w-11 place-items-center rounded-2xl bg-ink-100 text-ink-900 dark:bg-white/10 dark:text-white">
                        <n.icon size={24} weight="duotone" />
                      </span>
                      {n.label}
                    </NavLink>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

/** 頁面與課程場景共用短距離、清晰文字的轉場。 */
function PageTransition({ children }: { children: ReactNode }) {
  const loc = useLocation();
  const reduce = useReducedMotion();
  return (
    <motion.div
      key={loc.pathname}
      className="min-h-full"
      initial={reduce ? false : { opacity: 0, y: STUDY_MOTION.travel }}
      animate={{ opacity: 1, y: 0, transitionEnd: { transform: "none" } }}
      transition={reduce ? { duration: 0 } : { duration: STUDY_MOTION.scene, ease: STUDY_MOTION.ease }}
    >
      {children}
    </motion.div>
  );
}

/** 依裝置選擇版型；閱讀器、作答、複習在手機/平板上為沉浸式全螢幕 */
export function Shell() {
  const device = useDevice();
  const loc = useLocation();
  const practice = /^\/practice\/?$/.test(loc.pathname);
  const immersivePath = /^\/(books\/[^/]+|exams\/[^/]+\/take|writing\/[^/]+|decks\/[^/]+\/(review|shuffle|weak|all))/.test(loc.pathname);
  const immersive = immersivePath && device !== "desktop";
  const fullBleed = practice || immersivePath || /^\/(tools|notes\/[^/]+\/edit|exams\/[^/]+\/edit)/.test(loc.pathname);
  const content = (
    <>
      {fullBleed ? <div className={clsx("h-full", practice && "min-h-0 flex-1")}><Outlet /></div> : <PageTransition><Outlet /></PageTransition>}
      <UpdatePrompt />
    </>
  );
  if (immersive) return <div className="flex h-full min-h-0 flex-col"><OfflineBanner floating /><div className="min-h-0 flex-1">{content}</div></div>;
  if (practice || device === "phone") return <PhoneShell practice={practice}>{content}</PhoneShell>;
  if (device === "tablet") return <TabletShell>{content}</TabletShell>;
  return <DesktopShell>{content}</DesktopShell>;
}

/** 一般內容頁面的寬度與留白 */
export function Page({ children, wide, className }: { children: ReactNode; wide?: boolean; className?: string }) {
  return <div className={clsx("mx-auto w-full px-4 py-5 md:px-10 md:py-8", wide ? "max-w-7xl" : "max-w-5xl", className)}>{children}</div>;
}
