import { createContext, useContext } from 'react';

export type ViewId =
  | 'pilotage'
  | 'prospection'
  | 'clients'
  | 'devis'
  | 'factures'
  | 'projets'
  | 'planning'
  | 'catalogue'
  | 'maintenance'
  | 'studio'
  | 'site'
  | 'finance'
  | 'equipe'
  | 'taches'
  | 'parametres';

export interface NavState {
  view: ViewId;
  /** Element a ouvrir a l'arrivee sur la vue (client, document, scene...). */
  focus: string | null;
  go: (view: ViewId, focus?: string | null) => void;
}

export const NavContext = createContext<NavState>({
  view: 'pilotage',
  focus: null,
  go: () => {},
});

export function useNav(): NavState {
  return useContext(NavContext);
}
