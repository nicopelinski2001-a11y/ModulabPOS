import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from './components/ErrorBoundary';
import { App } from './App';
import './styles.css';
const client = new QueryClient({
  defaultOptions: {
    // navigator.onLine describes the browser's internet state, not local LAN reachability.
    queries: { networkMode: 'always', retry: false, staleTime: 15000, refetchOnWindowFocus: false },
    mutations: { networkMode: 'always', retry: false },
  },
});
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </QueryClientProvider>
  </React.StrictMode>,
);
