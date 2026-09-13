// Mock de server-only para entorno de test (Vitest).
// En producción, el paquete real lanza si se importa en el cliente.
// En test, simplemente no hacemos nada — los módulos son "server-only" por convención.
export {};
