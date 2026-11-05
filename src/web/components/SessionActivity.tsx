import { useEffect } from 'react';
import { api, ApiError } from '../api';
import type { Tenant, User } from '../../shared/domain';

/** Only real input renews inactivity. Background queries and health checks do not. */
export function SessionActivity({
  user,
  tenant,
  onLock,
}: {
  user: User;
  tenant: Tenant;
  onLock: () => void;
}) {
  useEffect(() => {
    const key = `modulab-activity:${user.session_id}`;
    let localActivity = Date.now();
    let lastSent = 0;
    let lastWritten = 0;
    let running = false;
    const activity = () => {
      localActivity = Date.now();
      if (localActivity - lastWritten > 1000) {
        try {
          localStorage.setItem(key, String(localActivity));
        } catch {
          /* use memory */
        }
        lastWritten = localActivity;
      }
    };
    const events = ['pointerdown', 'keydown', 'touchstart'] as const;
    events.forEach((event) => window.addEventListener(event, activity, { passive: true }));
    const timer = setInterval(async () => {
      let shared = 0;
      try {
        shared = Number(localStorage.getItem(key)) || 0;
      } catch {
        /* use memory */
      }
      const active = Math.max(localActivity, Math.min(shared, Date.now()));
      if (Date.now() - active >= tenant.session_idle_minutes * 60000) {
        // Lock immediately even if the server cannot be reached. Server enforces its own deadline.
        void api('/auth/logout', {}).catch(() => {});
        onLock();
      } else if (!running && active > lastSent && Date.now() - lastSent >= 20000) {
        running = true;
        try {
          await api('/auth/activity', {});
          lastSent = Date.now();
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) onLock();
        } finally {
          running = false;
        }
      }
    }, 1000);
    return () => {
      clearInterval(timer);
      events.forEach((event) => window.removeEventListener(event, activity));
    };
  }, [user.session_id, tenant.session_idle_minutes, onLock]);
  return null;
}
