import { lazy, Suspense, type ComponentType } from "react";
import { createBrowserRouter, Navigate, Outlet } from "react-router";
import { RequireAuth } from "./lib/auth";
import { Shell } from "./layouts/Shell";
import { Loading } from "./components/ui";
import Login from "./pages/Login";

const L = (factory: () => Promise<{ default: ComponentType }>) => {
  const C = lazy(factory);
  return (
    <Suspense fallback={<Loading />}>
      <C />
    </Suspense>
  );
};

export const router = createBrowserRouter([
  { path: "/login", element: <Login /> },
  { path: "/privacy", element: L(() => import("./pages/Legal").then((m) => ({ default: m.Privacy }))) },
  { path: "/terms", element: L(() => import("./pages/Legal").then((m) => ({ default: m.Terms }))) },
  { path: "/term", element: <Navigate to="/terms" replace /> },
  {
    element: (
      <RequireAuth>
        <Outlet />
      </RequireAuth>
    ),
    children: [
      {
        element: <Shell />,
        children: [
          { index: true, element: L(() => import("./pages/Home")) },
          { path: "search", element: L(() => import("./pages/Search")) },
          { path: "content", element: L(() => import("./pages/Content")) },
          { path: "books", element: L(() => import("./pages/Books")) },
          { path: "syllabus", element: L(() => import("./pages/Syllabi")) },
          { path: "books/:id", element: L(() => import("./pages/Reader")) },
          { path: "tools", element: L(() => import("./pages/Tools")) },
          { path: "ai", element: L(() => import("./pages/AiStudio")) },
          { path: "tools/:tool", element: L(() => import("./pages/Tools")) },
          { path: "chapters", element: L(() => import("./pages/Chapters")) },
          { path: "chapters/:id", element: L(() => import("./pages/ChapterView")) },
          { path: "chapters/:id/materials/:materialId", element: L(() => import("./pages/MaterialReader")) },
          { path: "writing", element: L(() => import("./pages/WritingPractice")) },
          { path: "writing/:id", element: L(() => import("./pages/WritingPractice")) },
          { path: "practice", element: L(() => import("./pages/Practice")) },
          { path: "notes", element: L(() => import("./pages/DocList")) },
          { path: "notes/:slug", element: L(() => import("./pages/NoteView")) },
          { path: "notes/:slug/edit", element: L(() => import("./pages/DocEdit")) },
          { path: "notes/:slug/history", element: L(() => import("./pages/History")) },
          { path: "exams", element: L(() => import("./pages/DocList")) },
          { path: "exams/:slug", element: L(() => import("./pages/ExamOverview")) },
          { path: "exams/:slug/take", element: L(() => import("./pages/ExamTake")) },
          { path: "exams/:slug/edit", element: L(() => import("./pages/DocEdit")) },
          { path: "exams/:slug/history", element: L(() => import("./pages/History")) },
          { path: "attempts/:id", element: L(() => import("./pages/ExamResult")) },
          { path: "decks", element: L(() => import("./pages/Decks")) },
          { path: "decks/:id", element: L(() => import("./pages/DeckDetail")) },
          { path: "decks/:id/:mode", element: L(() => import("./pages/Review")) },
          { path: "me", element: L(() => import("./pages/Me")) },
          { path: "admin", element: L(() => import("./pages/Admin")) },
          { path: "admin/:tab", element: L(() => import("./pages/Admin")) },
          { path: "*", element: L(() => import("./pages/NotFound")) },
        ],
      },
    ],
  },
]);
