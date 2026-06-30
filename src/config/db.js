const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 10,                       // máximo de conexiones simultáneas en el pool
    idleTimeoutMillis: 30000,      // cierra conexiones inactivas tras 30s
    connectionTimeoutMillis: 10000 // espera máx. 10s al intentar conectar
});

pool.on('connect', () => console.log('✅ Conectado a Supabase PostgreSQL'));

// ── Manejo de errores a nivel de pool ──────────────────────────────────
// Sin esto, un error async en una conexión idle (ej. "Connection terminated
// unexpectedly") puede tumbar el proceso de Node si no hay un listener,
// o dejar el pool en un estado roto sin reintentar.
pool.on('error', (err) => {
    console.error('❌ ERROR EN EL POOL DE POSTGRES:', err.message);
    // No relanzamos el error: pg recicla la conexión rota internamente
    // y las próximas queries usarán una conexión nueva.
});

// ── Verificación de conexión con reintentos al iniciar ─────────────────
// Esto evita que, si la BD no responde en el primer intento (como en
// incidentes de infraestructura de Supabase), el servidor quede "vivo"
// pero con el pool roto para siempre.
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 5000;

async function verificarConexion(intento = 1) {
    try {
        const client = await pool.connect();
        client.release();
        console.log('✅ Verificación de conexión a la base de datos OK');
    } catch (err) {
        console.error(`❌ Intento ${intento}/${MAX_RETRIES} fallido al conectar a la BD: ${err.message}`);
        if (intento < MAX_RETRIES) {
            setTimeout(() => verificarConexion(intento + 1), RETRY_DELAY_MS);
        } else {
            console.error('⚠️  No se pudo establecer conexión a la BD tras varios intentos. El servidor sigue corriendo, pero las queries fallarán hasta que la BD esté disponible.');
        }
    }
}

verificarConexion();

module.exports = pool;