import { Component, type ReactNode } from 'react';
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    console.error('Error de interfaz POS:', error);
  }
  render() {
    if (this.state.failed)
      return (
        <div className="login-page">
          <section className="login-card" role="alert">
            <h1>No se pudo mostrar esta pantalla</h1>
            <p>Recargá para recuperar el carrito y consultar cualquier cobro pendiente.</p>
            <button className="button primary" onClick={() => location.reload()}>
              Recargar el sistema
            </button>
          </section>
        </div>
      );
    return this.props.children;
  }
}
