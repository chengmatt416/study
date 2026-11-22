'use client';
import { createContext, useContext, type ReactNode } from 'react';

const StudyApp = createContext(false);

export function StudyAppProvider({ hosted, children }: { hosted: boolean; children: ReactNode }) {
  return <StudyApp.Provider value={hosted}>{children}</StudyApp.Provider>;
}

export const useStudyApp = () => useContext(StudyApp);
