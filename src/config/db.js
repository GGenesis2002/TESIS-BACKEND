const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 10,

    // Cierra conexiones inactivas ANTES de que Supabase/la red las mate en silencio.
    // Si el pooler o un middlebox corta a los ~5-10 min de inactividad, aquí
    // cerramos nosotros mismos a los 20s — así nunca le entregamos a un usuario
    // una conexión que ya está muerta del otro lado.
    idleTimeoutMillis: 20000,

    connectionTimeoutMillis: 10000,

    // Mantiene la conexión TCP viva enviando paquetes keepalive periódicos.
    // Esto evita que firewalls/NAT/balanceadores la consideren "inactiva" y la descarten.
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,

    // CLAVE: si una query se cuelga (conexión zombie), que falle en vez de
    // quedarse esperando para siempre y bloquear ese slot del pool.
    statement_timeout: 15000,        // aborta queries que tarden más de 15s
    query_timeout: 15000,
    idle_in_transaction_session_timeout: 15000, // por si una transacción queda a medias
});


pool.on('connect', () => console.log('✅ Conectado a Supabase PostgreSQL'));

// ── Manejo de errores a nivel de pool ──────────────────────────────────
// Sin esto, un error async en una conexión idle (ej. "Connection terminated
// unexpectedly") puede tumbar el proceso de Node si no hay un listener,
// o dejar el pool en un estado roto sin reintentar.
pool.on('error', (err) => {
    console.error('❌ ERROR EN EL POOL DE POSTGRES:', err.message);
    // pg descarta automáticamente la conexión rota del pool.
});

setInterval(() => {
    pool.query('SELECT 1').catch(err => {
        console.error('⚠️ Ping de keepalive a la BD falló:', err.message);
    });
}, 4 * 60 * 1000);

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