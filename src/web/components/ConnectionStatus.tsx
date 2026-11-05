import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
export function ConnectionStatus() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => api('/health'),
    refetchInterval: 15000,
    refetchIntervalInBackground: true,
  });
  return (
    <div className={`connection-status ${health.isError ? 'disconnected' : ''}`} role="status">
      {health.isError
        ? 'Sin conexión al servidor del comercio. Conservamos el carrito; reconectá para confirmar cobros.'
        : 'Servidor local conectado · podés vender sin internet'}
      {health.isError && (
        <button className="text-button" onClick={() => void health.refetch()}>
          Reconectar
        </button>
      )}
    </div>
  );
}
