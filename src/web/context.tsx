import { createContext, useContext } from 'react';
import type { Tenant, User } from '../shared/domain';
export const SessionContext = createContext<{
  user: User;
  tenant: Tenant;
  go: (page: string) => void;
}>(null!);
export const useSession = () => useContext(SessionContext);
