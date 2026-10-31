import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { SessionProvider } from './auth';
import { router } from './router';
import { ToastProvider } from './toast';
import { supabase } from './supabase';
import { takeSignOutByPerson } from './session-flag';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 5000, refetchOnWindowFocus: true } } });

export function App() {
  // Another login's data must never outlive this one: leaving or switching the login empties every cache. A session that ended
  // by itself (expired, or signed out elsewhere) goes to the sign-in card with its sentence (DP-1.2-13).
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange(event => {
      if (event !== 'SIGNED_OUT') return;
      queryClient.clear();
      if (!takeSignOutByPerson()) void router.navigate({ to: '/login', search: { ended: true }, replace: true });
    });
    return () => data.subscription.unsubscribe();
  }, []);
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}
